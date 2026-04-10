import argparse
from pathlib import Path

from PIL import Image


SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif"}


def collect_images(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path] if input_path.suffix.lower() in SUPPORTED_EXTENSIONS else []

    images: list[Path] = []
    for ext in SUPPORTED_EXTENSIONS:
        images.extend(input_path.glob(f"*{ext}"))
        images.extend(input_path.glob(f"*{ext.upper()}"))
    return sorted(set(images))


def detect_red_divider_x(image: Image.Image) -> int | None:
    rgb = image.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    best_x = None
    best_count = 0

    for x in range(w):
        count = 0
        for y in range(h):
            r, g, b = px[x, y]
            if r > 160 and g < 70 and b < 70:
                count += 1
        if count > best_count:
            best_count = count
            best_x = x

    # Need a strong vertical red line to trust auto split.
    if best_x is not None and best_count > int(h * 0.5):
        return best_x
    return None


def crop_question_area(
    image: Image.Image,
    top_cut_px: int = 28,
    footer_cut_px: int = 90,
    include_left_of_divider_px: int = 420,
    fallback_right_ratio: float = 0.40,
) -> Image.Image:
    w, h = image.size
    divider_x = detect_red_divider_x(image)
    if divider_x is not None:
        # Keep a strip on the left side so "(Choose X answer)" remains visible.
        left = max(0, divider_x - include_left_of_divider_px)
    else:
        left = int(w * fallback_right_ratio)

    top = max(0, top_cut_px)
    right = w
    bottom = max(1, h - footer_cut_px)

    cropped = image.crop((left, top, right, bottom))
    return cropped


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Auto-crop quiz screenshots to keep only question/answers area."
    )
    parser.add_argument("input", type=Path, help="Input image or folder.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("img_cropped"),
        help="Output folder (default: img_cropped).",
    )
    parser.add_argument(
        "--top-cut",
        type=int,
        default=28,
        help="Pixels to cut from top to remove header noise (default: 28).",
    )
    parser.add_argument(
        "--footer-cut",
        type=int,
        default=90,
        help="Pixels to cut from bottom to remove navigation bar (default: 90).",
    )
    parser.add_argument(
        "--include-left",
        type=int,
        default=420,
        help="Pixels kept on the left of red divider (default: 420).",
    )
    args = parser.parse_args()

    if not args.input.exists():
        raise FileNotFoundError(f"Input not found: {args.input}")

    images = collect_images(args.input)
    if not images:
        raise ValueError("No supported images found.")

    args.output.mkdir(parents=True, exist_ok=True)
    print(f"Found {len(images)} image(s).")

    for img_path in images:
        try:
            image = Image.open(img_path)
            cropped = crop_question_area(
                image,
                top_cut_px=args.top_cut,
                footer_cut_px=args.footer_cut,
                include_left_of_divider_px=args.include_left,
            )
            out_path = args.output / img_path.name
            cropped.save(out_path)
            print(f"[OK] {img_path.name} -> {out_path}")
        except Exception as exc:
            print(f"[ERROR] {img_path.name}: {exc}")

    print("Done.")


if __name__ == "__main__":
    main()
