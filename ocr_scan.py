import argparse
from pathlib import Path
import re
from typing import Iterable

from PIL import Image, ImageOps
import pytesseract


SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}
NOISE_MARKERS = (
    "FUCVERFLOW CONT",
    "FUQWERFLOW.COM",
    "FUD",
    "[pU9)",
    "FUOVERFLOW.COM",
    "FD",
    "fol{-",
)


def preprocess_image(image_path: Path) -> Image.Image:
    """Convert image to larger high-contrast grayscale for better OCR."""
    image = Image.open(image_path)
    # Upscale to improve OCR confidence for small fonts.
    scaled = image.resize((image.width * 2, image.height * 2), Image.Resampling.LANCZOS)
    gray = ImageOps.grayscale(scaled)
    # Simple thresholding to improve text/background separation
    thresholded = gray.point(lambda p: 255 if p > 150 else 0)
    return thresholded


def collect_images(input_path: Path) -> Iterable[Path]:
    if input_path.is_file():
        if input_path.suffix.lower() in SUPPORTED_EXTENSIONS:
            return [input_path]
        return []

    images = []
    for ext in SUPPORTED_EXTENSIONS:
        images.extend(input_path.glob(f"*{ext}"))
        images.extend(input_path.glob(f"*{ext.upper()}"))
    unique_images = list(set(images))
    return sorted(unique_images, key=natural_sort_key)


def natural_sort_key(path: Path) -> tuple:
    """Sort Q2 before Q10 by splitting text and number groups."""
    parts = re.split(r"(\d+)", path.stem.lower())
    key = []
    for part in parts:
        if part.isdigit():
            key.append(int(part))
        else:
            key.append(part)
    return tuple(key)


def clean_ocr_text(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if any(marker in line for marker in NOISE_MARKERS):
            continue
        lines.append(line.rstrip())
    return "\n".join(lines).strip()


def ocr_image(image_path: Path, language: str, preprocess: bool, psm: int) -> str:
    image = preprocess_image(image_path) if preprocess else Image.open(image_path)
    config = f"--oem 3 --psm {psm}"
    raw_text = pytesseract.image_to_string(image, lang=language, config=config)
    return clean_ocr_text(raw_text)


def get_merged_output_name(input_path: Path) -> str:
    if input_path.is_dir():
        return f"{input_path.name}.txt"
    return f"{input_path.stem}.txt"


def save_merged_text(
    output_dir: Path,
    input_path: Path,
    all_results: list[tuple[Path, str]],
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    out_file = output_dir / get_merged_output_name(input_path)
    chunks = []
    for image_path, text in all_results:
        chunks.append(f"===== {image_path.name} =====\n{text.strip()}\n")
    out_file.write_text("\n".join(chunks).strip() + "\n", encoding="utf-8")
    return out_file


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scan image(s) to text using Tesseract OCR."
    )
    parser.add_argument(
        "input",
        type=Path,
        help="Image path or folder containing images.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("output_text"),
        help="Output folder for .txt files (default: output_text).",
    )
    parser.add_argument(
        "-l",
        "--lang",
        default="vie+eng",
        help="OCR language (default: vie+eng).",
    )
    parser.add_argument(
        "--tesseract-cmd",
        type=str,
        default="",
        help="Optional path to tesseract.exe.",
    )
    parser.add_argument(
        "--no-preprocess",
        action="store_true",
        help="Disable grayscale + threshold preprocessing.",
    )
    parser.add_argument(
        "--psm",
        type=int,
        default=6,
        help="Tesseract page segmentation mode (default: 6).",
    )
    parser.add_argument(
        "--save-individual",
        action="store_true",
        help="Also save one .txt file per image (default: off).",
    )
    args = parser.parse_args()

    if args.tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = args.tesseract_cmd

    input_path = args.input
    if not input_path.exists():
        raise FileNotFoundError(f"Input not found: {input_path}")

    images = list(collect_images(input_path))
    if not images:
        raise ValueError("No supported images found.")

    print(f"Found {len(images)} image(s). OCR language: {args.lang}")
    merged_results: list[tuple[Path, str]] = []
    for img_path in images:
        try:
            text = ocr_image(
                img_path,
                args.lang,
                preprocess=not args.no_preprocess,
                psm=args.psm,
            )
            merged_results.append((img_path, text))
            if args.save_individual:
                args.output.mkdir(parents=True, exist_ok=True)
                out_path = args.output / f"{img_path.stem}.txt"
                out_path.write_text(text.strip() + "\n", encoding="utf-8")
                print(f"[OK] {img_path.name} -> {out_path}")
            else:
                print(f"[OK] {img_path.name}")
        except Exception as exc:
            print(f"[ERROR] {img_path.name}: {exc}")

    if merged_results:
        merged_path = save_merged_text(args.output, input_path, merged_results)
        print(f"[OK] Merged output -> {merged_path}")

    print("Done.")


if __name__ == "__main__":
    main()
