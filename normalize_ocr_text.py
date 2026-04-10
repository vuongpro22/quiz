import argparse
import re
from pathlib import Path


BLOCK_HEADER_PATTERN = re.compile(
    r"=+\s*Q(\d+)(?:_[^.=]+)?\.(?:webp|png|jpg|jpeg|bmp|tiff|tif)\s*=+",
    re.IGNORECASE,
)
CHOOSE_PATTERN = re.compile(r"\(\s*Choose\s+(\d+)\s+answers?\s*[\)\}]", re.IGNORECASE)
OPTION_START_PATTERN = re.compile(r"^\s*([A-F])[\.\)]\s*(.*)$", re.IGNORECASE)

NOISE_PATTERNS = [
    re.compile(r"FU\w*FLOW", re.IGNORECASE),
    re.compile(r"^\s*Back\s*\|\s*Next\s*\|?\s*$", re.IGNORECASE),
    re.compile(r"^\s*There are \d+ questions", re.IGNORECASE),
    re.compile(r"^\s*[~_\-\.\|=\[\]\(\){}<>\\/]+\s*$"),
]


def is_noise_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    for pattern in NOISE_PATTERNS:
        if pattern.search(stripped):
            return True
    # Remove short garbage lines like "td", "xam", etc.
    if len(stripped) <= 4 and not re.search(r"[A-Za-z]{2,}", stripped):
        return True
    return False


def clean_line(line: str) -> str:
    return " ".join(line.replace("\t", " ").split())


def strip_watermark_prefix(line: str) -> str:
    # Remove common prefix like "fuoverflow ..." from OCR lines.
    return re.sub(r"^\s*fu\w*flow\b[\s\W\d]*", "", line, flags=re.IGNORECASE).strip()


def strip_choose_prefix(line: str) -> str:
    """Remove '(Choose X answer)' marker but keep remaining question text."""
    return CHOOSE_PATTERN.sub("", line).strip(" -:;,.")


def parse_options(lines: list[str]) -> tuple[list[tuple[str, str]], int]:
    options: list[tuple[str, str]] = []
    current_key = ""
    current_parts: list[str] = []
    first_option_idx = len(lines)

    for idx, raw in enumerate(lines):
        line = clean_line(raw)
        candidates = [line]

        # Handle inline pattern: "(Choose 1 answer) A. ...."
        choose_match = CHOOSE_PATTERN.search(line)
        if choose_match:
            tail = line[choose_match.end():].strip()
            if tail:
                candidates.append(tail)

        matched_option = False
        for candidate in candidates:
            match = OPTION_START_PATTERN.match(candidate)
            if not match:
                continue
            if current_key:
                options.append((current_key, " ".join(current_parts).strip()))
            current_key = match.group(1).upper()
            current_parts = [match.group(2).strip()]
            if first_option_idx == len(lines):
                first_option_idx = idx
            matched_option = True
            break
        if matched_option:
            continue

        if current_key:
            # Continuation of current option text
            if line:
                current_parts.append(line)

    if current_key:
        options.append((current_key, " ".join(current_parts).strip()))

    return options, first_option_idx


def normalize_block(q_num: int, block_text: str) -> str:
    raw_lines = [ln.rstrip() for ln in block_text.splitlines()]
    lines = []
    for ln in raw_lines:
        if not ln.strip():
            continue
        cleaned = strip_watermark_prefix(clean_line(ln))
        if not cleaned or is_noise_line(cleaned):
            continue
        lines.append(cleaned)

    choose_count = 1
    for line in lines:
        match = CHOOSE_PATTERN.search(line)
        if match:
            choose_count = int(match.group(1))
            break

    options, first_option_idx = parse_options(lines)

    question_candidates = []
    for ln in lines[:first_option_idx]:
        ln_clean = clean_line(ln)
        ln_clean = strip_choose_prefix(ln_clean)
        if ln_clean:
            question_candidates.append(ln_clean)

    question_text = " ".join(question_candidates).strip()
    question_text = re.sub(r"^\s*Question:\s*\d+\s*", "", question_text, flags=re.IGNORECASE)
    question_text = re.sub(r"^\s*Question:\s*", "", question_text, flags=re.IGNORECASE)
    question_text = strip_choose_prefix(question_text)
    if re.match(r"^[A-F][\.\)]\s+", question_text, flags=re.IGNORECASE):
        question_text = ""
    if re.fullmatch(r"Question\s*\d+", question_text, flags=re.IGNORECASE):
        question_text = ""
    if not question_text:
        # Try fallback from original block before first option marker.
        fallback_lines = []
        for ln in raw_lines:
            c = strip_watermark_prefix(clean_line(ln))
            c = strip_choose_prefix(c)
            if not c or is_noise_line(c):
                continue
            if re.match(r"^[A-F][\.\)]\s+", c, flags=re.IGNORECASE):
                continue
            fallback_lines.append(c)
        question_text = " ".join(fallback_lines).strip() or f"Question {q_num}"

    choose_label = "answer" if choose_count == 1 else "answers"
    out_lines = [
        f"===== Q{q_num}.webp =====",
        f"Question: {q_num} {question_text}",
        f"(Choose {choose_count} {choose_label})",
    ]

    if options:
        for key, text in options:
            out_lines.append(f"{key}. {text}")

    return "\n".join(out_lines).strip()


def normalize_content(content: str) -> str:
    matches = list(BLOCK_HEADER_PATTERN.finditer(content))
    if not matches:
        return content.strip() + "\n"

    blocks: list[str] = []
    for idx, match in enumerate(matches):
        q_num = int(match.group(1))
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(content)
        block_text = content[start:end]
        blocks.append(normalize_block(q_num, block_text))

    return "\n\n".join(blocks).strip() + "\n"


def process_file(path: Path, output_dir: Path | None) -> Path:
    normalized = normalize_content(path.read_text(encoding="utf-8", errors="ignore"))
    if output_dir is None:
        out_path = path
    else:
        output_dir.mkdir(parents=True, exist_ok=True)
        out_path = output_dir / path.name
    out_path.write_text(normalized, encoding="utf-8")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Normalize OCR quiz text files to a consistent format."
    )
    parser.add_argument(
        "input",
        type=Path,
        help="Input .txt file or folder containing OCR output files.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("output_text_normalized"),
        help="Output folder for normalized files (default: output_text_normalized).",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Overwrite original files instead of writing to output folder.",
    )
    args = parser.parse_args()

    if not args.input.exists():
        raise FileNotFoundError(f"Input not found: {args.input}")

    output_dir = None if args.in_place else args.output

    if args.input.is_file():
        if args.input.suffix.lower() != ".txt":
            raise ValueError("Input file must be .txt")
        out_path = process_file(args.input, output_dir)
        print(f"[OK] {args.input.name} -> {out_path}")
        return

    txt_files = sorted(args.input.glob("*.txt"))
    if not txt_files:
        raise ValueError("No .txt files found in input folder.")

    for path in txt_files:
        out_path = process_file(path, output_dir)
        print(f"[OK] {path.name} -> {out_path}")

    print("Done.")


if __name__ == "__main__":
    main()
