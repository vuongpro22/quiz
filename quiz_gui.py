import re
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox

from answer_csv import parse_answers_csv


DEFAULT_QUESTIONS = Path("C:/Users/binhv/Desktop/test/output_text/PMG201c - FA25 - RE.txt")
DEFAULT_ANSWERS = Path("C:/Users/binhv/Desktop/test/output_text/answer/PMG201c - FA25 - RE.txt")


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
        values = {part.strip().upper() for part in match.group(2).split(",")}
        answers[q_num] = values
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
    q_match = re.search(r"Question:\s*(\d+)\s*(.*)", block)
    if q_match:
        q_num = int(q_match.group(1))
        question_line = q_match.group(2).strip()
    else:
        q_num = fallback_q_num
        question_line = ""

    choose_match = re.search(r"\(Choose\s+(\d+)\s+answers?\)", block, flags=re.IGNORECASE)
    choose_count = int(choose_match.group(1)) if choose_match else 1

    option_pattern = re.compile(r"([A-F])\.\s*(.+?)(?=\n[A-F]\.\s|\Z)", re.DOTALL)
    options = []
    for key, text in option_pattern.findall(block):
        clean_text = " ".join(text.replace("\n", " ").split())
        options.append((key.upper(), clean_text))

    if not question_line:
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        for ln in lines:
            if ln.startswith("(") or re.match(r"^[A-F]\.", ln):
                continue
            question_line = ln
            break
        if not question_line:
            question_line = f"Question {q_num}"
    return q_num, question_line, options, choose_count


def parse_questions(question_path: Path) -> dict[int, dict]:
    questions: dict[int, dict] = {}
    content = question_path.read_text(encoding="utf-8")
    for header_q_num, block in split_question_blocks(content):
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


class QuizApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Quiz App")
        self.root.geometry("980x700")

        self.questions_path = tk.StringVar(value=str(DEFAULT_QUESTIONS))
        self.answers_path = tk.StringVar(value=str(DEFAULT_ANSWERS))

        self.questions: dict[int, dict] = {}
        self.answer_key: dict[int, set[str]] = {}
        self.q_numbers: list[int] = []
        self.current_idx = 0
        self.user_answers: dict[int, set[str]] = {}

        self._build_top_controls()
        self._build_quiz_area()
        self._build_nav_controls()
        self.root.bind("<Left>", self._on_arrow_left)
        self.root.bind("<Right>", self._on_arrow_right)

    @staticmethod
    def _focus_in_path_entry(widget) -> bool:
        """Do not steal Left/Right when user edits file path fields."""
        return isinstance(widget, tk.Entry)

    def _on_arrow_left(self, event) -> str | None:
        if self._focus_in_path_entry(self.root.focus_get()):
            return
        self.prev_question()
        return "break"

    def _on_arrow_right(self, event) -> str | None:
        if self._focus_in_path_entry(self.root.focus_get()):
            return
        self.next_question()
        return "break"

    def _build_top_controls(self) -> None:
        frame = tk.Frame(self.root, padx=10, pady=10)
        frame.pack(fill="x")

        tk.Label(frame, text="Questions file:").grid(row=0, column=0, sticky="w")
        tk.Entry(frame, textvariable=self.questions_path, width=90).grid(row=0, column=1, padx=6)
        tk.Button(frame, text="Browse", command=self.browse_questions).grid(row=0, column=2)

        tk.Label(frame, text="Answers file:").grid(row=1, column=0, sticky="w")
        tk.Entry(frame, textvariable=self.answers_path, width=90).grid(row=1, column=1, padx=6)
        tk.Button(frame, text="Browse", command=self.browse_answers).grid(row=1, column=2)

        tk.Button(frame, text="Load Quiz", command=self.load_quiz, bg="#4CAF50", fg="white").grid(
            row=2, column=1, pady=8, sticky="w"
        )
        tk.Button(frame, text="Flashcard Mode", command=self.open_flashcards, bg="#FF9800", fg="white").grid(
            row=2, column=1, pady=8, padx=(110, 0), sticky="w"
        )

    def _build_quiz_area(self) -> None:
        self.content = tk.Frame(self.root, padx=12, pady=8)
        self.content.pack(fill="both", expand=True)

        self.progress_label = tk.Label(self.content, text="Chua load quiz", font=("Segoe UI", 11, "bold"))
        self.progress_label.pack(anchor="w")

        self.question_label = tk.Label(
            self.content, text="", justify="left", wraplength=920, font=("Segoe UI", 11)
        )
        self.question_label.pack(anchor="w", pady=(8, 10))

        self.options_frame = tk.Frame(self.content)
        self.options_frame.pack(fill="x")

        self.single_answer_var = tk.StringVar(value="")
        self.multi_answer_vars: dict[str, tk.BooleanVar] = {}
        self.option_widgets: list[tk.Widget] = []

    def _build_nav_controls(self) -> None:
        nav = tk.Frame(self.root, padx=12, pady=10)
        nav.pack(fill="x")

        self.prev_btn = tk.Button(nav, text="<< Prev", command=self.prev_question, state="disabled")
        self.prev_btn.pack(side="left")

        self.next_btn = tk.Button(nav, text="Next >>", command=self.next_question, state="disabled")
        self.next_btn.pack(side="left", padx=8)

        self.submit_btn = tk.Button(
            nav, text="Submit & Grade", command=self.submit_quiz, state="disabled", bg="#2196F3", fg="white"
        )
        self.submit_btn.pack(side="left")

    def browse_questions(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("Text files", "*.txt"), ("All files", "*.*")])
        if path:
            self.questions_path.set(path)

    def browse_answers(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("Answer files", "*.txt *.csv"), ("All files", "*.*")])
        if path:
            self.answers_path.set(path)

    def load_quiz(self) -> None:
        try:
            q_path = Path(self.questions_path.get().strip())
            a_path = Path(self.answers_path.get().strip())
            if not q_path.exists():
                raise FileNotFoundError(f"Khong tim thay file de: {q_path}")
            if not a_path.exists():
                raise FileNotFoundError(f"Khong tim thay file dap an: {a_path}")

            self.questions = parse_questions(q_path)
            self.answer_key = parse_answers(a_path)
            self.q_numbers = sorted(set(self.questions.keys()) & set(self.answer_key.keys()))

            if not self.q_numbers:
                raise ValueError("Khong co cau nao khop giua de va dap an.")

            self.current_idx = 0
            self.user_answers = {}
            self.prev_btn.config(state="normal")
            self.next_btn.config(state="normal")
            self.submit_btn.config(state="normal")
            self.show_question()
        except Exception as exc:
            messagebox.showerror("Loi", str(exc))

    def save_current_answer(self) -> None:
        if not self.q_numbers:
            return
        q_num = self.q_numbers[self.current_idx]
        choose_count = self.questions[q_num]["choose_count"]
        if choose_count == 1:
            value = self.single_answer_var.get().strip().upper()
            self.user_answers[q_num] = {value} if value else set()
        else:
            picked = {key for key, var in self.multi_answer_vars.items() if var.get()}
            self.user_answers[q_num] = picked

    def restore_current_answer(self) -> None:
        q_num = self.q_numbers[self.current_idx]
        choose_count = self.questions[q_num]["choose_count"]
        saved = self.user_answers.get(q_num, set())
        if choose_count == 1:
            self.single_answer_var.set(next(iter(saved), ""))
        else:
            for key, var in self.multi_answer_vars.items():
                var.set(key in saved)

    def clear_option_widgets(self) -> None:
        for widget in self.option_widgets:
            widget.destroy()
        self.option_widgets.clear()
        self.multi_answer_vars = {}
        self.single_answer_var.set("")

    def show_question(self) -> None:
        self.clear_option_widgets()
        q_num = self.q_numbers[self.current_idx]
        data = self.questions[q_num]
        total = len(self.q_numbers)

        self.progress_label.config(text=f"Cau {self.current_idx + 1}/{total} (Q{q_num})")
        self.question_label.config(text=data["question"])

        choose_count = data["choose_count"]
        hint = tk.Label(
            self.options_frame,
            text=f"Chon {choose_count} dap an",
            fg="#555",
            font=("Segoe UI", 10, "italic"),
        )
        hint.pack(anchor="w", pady=(0, 8))
        self.option_widgets.append(hint)

        if choose_count == 1:
            for key, text in data["options"]:
                rb = tk.Radiobutton(
                    self.options_frame,
                    text=f"{key}. {text}",
                    variable=self.single_answer_var,
                    value=key,
                    justify="left",
                    wraplength=920,
                    anchor="w",
                )
                rb.pack(anchor="w", fill="x")
                self.option_widgets.append(rb)
        else:
            for key, text in data["options"]:
                var = tk.BooleanVar(value=False)
                self.multi_answer_vars[key] = var
                cb = tk.Checkbutton(
                    self.options_frame,
                    text=f"{key}. {text}",
                    variable=var,
                    justify="left",
                    wraplength=920,
                    anchor="w",
                )
                cb.pack(anchor="w", fill="x")
                self.option_widgets.append(cb)

        self.restore_current_answer()

    def prev_question(self) -> None:
        if not self.q_numbers:
            return
        self.save_current_answer()
        if self.current_idx > 0:
            self.current_idx -= 1
            self.show_question()

    def next_question(self) -> None:
        if not self.q_numbers:
            return
        self.save_current_answer()
        if self.current_idx < len(self.q_numbers) - 1:
            self.current_idx += 1
            self.show_question()

    def submit_quiz(self) -> None:
        if not self.q_numbers:
            return
        self.save_current_answer()

        correct = 0
        wrong_lines = []
        for q_num in self.q_numbers:
            user = self.user_answers.get(q_num, set())
            key = self.answer_key[q_num]
            if user == key:
                correct += 1
            else:
                user_text = ",".join(sorted(user)) if user else "(blank)"
                key_text = ",".join(sorted(key))
                wrong_lines.append(f"Q{q_num}: ban chon {user_text} | dap an {key_text}")

        total = len(self.q_numbers)
        score10 = (correct / total) * 10
        message = f"Dung {correct}/{total} cau\nDiem (thang 10): {score10:.2f}"
        if wrong_lines:
            message += "\n\nCau sai:\n- " + "\n- ".join(wrong_lines[:20])
            if len(wrong_lines) > 20:
                message += f"\n... va {len(wrong_lines) - 20} cau sai khac"
        messagebox.showinfo("Ket qua", message)

    def open_flashcards(self) -> None:
        try:
            q_path = Path(self.questions_path.get().strip())
            a_path = Path(self.answers_path.get().strip())
            if not q_path.exists():
                raise FileNotFoundError(f"Khong tim thay file de: {q_path}")
            if not a_path.exists():
                raise FileNotFoundError(f"Khong tim thay file dap an: {a_path}")

            questions = parse_questions(q_path)
            answer_key = parse_answers(a_path)
            q_numbers = sorted(set(questions.keys()) & set(answer_key.keys()))
            if not q_numbers:
                raise ValueError("Khong co cau nao khop giua de va dap an.")

            FlashcardWindow(self.root, questions, answer_key, q_numbers)
        except Exception as exc:
            messagebox.showerror("Loi", str(exc))


class FlashcardWindow:
    def __init__(self, parent: tk.Tk, questions: dict[int, dict], answer_key: dict[int, set[str]], q_numbers: list[int]) -> None:
        self.questions = questions
        self.answer_key = answer_key
        self.q_numbers = q_numbers
        self.index = 0
        self.answer_visible = False

        self.win = tk.Toplevel(parent)
        self.win.title("Flashcard Mode")
        self.win.geometry("980x700")

        self.progress = tk.Label(self.win, text="", font=("Segoe UI", 11, "bold"))
        self.progress.pack(anchor="w", padx=12, pady=(12, 4))

        self.question_label = tk.Label(
            self.win, text="", justify="left", wraplength=920, font=("Segoe UI", 11)
        )
        self.question_label.pack(anchor="w", padx=12, pady=(4, 8))

        self.options_label = tk.Label(
            self.win, text="", justify="left", wraplength=920, font=("Segoe UI", 10)
        )
        self.options_label.pack(anchor="w", padx=12, pady=(0, 10))

        self.answer_label = tk.Label(
            self.win, text="Dap an: (an)", justify="left", wraplength=920, font=("Segoe UI", 11, "bold"), fg="#1b5e20"
        )
        self.answer_label.pack(anchor="w", padx=12, pady=(0, 12))

        nav = tk.Frame(self.win, padx=12, pady=10)
        nav.pack(fill="x")

        tk.Button(nav, text="<< Prev", command=self.prev_card).pack(side="left")
        tk.Button(nav, text="Next >>", command=self.next_card).pack(side="left", padx=8)
        tk.Button(nav, text="Hien dap an", command=self.toggle_answer, bg="#2196F3", fg="white").pack(
            side="left", padx=8
        )

        self.render_card()
        self.win.bind("<Left>", self._on_flash_left)
        self.win.bind("<Right>", self._on_flash_right)
        self.win.bind("<Return>", self._on_flash_enter)
        self.win.bind("<KP_Enter>", self._on_flash_enter)

    def _on_flash_enter(self, event) -> str | None:
        self.toggle_answer()
        return "break"

    def _on_flash_left(self, event) -> str | None:
        self.prev_card()
        return "break"

    def _on_flash_right(self, event) -> str | None:
        self.next_card()
        return "break"

    def render_card(self) -> None:
        q_num = self.q_numbers[self.index]
        data = self.questions[q_num]
        total = len(self.q_numbers)
        self.progress.config(text=f"Flashcard {self.index + 1}/{total} (Q{q_num})")
        self.question_label.config(text=data["question"])

        option_lines = [f"{key}. {text}" for key, text in data["options"]]
        self.options_label.config(text="\n".join(option_lines))

        if self.answer_visible:
            answer = ",".join(sorted(self.answer_key[q_num]))
            self.answer_label.config(text=f"Dap an: {answer}")
        else:
            self.answer_label.config(text="Dap an: (an)")

    def toggle_answer(self) -> None:
        self.answer_visible = not self.answer_visible
        self.render_card()

    def prev_card(self) -> None:
        if self.index > 0:
            self.index -= 1
            self.answer_visible = False
            self.render_card()

    def next_card(self) -> None:
        if self.index < len(self.q_numbers) - 1:
            self.index += 1
            self.answer_visible = False
            self.render_card()


def main() -> None:
    root = tk.Tk()
    app = QuizApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
