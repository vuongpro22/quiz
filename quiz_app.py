import argparse
import re
from pathlib import Path

from answer_csv import parse_answers_csv


def parse_answers(answer_path: Path) -> dict[int, set[str]]:
    if answer_path.suffix.lower() == ".csv":
        return parse_answers_csv(answer_path)

    answers: dict[int, set[str]] = {}
    pattern = re.compile(r"^Q(\d+)\s*:\s*([A-F](?:\s*,\s*[A-F])*)\s*$", re.IGNORECASE)

    for raw_line in answer_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = pattern.match(line)
        if not match:
            continue
        q_num = int(match.group(1))
        selected = {part.strip().upper() for part in match.group(2).split(",")}
        answers[q_num] = selected
    return answers


def split_question_blocks(content: str) -> list[tuple[int, str]]:
    pattern = re.compile(r"=+\s*Q(\d+)\.webp\s*=+", re.IGNORECASE)
    matches = list(pattern.finditer(content))
    blocks: list[tuple[int, str]] = []
    for idx, match in enumerate(matches):
        q_num = int(match.group(1))
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(content)
        block_text = content[start:end].strip()
        if block_text:
            blocks.append((q_num, block_text))
    return blocks


def parse_question(block: str, fallback_q_num: int) -> tuple[int, str, list[tuple[str, str]], int]:
    # NOTE: `Question:\s*(\d+)\s*(.*)` cannot span lines — `.` does not match newlines.
    lines = [ln.rstrip() for ln in block.splitlines()]
    q_num = fallback_q_num
    i = 0
    question_lines: list[str] = []
    header_re = re.compile(r"^\s*Question:\s*(\d+)\s*(.*)$", re.IGNORECASE)

    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines):
        m = header_re.match(lines[i])
        if m:
            q_num = int(m.group(1))
            first = m.group(2).strip()
            if first:
                question_lines.append(first)
            i += 1

    choose_line_re = re.compile(r"^\s*\(Choose\s+(\d+)\s+answers?\)\s*$", re.IGNORECASE)
    choose_count = 1
    option_start = len(lines)

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        cm = choose_line_re.match(stripped)
        if cm:
            choose_count = int(cm.group(1))
            option_start = i + 1
            break
        if re.match(r"^[A-F]\.\s", stripped):
            option_start = i
            break
        question_lines.append(line)
        i += 1

    question_text = "\n".join(question_lines).strip()
    if not question_text:
        for ln in lines:
            s = ln.strip()
            if not s or s.startswith("(") or re.match(r"^[A-F]\.", s):
                continue
            question_text = s
            break
        if not question_text:
            question_text = f"Question {q_num}"

    options_block = "\n".join(lines[option_start:])
    option_pattern = re.compile(r"([A-F])\.\s*(.+?)(?=\n[A-F]\.\s|\Z)", re.DOTALL)
    options_raw = option_pattern.findall(options_block)
    options: list[tuple[str, str]] = []
    for key, text in options_raw:
        clean_text = " ".join(text.replace("\n", " ").split())
        options.append((key.upper(), clean_text))

    return q_num, question_text, options, choose_count


def parse_questions(question_path: Path) -> dict[int, dict]:
    content = question_path.read_text(encoding="utf-8")
    blocks = split_question_blocks(content)
    questions: dict[int, dict] = {}

    for header_q_num, block in blocks:
        try:
            q_num, question_text, options, choose_count = parse_question(block, header_q_num)
        except ValueError:
            continue
        questions[q_num] = {
            "question": question_text,
            "options": options,
            "choose_count": choose_count,
        }
    return questions


def ask_user_answer(valid_keys: set[str], choose_count: int) -> set[str]:
    while True:
        if choose_count > 1:
            raw = input(f"Chon {choose_count} dap an (vd: A,B): ").strip().upper()
            picked = {part.strip() for part in raw.split(",") if part.strip()}
        else:
            raw = input("Chon 1 dap an (vd: A): ").strip().upper()
            picked = {raw} if raw else set()

        if len(picked) != choose_count:
            print(f"Ban can chon dung {choose_count} dap an.")
            continue
        if not picked.issubset(valid_keys):
            print(f"Dap an khong hop le. Chi duoc chon trong: {', '.join(sorted(valid_keys))}")
            continue
        return picked


def main() -> None:
    parser = argparse.ArgumentParser(description="Quiz app from OCR question file and answer key.")
    parser.add_argument(
        "--questions",
        type=Path,
        default=Path("output_text/PMG201c - FA25 - RE.txt"),
        help="Path to merged questions text file.",
    )
    parser.add_argument(
        "--answers",
        type=Path,
        default=Path("answer/PMG201c - FA25 - RE.txt"),
        help="Path to answer key file.",
    )
    args = parser.parse_args()

    if not args.questions.exists():
        raise FileNotFoundError(f"Questions file not found: {args.questions}")
    if not args.answers.exists():
        raise FileNotFoundError(f"Answers file not found: {args.answers}")

    questions = parse_questions(args.questions)
    answer_key = parse_answers(args.answers)

    q_numbers = sorted(set(questions.keys()) & set(answer_key.keys()))
    if not q_numbers:
        raise ValueError("Khong tim thay cau nao co du ca de va dap an.")

    print(f"Bat dau quiz: {len(q_numbers)} cau hoi")
    print("-" * 60)

    correct_count = 0
    wrong_details: list[str] = []

    for idx, q_num in enumerate(q_numbers, start=1):
        data = questions[q_num]
        print(f"\nCau {q_num} ({idx}/{len(q_numbers)}):")
        print(data["question"])
        for key, text in data["options"]:
            print(f"  {key}. {text}")

        valid_keys = {k for k, _ in data["options"]}
        user_choice = ask_user_answer(valid_keys, data["choose_count"])
        correct_choice = answer_key[q_num]

        if user_choice == correct_choice:
            correct_count += 1
            print("=> Dung")
        else:
            print("=> Sai")
            wrong_details.append(
                f"Q{q_num}: ban chon {','.join(sorted(user_choice))} | dap an {','.join(sorted(correct_choice))}"
            )

    total = len(q_numbers)
    score = (correct_count / total) * 10
    print("\n" + "=" * 60)
    print(f"Ket qua: {correct_count}/{total} cau dung")
    print(f"Diem (thang 10): {score:.2f}")
    if wrong_details:
        print("\nCac cau sai:")
        for line in wrong_details:
            print(f"- {line}")


if __name__ == "__main__":
    main()
