import {
  intersectQuestionNumbers,
  parseAnswers,
  parseQuestions,
  type QuestionsMap,
} from "./parseQuiz";

/** Một câu trong pool (nhiều bộ đề), giống create_quiz.QuestionItem */
export type PoolQuestionItem = {
  id: string;
  sourceExam: string;
  qNum: number;
  question: string;
  options: [string, string][];
  chooseCount: number;
  answer: Set<string>;
};

export type ExamDocument = {
  examKey: string;
  questionsText: string;
  answersText: string;
  answersExtension?: string;
};

export function buildPoolFromExamDocuments(docs: ExamDocument[]): PoolQuestionItem[] {
  const pool: PoolQuestionItem[] = [];
  for (const doc of docs) {
    const qMap: QuestionsMap = parseQuestions(doc.questionsText);
    const ext = doc.answersExtension === "txt" ? ".txt" : ".csv";
    const answers = parseAnswers(doc.answersText, `bundle${ext}`);
    const nums = intersectQuestionNumbers(qMap, answers);
    for (const qNum of nums) {
      const data = qMap[qNum];
      if (!data?.options?.length) continue;
      const ans = answers.get(qNum);
      if (!ans?.size) continue;
      pool.push({
        id: `${doc.examKey}::${qNum}`,
        sourceExam: doc.examKey,
        qNum,
        question: data.question,
        options: data.options,
        chooseCount: data.chooseCount,
        answer: new Set(ans),
      });
    }
  }
  return pool;
}

/** RNG giống random.Random — shuffle Fisher–Yates rồi lấy n phần tử đầu (sample không lặp). */
function makeRng(seed: number | undefined): () => number {
  if (seed === undefined) return Math.random;
  let a = seed >>> 0;
  return function mulberry32() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function samplePool<T>(pool: T[], count: number, seed?: number): T[] {
  const n = Math.min(Math.max(0, count), pool.length);
  if (n === 0) return [];
  const rng = makeRng(seed);
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx.slice(0, n).map((i) => pool[i]!);
}
