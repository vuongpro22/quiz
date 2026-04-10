import argparse
import csv
import random
import re
from dataclasses import dataclass
from pathlib import Path


HEADER_PATTERN = re.compile(r"=+\s*Q(\d+)\.webp\s*=+", re.IGNORECASE)
CHOOSE_PATTERN = re.compile(r"\(Choose\s+(\d+)\s+answers?\)", re.IGNORECASE)
OPTION_PATTERN = re.compile(r"^([A-F])\.\s*(.*)$", re.IGNORECASE)
TXT_ANSWER_PATTERN = re.compile(r"^Q(\d+)\s*:\s*([A-F](?:\s*,\s*[A-F])*)\s*$", re.IGNORECASE)


@dataclass
class QuestionItem:
    source_exam: str
    q_num: int
    question: str
    options: list[tuple[str, str]]
    choose_count: int
    answer: set[str]


def parse_answers(path: Path) -> dict[int, set[str]]:
    if path.suffix.lower() == ".csv":
        return parse_answers_csv(path)
    return parse_answers_txt(path)


def parse_answers_txt(path: Path) -> dict[int, set[str]]:
    answers: dict[int, set[str]] = {}
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        match = TXT_ANSWER_PATTERN.match(line)
        if not match:
            continue
        q_num = int(match.group(1))
        values = {part.strip().upper() for part in match.group(2).split(",")}
        answers[q_num] = values
    return answers


def parse_answers_csv(path: Path) -> dict[int, set[str]]:
    answers: dict[int, set[str]] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))
    if not rows:
        return answers

    for idx, row in enumerate(rows[1:], start=1):
        selected: set[str] = set()
        for cell in row:
            token = cell.strip().upper().replace(" ", "")
            if not token:
                continue
            if "," in token:
                selected = {x for x in token.split(",") if x}
            else:
                selected = {ch for ch in token if "A" <= ch <= "F"}
            if selected:
                break
        if selected:
            answers[idx] = selected
    return answers


def split_blocks(content: str) -> list[tuple[int, str]]:
    matches = list(HEADER_PATTERN.finditer(content))
    blocks: list[tuple[int, str]] = []
    for idx, match in enumerate(matches):
        q_num = int(match.group(1))
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(content)
        block = content[start:end].strip()
        if block:
            blocks.append((q_num, block))
    return blocks


def parse_question_file(path: Path) -> dict[int, dict]:
    content = path.read_text(encoding="utf-8", errors="ignore")
    result: dict[int, dict] = {}

    for q_num, block in split_blocks(content):
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]

        choose_count = 1
        for ln in lines:
            m = CHOOSE_PATTERN.search(ln)
            if m:
                choose_count = int(m.group(1))
                break

        options: list[tuple[str, str]] = []
        question_lines: list[str] = []
        collecting_options = False
        for ln in lines:
            if CHOOSE_PATTERN.search(ln):
                continue
            opt = OPTION_PATTERN.match(ln)
            if opt:
                collecting_options = True
                options.append((opt.group(1).upper(), opt.group(2).strip()))
            elif collecting_options and options:
                # continuation line for previous option
                key, text = options[-1]
                options[-1] = (key, f"{text} {ln}".strip())
            else:
                question_lines.append(ln)

        question_text = " ".join(question_lines).strip()
        question_text = re.sub(r"^\s*Question:\s*\d+\s*", "", question_text, flags=re.IGNORECASE)
        question_text = re.sub(r"^\s*Question:\s*", "", question_text, flags=re.IGNORECASE)
        if not question_text:
            question_text = f"Question {q_num}"

        result[q_num] = {
            "question": question_text,
            "options": options,
            "choose_count": choose_count,
        }
    return result


def build_pool(questions_dir: Path, answers_dir: Path) -> list[QuestionItem]:
    pool: list[QuestionItem] = []
    answer_files = {
        path.stem: path
        for path in answers_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".txt", ".csv"}
    }

    for q_path in sorted(questions_dir.glob("*.txt")):
        exam_name = q_path.stem
        a_path = answer_files.get(exam_name)
        if not a_path:
            continue
        questions = parse_question_file(q_path)
        answers = parse_answers(a_path)
        for q_num in sorted(set(questions.keys()) & set(answers.keys())):
            data = questions[q_num]
            if not data["options"]:
                continue
            pool.append(
                QuestionItem(
                    source_exam=exam_name,
                    q_num=q_num,
                    question=data["question"],
                    options=data["options"],
                    choose_count=data["choose_count"],
                    answer=answers[q_num],
                )
            )
    return pool


def ask_answer(valid_keys: set[str], choose_count: int) -> set[str]:
    while True:
        if choose_count > 1:
            raw = input(f"Chon {choose_count} dap an (vd: A,B): ").strip().upper()
            picked = {x.strip() for x in raw.split(",") if x.strip()}
        else:
            raw = input("Chon 1 dap an (vd: A): ").strip().upper()
            picked = {raw} if raw else set()

        if len(picked) != choose_count:
            print(f"Ban can chon dung {choose_count} dap an.")
            continue
        if not picked.issubset(valid_keys):
            print(f"Dap an khong hop le. Chi duoc chon: {', '.join(sorted(valid_keys))}")
            continue
        return picked


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Tao quiz ngau nhien tu nhieu file de va dap an."
    )
    parser.add_argument("--questions-dir", type=Path, default=Path("output_text"))
    parser.add_argument("--answers-dir", type=Path, default=Path("answer"))
    parser.add_argument("--count", type=int, default=20, help="So cau hoi ngau nhien.")
    parser.add_argument("--seed", type=int, default=None, help="Seed random de tai lap.")
    args = parser.parse_args()

    if not args.questions_dir.exists():
        raise FileNotFoundError(f"Khong tim thay thu muc de: {args.questions_dir}")
    if not args.answers_dir.exists():
        raise FileNotFoundError(f"Khong tim thay thu muc dap an: {args.answers_dir}")

    pool = build_pool(args.questions_dir, args.answers_dir)
    if not pool:
        raise ValueError("Khong tim thay bo de nao co ca de va dap an khop ten file.")

    rng = random.Random(args.seed)
    count = min(args.count, len(pool))
    quiz_items = rng.sample(pool, count)

    print(f"Tao quiz ngau nhien: {count} cau (tong pool: {len(pool)} cau)")
    print("-" * 70)

    correct = 0
    wrong: list[str] = []
    for idx, item in enumerate(quiz_items, start=1):
        print(f"\nCau {idx}/{count} - [{item.source_exam}] Q{item.q_num}")
        print(item.question)
        for key, text in item.options:
            print(f"  {key}. {text}")

        valid = {k for k, _ in item.options}
        user_choice = ask_answer(valid, item.choose_count)
        if user_choice == item.answer:
            correct += 1
            print("=> Dung")
        else:
            print("=> Sai")
            wrong.append(
                f"[{item.source_exam}] Q{item.q_num}: ban chon {','.join(sorted(user_choice))} | dap an {','.join(sorted(item.answer))}"
            )

    score10 = correct / count * 10
    print("\n" + "=" * 70)
    print(f"Ket qua: {correct}/{count} cau dung")
    print(f"Diem (thang 10): {score10:.2f}")
    if wrong:
        print("\nCac cau sai:")
        for line in wrong:
            print(f"- {line}")


if __name__ == "__main__":
    main()
