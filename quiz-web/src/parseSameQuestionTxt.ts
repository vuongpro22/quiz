import { parseAnswers, parseQuestions, type QuestionsMap } from "./parseQuiz";
import type { PoolQuestionItem } from "./randomQuizPool";
import type { SimilarSlide } from "./similarQuestions";

/** Một dòng câu trong same-question.txt (chưa gắn đáp án từ API). */
export type SameQuestionParsedRow = {
  examKey: string;
  qNum: number;
  questionFromFile: string;
  hint: string;
  groupIndex: number;
  indexInGroup: number;
  groupSize: number;
};

const HEADER_RE = /^===== NHÓM (\d+) \(\d+ câu gần giống\) =====\s*$/;
const TAG_RE = /^\[(.+?)\] Q(\d+)\s*$/i;

/**
 * Đọc same-question.txt (định dạng xuất từ export / chỉnh tay).
 * Mỗi câu: dòng `[examKey] Qn`, stem đến trước `Hint:`, rồi một dòng `Hint: ...`
 */
export function parseSameQuestionTxt(content: string): { rows: SameQuestionParsedRow[] } | { error: string } {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const rows: SameQuestionParsedRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const hm = HEADER_RE.exec(line);
    if (!hm) {
      i++;
      continue;
    }
    const groupIndex = parseInt(hm[1]!, 10);
    if (Number.isNaN(groupIndex)) {
      return { error: `Dòng header không hợp lệ: ${line}` };
    }
    i++;
    const buffer: Omit<SameQuestionParsedRow, "indexInGroup" | "groupSize">[] = [];

    while (i < lines.length) {
      const ln = lines[i] ?? "";
      if (HEADER_RE.test(ln)) break;

      const tm = TAG_RE.exec(ln);
      if (!tm) {
        i++;
        continue;
      }
      const examKey = tm[1]!.trim();
      const qNum = parseInt(tm[2]!, 10);
      if (Number.isNaN(qNum)) {
        return { error: `Số câu không hợp lệ: ${ln}` };
      }
      i++;

      while (i < lines.length && !(lines[i] ?? "").trim()) i++;

      const qParts: string[] = [];
      while (i < lines.length) {
        const q = lines[i] ?? "";
        if (HEADER_RE.test(q) || TAG_RE.test(q)) break;
        if (/^Hint:/i.test(q)) break;
        qParts.push(q);
        i++;
      }

      if (i >= lines.length || !/^Hint:/i.test(lines[i] ?? "")) {
        return { error: `Thiếu Hint: sau [${examKey}] Q${qNum}` };
      }
      const hint = (lines[i] ?? "").replace(/^Hint:\s*/i, "").trim();
      i++;

      while (i < lines.length && !(lines[i] ?? "").trim()) i++;

      buffer.push({
        examKey,
        qNum,
        questionFromFile: qParts.join("\n").trim(),
        hint,
        groupIndex,
      });
    }

    const groupSize = buffer.length;
    if (groupSize === 0) continue;
    buffer.forEach((e, idx) => {
      rows.push({
        ...e,
        indexInGroup: idx + 1,
        groupSize,
      });
    });
  }

  if (!rows.length) return { error: "Không parse được câu nào — kiểm tra same-question.txt." };
  return { rows };
}

export type ExamQaBundle = {
  questions: QuestionsMap;
  answers: Map<number, Set<string>>;
};

/** Ghép stem + hint từ file với options/đáp án lấy từ đề Mongo (theo examKey + Qn). */
export function mergeSameQuestionWithBundles(
  parsed: SameQuestionParsedRow[],
  bundles: Map<string, ExamQaBundle>
): { slides: SimilarSlide[] } | { error: string } {
  const slides: SimilarSlide[] = [];
  let idx = 0;
  for (const row of parsed) {
    const b = bundles.get(row.examKey);
    if (!b) return { error: `Thiếu đề trên server: "${row.examKey}" (có trong same-question.txt).` };
    const qd = b.questions[row.qNum];
    const ans = b.answers.get(row.qNum);
    if (!qd?.options?.length) {
      return { error: `Không có stem trong file đề: [${row.examKey}] Q${row.qNum}` };
    }
    if (!ans?.size) {
      return { error: `Không có đáp án: [${row.examKey}] Q${row.qNum}` };
    }
    const item: PoolQuestionItem = {
      id: `${row.examKey}::${row.qNum}::${idx}`,
      sourceExam: row.examKey,
      qNum: row.qNum,
      question: row.questionFromFile || qd.question,
      options: qd.options,
      chooseCount: qd.chooseCount,
      answer: new Set(ans),
    };
    slides.push({
      item,
      groupIndex: row.groupIndex,
      indexInGroup: row.indexInGroup,
      groupSize: row.groupSize,
      hint: row.hint,
    });
    idx++;
  }
  return { slides };
}

export function bundleFromExamDocument(doc: {
  questionsText: string;
  answersText: string;
  answersExtension?: string;
}): ExamQaBundle {
  const questions = parseQuestions(doc.questionsText);
  const ext = doc.answersExtension === "txt" ? ".txt" : ".csv";
  const answers = parseAnswers(doc.answersText, `bundle${ext}`);
  return { questions, answers };
}
