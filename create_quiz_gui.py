"""
GUI: quiz ngau nhien tu nhieu file de (output_text) + dap an (answer) cung ten file.
Chay: python create_quiz_gui.py
"""

import random
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox

from create_quiz import QuestionItem, build_pool


DEFAULT_QUESTIONS_DIR = Path("output_text")
DEFAULT_ANSWERS_DIR = Path("answer")


class CreateQuizGui:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Random Quiz (nhieu de)")
        self.root.geometry("1000x720")

        self.questions_dir = tk.StringVar(value=str(DEFAULT_QUESTIONS_DIR))
        self.answers_dir = tk.StringVar(value=str(DEFAULT_ANSWERS_DIR))
        self.count_var = tk.StringVar(value="20")
        self.seed_var = tk.StringVar(value="")

        self.pool: list[QuestionItem] = []
        self.quiz_items: list[QuestionItem] = []
        self.current_idx = 0
        self.user_answers: dict[int, set[str]] = {}

        self.single_answer_var = tk.StringVar(value="")
        self.multi_answer_vars: dict[str, tk.BooleanVar] = {}
        self.option_widgets: list[tk.Widget] = []

        self._build_setup_frame()
        self._build_quiz_frame()
        self._build_nav_frame()

        # bind_all: hoat dong ca khi focus o Radio/Checkbutton (root.bind thi khong nhan)
        self.root.bind_all("<Left>", self._on_arrow_left)
        self.root.bind_all("<Right>", self._on_arrow_right)
        self.root.bind_all("<Return>", self._on_enter_submit)
        self.root.bind_all("<KP_Enter>", self._on_enter_submit)
        self.root.bind_all("<Key>", self._on_key_letter)

    def _build_setup_frame(self) -> None:
        self.setup = tk.LabelFrame(self.root, text="Cau hinh", padx=10, pady=8)
        self.setup.pack(fill="x", padx=10, pady=8)

        tk.Label(self.setup, text="Thu muc de (output_text):").grid(row=0, column=0, sticky="w")
        tk.Entry(self.setup, textvariable=self.questions_dir, width=85).grid(row=0, column=1, padx=6)
        tk.Button(self.setup, text="Browse", command=self.browse_questions_dir).grid(row=0, column=2)

        tk.Label(self.setup, text="Thu muc dap an (answer):").grid(row=1, column=0, sticky="w")
        tk.Entry(self.setup, textvariable=self.answers_dir, width=85).grid(row=1, column=1, padx=6)
        tk.Button(self.setup, text="Browse", command=self.browse_answers_dir).grid(row=1, column=2)

        tk.Label(self.setup, text="So cau ngau nhien:").grid(row=2, column=0, sticky="w")
        tk.Entry(self.setup, textvariable=self.count_var, width=10).grid(row=2, column=1, sticky="w", padx=6)

        tk.Label(self.setup, text="Seed (tuy chon, de lap lai bo):").grid(row=3, column=0, sticky="w")
        tk.Entry(self.setup, textvariable=self.seed_var, width=15).grid(row=3, column=1, sticky="w", padx=6)

        self.pool_label = tk.Label(self.setup, text="Chua tai pool", fg="#555")
        self.pool_label.grid(row=4, column=1, sticky="w", pady=(6, 0))

        tk.Button(
            self.setup,
            text="Start Random Quiz",
            command=self.start_quiz,
            bg="#4CAF50",
            fg="white",
            font=("Segoe UI", 10, "bold"),
        ).grid(row=5, column=1, sticky="w", pady=10)

        hint = tk.Label(
            self.setup,
            text="Phim (khi dang lam bai): <- / -> | A-F | Enter (ke ca khi con tro trong o so cau)",
            fg="#666",
            font=("Segoe UI", 9),
        )
        hint.grid(row=6, column=1, sticky="w", pady=(0, 4))

    def _skip_shortcuts_for_entry(self) -> bool:
        """Chi khi CHUA bat dau quiz: giu phim cho o Entry. Khi dang lam bai: luon dung phim cho quiz."""
        if self.quiz_items:
            return False
        return isinstance(self.root.focus_get(), tk.Entry)

    def _build_quiz_frame(self) -> None:
        self.quiz_area = tk.Frame(self.root, padx=12, pady=8, takefocus=True)
        self.quiz_area.pack(fill="both", expand=True)

        self.progress_label = tk.Label(self.quiz_area, text="", font=("Segoe UI", 11, "bold"))
        self.progress_label.pack(anchor="w")

        self.meta_label = tk.Label(self.quiz_area, text="", fg="#555", font=("Segoe UI", 9))
        self.meta_label.pack(anchor="w")

        self.question_label = tk.Label(
            self.quiz_area, text="", justify="left", wraplength=960, font=("Segoe UI", 11)
        )
        self.question_label.pack(anchor="w", pady=(8, 10))

        self.options_frame = tk.Frame(self.quiz_area)
        self.options_frame.pack(fill="x")

    def _build_nav_frame(self) -> None:
        nav = tk.Frame(self.root, padx=12, pady=10)
        nav.pack(fill="x")

        self.prev_btn = tk.Button(nav, text="<< Prev", command=self.prev_question, state="disabled")
        self.prev_btn.pack(side="left")

        self.next_btn = tk.Button(nav, text="Next >>", command=self.next_question, state="disabled")
        self.next_btn.pack(side="left", padx=8)

        self.submit_btn = tk.Button(
            nav,
            text="Submit & Grade",
            command=self.submit_quiz,
            state="disabled",
            bg="#2196F3",
            fg="white",
        )
        self.submit_btn.pack(side="left", padx=8)

    def _on_arrow_left(self, event) -> str | None:
        if self._skip_shortcuts_for_entry():
            return
        self.prev_question()
        return "break"

    def _on_arrow_right(self, event) -> str | None:
        if self._skip_shortcuts_for_entry():
            return
        self.next_question()
        return "break"

    def _on_enter_submit(self, event) -> str | None:
        if self._skip_shortcuts_for_entry():
            return
        if not self.quiz_items:
            return
        self.submit_quiz()
        return "break"

    def _on_key_letter(self, event) -> str | None:
        if self._skip_shortcuts_for_entry():
            return
        if not self.quiz_items:
            return
        char = (event.char or "").upper()
        if len(char) != 1 or char not in "ABCDEF":
            return
        item = self.quiz_items[self.current_idx]
        valid = {k for k, _ in item.options}
        if char not in valid:
            return
        if item.choose_count == 1:
            self.single_answer_var.set(char)
        elif char in self.multi_answer_vars:
            var = self.multi_answer_vars[char]
            var.set(not var.get())
        return "break"

    def browse_questions_dir(self) -> None:
        path = filedialog.askdirectory()
        if path:
            self.questions_dir.set(path)

    def browse_answers_dir(self) -> None:
        path = filedialog.askdirectory()
        if path:
            self.answers_dir.set(path)

    def start_quiz(self) -> None:
        try:
            q_dir = Path(self.questions_dir.get().strip())
            a_dir = Path(self.answers_dir.get().strip())
            if not q_dir.is_dir():
                raise FileNotFoundError(f"Khong tim thay thu muc de: {q_dir}")
            if not a_dir.is_dir():
                raise FileNotFoundError(f"Khong tim thay thu muc dap an: {a_dir}")

            self.pool = build_pool(q_dir, a_dir)
            if not self.pool:
                raise ValueError("Khong co cau nao: can file de .txt va dap an cung ten trong answer.")

            raw_count = self.count_var.get().strip()
            n = int(raw_count) if raw_count else 20
            if n < 1:
                raise ValueError("So cau phai >= 1")

            seed_raw = self.seed_var.get().strip()
            seed = int(seed_raw) if seed_raw else None
            rng = random.Random(seed)

            count = min(n, len(self.pool))
            self.quiz_items = rng.sample(self.pool, count)
            self.current_idx = 0
            self.user_answers = {}

            self.pool_label.config(
                text=f"Pool: {len(self.pool)} cau hop le | Quiz: {count} cau ngau nhien"
            )

            self.prev_btn.config(state="normal")
            self.next_btn.config(state="normal")
            self.submit_btn.config(state="normal")
            self.show_question()
            self.quiz_area.focus_set()
        except Exception as exc:
            messagebox.showerror("Loi", str(exc))

    def save_current_answer(self) -> None:
        if not self.quiz_items:
            return
        item = self.quiz_items[self.current_idx]
        key = id(item)
        if item.choose_count == 1:
            val = self.single_answer_var.get().strip().upper()
            self.user_answers[key] = {val} if val else set()
        else:
            picked = {k for k, v in self.multi_answer_vars.items() if v.get()}
            self.user_answers[key] = picked

    def restore_current_answer(self) -> None:
        item = self.quiz_items[self.current_idx]
        key = id(item)
        saved = self.user_answers.get(key, set())
        if item.choose_count == 1:
            self.single_answer_var.set(next(iter(saved), ""))
        else:
            for k, var in self.multi_answer_vars.items():
                var.set(k in saved)

    def clear_options(self) -> None:
        for w in self.option_widgets:
            w.destroy()
        self.option_widgets.clear()
        self.multi_answer_vars = {}
        self.single_answer_var.set("")

    def show_question(self) -> None:
        self.clear_options()
        if not self.quiz_items:
            return

        item = self.quiz_items[self.current_idx]
        total = len(self.quiz_items)

        self.progress_label.config(text=f"Cau {self.current_idx + 1}/{total}")
        self.meta_label.config(text=f"[{item.source_exam}]  Q{item.q_num}  |  Chon {item.choose_count} dap an")
        self.question_label.config(text=item.question)

        choose_count = item.choose_count
        hint = tk.Label(
            self.options_frame,
            text=f"Chon {choose_count} dap an",
            fg="#555",
            font=("Segoe UI", 10, "italic"),
        )
        hint.pack(anchor="w", pady=(0, 8))
        self.option_widgets.append(hint)

        if choose_count == 1:
            for key, text in item.options:
                rb = tk.Radiobutton(
                    self.options_frame,
                    text=f"{key}. {text}",
                    variable=self.single_answer_var,
                    value=key,
                    justify="left",
                    wraplength=960,
                    anchor="w",
                )
                rb.pack(anchor="w", fill="x")
                self.option_widgets.append(rb)
        else:
            for key, text in item.options:
                var = tk.BooleanVar(value=False)
                self.multi_answer_vars[key] = var
                cb = tk.Checkbutton(
                    self.options_frame,
                    text=f"{key}. {text}",
                    variable=var,
                    justify="left",
                    wraplength=960,
                    anchor="w",
                )
                cb.pack(anchor="w", fill="x")
                self.option_widgets.append(cb)

        self.restore_current_answer()
        if self.quiz_items:
            self.quiz_area.focus_set()

    def prev_question(self) -> None:
        if not self.quiz_items:
            return
        self.save_current_answer()
        if self.current_idx > 0:
            self.current_idx -= 1
            self.show_question()

    def next_question(self) -> None:
        if not self.quiz_items:
            return
        self.save_current_answer()
        if self.current_idx < len(self.quiz_items) - 1:
            self.current_idx += 1
            self.show_question()

    def submit_quiz(self) -> None:
        if not self.quiz_items:
            return
        self.save_current_answer()

        correct = 0
        wrong_lines: list[str] = []
        for item in self.quiz_items:
            key = id(item)
            user = self.user_answers.get(key, set())
            if user == item.answer:
                correct += 1
            else:
                u = ",".join(sorted(user)) if user else "(blank)"
                a = ",".join(sorted(item.answer))
                wrong_lines.append(f"[{item.source_exam}] Q{item.q_num}: ban {u} | dap an {a}")

        total = len(self.quiz_items)
        score10 = (correct / total) * 10 if total else 0.0
        msg = f"Dung {correct}/{total} cau\nDiem (thang 10): {score10:.2f}"
        if wrong_lines:
            msg += "\n\nCau sai:\n- " + "\n- ".join(wrong_lines[:25])
            if len(wrong_lines) > 25:
                msg += f"\n... va {len(wrong_lines) - 25} cau nua"
        messagebox.showinfo("Ket qua", msg)


def main() -> None:
    root = tk.Tk()
    CreateQuizGui(root)
    root.mainloop()


if __name__ == "__main__":
    main()
