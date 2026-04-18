"""
Xuat file same-question.txt: cac nhom cau hoi gan giong nhau (logic dong bo voi quiz-web/src/similarQuestions.ts).
Chay tu thu muc goc repo: python export_same_questions.py
"""

from __future__ import annotations

import argparse
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from create_quiz import parse_question_file

DEFAULT_THRESHOLD = 0.86
CHOOSE_PARENS = re.compile(r"\(\s*choose[^)]{0,220}\)", re.IGNORECASE)


def strip_choose_parentheticals(s: str) -> str:
    t = s
    for _ in range(6):
        n = CHOOSE_PARENS.sub(" ", t)
        if n == t:
            break
        t = n
    return t


def normalize_for_compare(text: str) -> str:
    s = unicodedata.normalize("NFKC", text)
    s = re.sub(r"[\u200B-\u200D\uFEFF]", "", s)
    s = re.sub(r"[\u2018\u2019\u02BC\u00B4\u2032]", "'", s)
    s = re.sub(r"[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033]", '"', s)
    s = s.replace("\u2026", "...")
    s = re.sub(r"[\u2013\u2014\u2212]", "-", s)
    s = " ".join(s.split()).lower()
    s = strip_choose_parentheticals(s)
    s = s.replace("|", " ")
    s = "".join(" " if unicodedata.category(c).startswith("P") else c for c in s)
    s = " ".join(s.split()).strip()
    return s


def bigram_cosine_similarity(a: str, b: str) -> float:
    na, nb = normalize_for_compare(a), normalize_for_compare(b)
    if len(na) < 2 or len(nb) < 2:
        return 1.0 if na == nb else 0.0

    def counts(t: str) -> dict[str, int]:
        m: dict[str, int] = {}
        for i in range(len(t) - 1):
            bg = t[i : i + 2]
            m[bg] = m.get(bg, 0) + 1
        return m

    A, B = counts(na), counts(nb)
    dot = sum(va * B.get(k, 0) for k, va in A.items())
    sa = sum(v * v for v in A.values())
    sb = sum(v * v for v in B.values())
    if not sa or not sb:
        return 0.0
    return dot / (math.sqrt(sa) * math.sqrt(sb))


class UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1


@dataclass
class QRecord:
    source: str
    q_num: int
    question: str


def load_all_questions(questions_dir: Path) -> list[QRecord]:
    records: list[QRecord] = []
    for path in sorted(questions_dir.glob("*.txt")):
        try:
            parsed = parse_question_file(path)
        except OSError:
            continue
        for q_num, data in parsed.items():
            text = (data.get("question") or "").strip()
            if not text or len(text) < 15:
                continue
            records.append(QRecord(source=path.stem, q_num=q_num, question=text))
    return records


def cluster_similar(records: list[QRecord], threshold: float) -> list[list[int]]:
    n = len(records)
    if n < 2:
        return []

    uf = UnionFind(n)
    lengths = [len(normalize_for_compare(r.question)) for r in records]
    for i in range(n):
        for j in range(i + 1, n):
            li, lj = lengths[i], lengths[j]
            if li and lj:
                lo, hi = min(li, lj), max(li, lj)
                if hi > lo * 1.35 + 30:
                    continue
            if bigram_cosine_similarity(records[i].question, records[j].question) >= threshold:
                uf.union(i, j)

    buckets: dict[int, list[int]] = {}
    for i in range(n):
        r = uf.find(i)
        buckets.setdefault(r, []).append(i)

    groups: list[list[int]] = []
    for idxs in buckets.values():
        if len(idxs) < 2:
            continue
        g = sorted(idxs, key=lambda k: (records[k].source, records[k].q_num))
        groups.append(g)
    groups.sort(key=lambda g: (records[g[0]].source, records[g[0]].q_num))
    return groups


def hint_vs_reference(this_text: str, ref_text: str) -> str:
    a, b = normalize_for_compare(this_text), normalize_for_compare(ref_text)
    if a == b:
        return "(Giống câu mẫu)"
    wa = [x for x in a.split() if x]
    wb = [x for x in b.split() if x]
    n, m = len(wa), len(wb)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if wa[i - 1] == wb[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

    raw: list[str] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and wa[i - 1] == wb[j - 1]:
            i -= 1
            j -= 1
            continue
        if i > 0 and dp[i][j] == dp[i - 1][j]:
            raw.append(f"thêm '{wa[i - 1]}'")
            i -= 1
            continue
        if j > 0 and dp[i][j] == dp[i][j - 1]:
            raw.append(f"bỏ '{wb[j - 1]}'")
            j -= 1
            continue
        if i > 0:
            raw.append(f"thêm '{wa[i - 1]}'")
            i -= 1
        elif j > 0:
            raw.append(f"bỏ '{wb[j - 1]}'")
            j -= 1
        else:
            break

    parts = list(reversed(raw))
    merged: list[str] = []
    k = 0
    while k < len(parts):
        cur = parts[k]
        nxt = parts[k + 1] if k + 1 < len(parts) else None
        m1 = re.match(r"^thêm '(.+)'$", cur)
        m2 = re.match(r"^bỏ '(.+)'$", nxt or "")
        if m1 and m2 and nxt:
            merged.append(f"'{m2.group(1)}' → '{m1.group(1)}'")
            k += 2
            continue
        m3 = re.match(r"^bỏ '(.+)'$", cur)
        m4 = re.match(r"^thêm '(.+)'$", nxt or "")
        if m3 and m4 and nxt:
            merged.append(f"'{m3.group(1)}' → '{m4.group(1)}'")
            k += 2
            continue
        merged.append(cur)
        k += 1

    out = merged[:10]
    if not out:
        return "(Khác nhẹ)"
    return "; ".join(out)


def prune_identical_to_reference(
    records: list[QRecord], groups: list[list[int]]
) -> list[list[QRecord]]:
    out: list[list[QRecord]] = []
    for g in groups:
        items = [records[i] for i in g]
        items.sort(key=lambda x: (x.source, x.q_num))
        ref = items[0]
        n0 = normalize_for_compare(ref.question)
        filtered = [ref] + [q for q in items[1:] if normalize_for_compare(q.question) != n0]
        if len(filtered) >= 2:
            out.append(filtered)
    return out


def build_same_question_txt(pruned: list[list[QRecord]]) -> str:
    lines: list[str] = []
    for gi, group in enumerate(pruned, start=1):
        lines.append(f"===== NHÓM {gi} ({len(group)} câu gần giống) =====")
        for idx, r in enumerate(group):
            ref = group[0]
            if idx == 0:
                hint = "Câu mẫu trong nhóm — so sánh với các biến thể kế bên để thấy chỗ đổi chữ / số."
            else:
                hint = hint_vs_reference(r.question, ref.question)
            lines.append(f"[{r.source}] Q{r.q_num}")
            lines.append(r.question)
            lines.append(f"Hint: {hint}")
            lines.append("")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description="Xuất same-question.txt — câu gần giống từ nhiều file đề .txt")
    ap.add_argument(
        "--questions-dir",
        type=Path,
        default=Path("output_text"),
        help="Thư mục chứa file đề *.txt (mặc định: output_text)",
    )
    ap.add_argument(
        "--output",
        type=Path,
        default=Path("same-question.txt"),
        help="File kết quả (mặc định: same-question.txt)",
    )
    ap.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        help=f"Ngưỡng cosine bigram (mặc định: {DEFAULT_THRESHOLD})",
    )
    args = ap.parse_args()
    qdir: Path = args.questions_dir
    if not qdir.is_dir():
        raise SystemExit(f"Questions directory not found: {qdir}")

    records = load_all_questions(qdir)
    if len(records) < 2:
        args.output.write_text(
            f"(Không đủ câu hợp lệ trong {qdir} — cần ít nhất 2 câu, độ dài stem >= 15 ký tự.)\n",
            encoding="utf-8",
        )
        print(f"Wrote {args.output} (empty / notice).")
        return

    groups_idx = cluster_similar(records, args.threshold)
    pruned = prune_identical_to_reference(records, groups_idx)
    # prune_identical rebuilds from indices — already list[QRecord]
    text = build_same_question_txt(pruned)
    args.output.write_text(text, encoding="utf-8")
    n_groups = len(pruned)
    n_q = sum(len(g) for g in pruned)
    print(f"Wrote {args.output}: {n_groups} groups, {n_q} questions (after dropping identical-to-reference).")


if __name__ == "__main__":
    main()
