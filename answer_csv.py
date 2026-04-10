"""
Doc file dap an CSV: tu dong nhan dong dau la header hay la Q1.
"""

import csv
import re
from pathlib import Path


def normalize_answer_cell(cell: str) -> set[str]:
    raw = cell.strip().upper().replace(" ", "")
    if not raw:
        return set()
    if "," in raw:
        return {part for part in raw.split(",") if part}
    return {ch for ch in raw if "A" <= ch <= "F"}


def csv_first_row_is_header(row: list[str]) -> bool:
    """
    True  -> bo qua dong dau (ten cot / tieu de de thi).
    False -> dong dau la Q1 (file khong co header).
    """
    if not row:
        return False
    first_raw = (row[0] or "").strip()
    if not first_raw:
        return False
    if first_raw.startswith("#"):
        return True

    first = first_raw.upper().replace(" ", "")
    # Chi chu A-F va dau phay -> giong dong dap an, khong phai header
    if re.fullmatch(r"[A-F]+(,[A-F]+)*", first):
        return False

    # Ten de, tieu de cot, URL...
    if len(first_raw) > 12:
        return True
    if re.search(r"PMG|Question|Course|FE|RE|\.com|header", first_raw, re.I):
        return True
    if "-" in first_raw and len(first_raw) > 8:
        return True
    return False


def parse_answers_csv(path: Path) -> dict[int, set[str]]:
    answers: dict[int, set[str]] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))
    if not rows:
        return answers

    if csv_first_row_is_header(rows[0]):
        data_rows = rows[1:]
    else:
        data_rows = rows

    for idx, row in enumerate(data_rows, start=1):
        if not row:
            continue
        selected: set[str] = set()
        for cell in row:
            selected = normalize_answer_cell(cell)
            if selected:
                break
        if selected:
            answers[idx] = selected
    return answers
