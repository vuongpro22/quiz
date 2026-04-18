import { useCallback, useEffect, useRef, useState } from "react";
import { RandomQuizSection } from "./RandomQuizSection";
import { SimilarQuizPanel } from "./SimilarQuizPanel";
import "./App.css";
import type { QuestionsMap } from "./parseQuiz";
import {
  intersectQuestionNumbers,
  parseAnswers,
  parseQuestions,
  setsEqual,
} from "./parseQuiz";
import type { ExamDocument } from "./randomQuizPool";
import {
  bundleFromExamDocument,
  mergeSameQuestionWithBundles,
  parseSameQuestionTxt,
  type ExamQaBundle,
} from "./parseSameQuestionTxt";
import type { SimilarSlide } from "./similarQuestions";

type View = "setup" | "quiz" | "flashcard" | "study" | "similar";

type HomeTab = "single" | "random";

type ExamListItem = { _id: string; examKey: string; updatedAt?: string; questionCount?: number };

type LearnMode = "quiz" | "flashcard" | "study" | "similar";

const STUDY_BATCH_SIZE = 5;

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

const CARD_THEMES = [
  { variant: "learning-card--blue", stat: "learning-card__stat-val--blue" },
  { variant: "learning-card--purple", stat: "learning-card__stat-val--purple" },
  { variant: "learning-card--orange", stat: "learning-card__stat-val--orange" },
] as const;

const CARD_BADGE = "Trung cấp";

function examCardDescription(examKey: string): string {
  return `Câu hỏi trắc nghiệm đã OCR và đồng bộ đáp án. Phù hợp ôn tập theo từng kỳ — ${examKey}.`;
}

function estimateMinutes(questionCount: number | undefined): number {
  const n = questionCount && questionCount > 0 ? questionCount : 25;
  return Math.max(5, Math.round(n * 0.6));
}

function StartArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

function userPickToSet(pick: string[] | undefined): Set<string> {
  return new Set((pick ?? []).map((x) => x.toUpperCase()));
}

function normalizeTfText(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z]/g, "");
}

function isTrueFalseQuestion(options: [string, string][]): boolean {
  if (options.length !== 2) return false;
  const texts = new Set(options.map(([, text]) => normalizeTfText(text)));
  return texts.has("true") && texts.has("false");
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export default function App() {
  const [homeTab, setHomeTab] = useState<HomeTab>("single");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("setup");

  const [serverExams, setServerExams] = useState<ExamListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [serverLoading, setServerLoading] = useState(false);
  const [learnMode, setLearnMode] = useState<LearnMode>("quiz");
  const examsListReadyRef = useRef(false);

  const [questions, setQuestions] = useState<QuestionsMap>({});
  const [answerKey, setAnswerKey] = useState<Map<number, Set<string>>>(new Map());
  const [allQNumbers, setAllQNumbers] = useState<number[]>([]);
  const [qNumbers, setQNumbers] = useState<number[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string[]>>({});
  const [trueFalseOnlyActive, setTrueFalseOnlyActive] = useState(false);

  const [flashIdx, setFlashIdx] = useState(0);
  const [answerVisible, setAnswerVisible] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [studyRound, setStudyRound] = useState(1);
  const [studyRoundNums, setStudyRoundNums] = useState<number[]>([]);
  const [studyQueue, setStudyQueue] = useState<number[]>([]);
  const [studyWrongInLastRound, setStudyWrongInLastRound] = useState(0);
  const [studyLocked, setStudyLocked] = useState<Record<number, boolean>>({});

  const [similarSlides, setSimilarSlides] = useState<SimilarSlide[]>([]);

  const applyBundle = useCallback(
    (qText: string, aText: string, answersVirtualFileName: string): number[] | null => {
      const qs = parseQuestions(qText);
      const ans = parseAnswers(aText, answersVirtualFileName);
      const nums = intersectQuestionNumbers(qs, ans);
      if (!nums.length) {
        setError("Không có câu nào khớp giữa đề và đáp án (kiểm tra số thứ tự câu).");
        return null;
      }
      setQuestions(qs);
      setAnswerKey(ans);
      setAllQNumbers(nums);
      setQNumbers(nums);
      setTrueFalseOnlyActive(false);
      setCurrentIdx(0);
      setUserAnswers({});
      setFlashIdx(0);
      setAnswerVisible(false);
      setStudyRound(1);
      setStudyRoundNums([]);
      setStudyQueue([]);
      setStudyWrongInLastRound(0);
      setStudyLocked({});
      setError(null);
      return nums;
    },
    []
  );

  const startStudySession = useCallback((nums: number[]) => {
    const initialRound = nums.slice(0, STUDY_BATCH_SIZE);
    const rest = nums.slice(initialRound.length);
    setStudyRound(1);
    setStudyRoundNums(initialRound);
    setStudyQueue(rest);
    setStudyWrongInLastRound(0);
    setCurrentIdx(0);
    setUserAnswers({});
    setStudyLocked({});
    setView("study");
  }, []);

  useEffect(() => {
    if (view !== "setup") return;
    let cancelled = false;
    const showSpinner = !examsListReadyRef.current;
    if (showSpinner) setListLoading(true);
    (async () => {
      try {
        const r = await fetch(apiUrl("/api/exams"));
        if (!r.ok) {
          if (!cancelled) setServerExams([]);
          return;
        }
        const data = (await r.json()) as ExamListItem[];
        if (!cancelled) setServerExams(Array.isArray(data) ? data : []);
        if (!cancelled) examsListReadyRef.current = true;
      } catch {
        if (!cancelled) setServerExams([]);
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  const startExamFromCard = useCallback(
    async (examId: string, mode: Exclude<LearnMode, "similar">) => {
      setServerLoading(true);
      setError(null);
      try {
        const r = await fetch(apiUrl(`/api/exams/${examId}`));
        if (!r.ok) {
          setError(`Không tải được đề (${r.status}).`);
          return;
        }
        const doc = (await r.json()) as {
          questionsText: string;
          answersText: string;
          answersExtension?: string;
        };
        const ext = doc.answersExtension === "txt" ? ".txt" : ".csv";
        const nums = applyBundle(doc.questionsText, doc.answersText, `mongo${ext}`);
        if (!nums) return;
        if (mode === "quiz") {
          setView("quiz");
        } else if (mode === "flashcard") {
          setFlashIdx(0);
          setAnswerVisible(false);
          setView("flashcard");
        } else {
          startStudySession(nums);
        }
      } catch {
        setError("Lỗi kết nối API (server có chạy không?).");
      } finally {
        setServerLoading(false);
      }
    },
    [applyBundle, startStudySession]
  );

  const startSimilarPractice = useCallback(async () => {
    setServerLoading(true);
    setError(null);
    try {
      const txtUrl = `${import.meta.env.BASE_URL}same-question.txt`;
      const txtRes = await fetch(txtUrl);
      if (!txtRes.ok) {
        setError(
          `Không tải được same-question.txt (${txtRes.status}). Trong thư mục quiz-web chạy: npm run sync-same-question (file nguồn: same-question.txt ở thư mục cha).`
        );
        return;
      }
      const raw = await txtRes.text();
      const parsed = parseSameQuestionTxt(raw);
      if ("error" in parsed) {
        setError(parsed.error);
        return;
      }
      const { rows } = parsed;
      if (!rows.length) {
        setError("same-question.txt không có câu nào.");
        return;
      }

      const listRes = await fetch(apiUrl("/api/exams"));
      if (!listRes.ok) {
        setError(`Không đọc được danh sách đề (${listRes.status}).`);
        return;
      }
      const list = (await listRes.json()) as ExamListItem[];
      if (!Array.isArray(list) || !list.length) {
        setError("Chưa có bộ đề nào trên server — cần API để lấy đáp án theo [tên đề] Qn.");
        return;
      }
      const keyToId = new Map(list.map((e) => [e.examKey, e._id] as const));
      const neededKeys = [...new Set(rows.map((r) => r.examKey))];
      const bundles = new Map<string, ExamQaBundle>();
      for (const examKey of neededKeys) {
        const id = keyToId.get(examKey);
        if (!id) {
          setError(`Đề "${examKey}" có trong same-question.txt nhưng không có trên server (import Mongo).`);
          return;
        }
        const r = await fetch(apiUrl(`/api/exams/${id}`));
        if (!r.ok) {
          setError(`Không tải được đề "${examKey}" (${r.status}).`);
          return;
        }
        const doc = (await r.json()) as ExamDocument;
        bundles.set(examKey, bundleFromExamDocument(doc));
      }

      const merged = mergeSameQuestionWithBundles(rows, bundles);
      if ("error" in merged) {
        setError(merged.error);
        return;
      }
      setSimilarSlides(merged.slides);
      setView("similar");
    } catch {
      setError("Lỗi tải same-question.txt hoặc API.");
    } finally {
      setServerLoading(false);
    }
  }, []);

  const activeNumbers = view === "study" ? studyRoundNums : qNumbers;
  const qNum = activeNumbers[currentIdx];
  const currentQ = qNum !== undefined ? questions[qNum] : undefined;
  const currentCorrectSet = qNum !== undefined ? answerKey.get(qNum) ?? new Set<string>() : new Set<string>();
  const trueFalseNumbers = allQNumbers.filter((n) => {
    const data = questions[n];
    return !!data && isTrueFalseQuestion(data.options);
  });

  const saveSingle = (letter: string) => {
    if (qNum === undefined) return;
    if (view === "study" && studyLocked[qNum]) return;
    setUserAnswers((prev) => ({ ...prev, [qNum]: letter ? [letter.toUpperCase()] : [] }));
    if (view === "study") {
      setStudyLocked((prev) => ({ ...prev, [qNum]: true }));
    }
  };

  const toggleMulti = (letter: string) => {
    if (qNum === undefined) return;
    if (view === "study" && studyLocked[qNum]) return;
    const upper = letter.toUpperCase();
    const chooseCount = currentQ?.chooseCount ?? 1;
    setUserAnswers((prev) => {
      const cur = new Set(prev[qNum] ?? []);
      if (cur.has(upper)) cur.delete(upper);
      else cur.add(upper);
      if (view === "study" && cur.size >= chooseCount) {
        setStudyLocked((locked) => ({ ...locked, [qNum]: true }));
      }
      return { ...prev, [qNum]: [...cur].sort() };
    });
  };

  const goPrev = () => {
    if (currentIdx > 0) setCurrentIdx((i) => i - 1);
  };

  const goNext = () => {
    if (view === "study" && currentIdx >= activeNumbers.length - 1) {
      submitStudyRound();
      return;
    }
    if (currentIdx < activeNumbers.length - 1) setCurrentIdx((i) => i + 1);
  };

  const submitQuiz = () => {
    let correct = 0;
    const wrong: string[] = [];
    for (const num of qNumbers) {
      const user = userPickToSet(userAnswers[num]);
      const key = answerKey.get(num) ?? new Set();
      if (setsEqual(user, key)) correct++;
      else {
        const ut = user.size ? [...user].sort().join(",") : "(trống)";
        const kt = [...key].sort().join(",");
        wrong.push(`Q${num}: bạn chọn ${ut} | đáp án ${kt}`);
      }
    }
    const total = qNumbers.length;
    const score = (correct / total) * 10;
    let msg = `Đúng ${correct}/${total} câu\nĐiểm (thang 10): ${score.toFixed(2)}`;
    if (wrong.length) {
      msg += "\n\nCâu sai:\n- " + wrong.slice(0, 20).join("\n- ");
      if (wrong.length > 20) msg += `\n... và ${wrong.length - 20} câu sai khác`;
    }
    setResultText(msg);
  };

  const submitStudyRound = () => {
    if (!studyRoundNums.length) return;

    const wrongNums: number[] = [];
    for (const num of studyRoundNums) {
      const user = userPickToSet(userAnswers[num]);
      const key = answerKey.get(num) ?? new Set<string>();
      if (!setsEqual(user, key)) wrongNums.push(num);
    }
    setStudyWrongInLastRound(wrongNums.length);

    // Wrong questions come first in the very next round.
    const nextQueue = [...wrongNums, ...studyQueue];
    const finishedAll = nextQueue.length === 0;
    if (finishedAll) {
      const remainUnique = new Set(nextQueue).size;
      const masteredUnique = Math.max(0, qNumbers.length - remainUnique);
      const msg =
        `Hoàn thành toàn bộ đề.\n` +
        `- Lượt cuối sai: ${wrongNums.length} câu\n` +
        `- Nắm chắc: ${masteredUnique}/${qNumbers.length} câu\n` +
        `- Còn cần ôn: ${remainUnique} câu`;
      setResultText(msg);
      return;
    }

    const nextRoundNums = nextQueue.slice(0, STUDY_BATCH_SIZE);
    const rest = nextQueue.slice(nextRoundNums.length);
    setStudyRound((r) => r + 1);
    setStudyRoundNums(nextRoundNums);
    setStudyQueue(rest);
    setCurrentIdx(0);
    setStudyLocked({});
    setUserAnswers((prev) => {
      const copied = { ...prev };
      for (const n of nextRoundNums) delete copied[n];
      return copied;
    });
  };

  const restartCurrentPractice = () => {
    if (view === "study") {
      startStudySession(qNumbers);
      setResultText(null);
      return;
    }
    if (view === "quiz") {
      setCurrentIdx(0);
      setUserAnswers({});
      setResultText(null);
    }
  };

  const shuffleCurrentPractice = () => {
    const shuffled = shuffleArray(qNumbers);
    if (!trueFalseOnlyActive) {
      setAllQNumbers(shuffled);
    }
    setQNumbers(shuffled);
    setResultText(null);

    if (view === "study") {
      startStudySession(shuffled);
      return;
    }
    if (view === "quiz") {
      setCurrentIdx(0);
      setUserAnswers({});
    }
  };

  const useOnlyTrueFalse = () => {
    if (trueFalseNumbers.length <= 5) return;
    const next = trueFalseOnlyActive ? allQNumbers : trueFalseNumbers;
    setTrueFalseOnlyActive(!trueFalseOnlyActive);
    setQNumbers(next);
    setCurrentIdx(0);
    setUserAnswers({});
    setResultText(null);
    if (view === "study") {
      startStudySession(next);
    }
  };

  useEffect(() => {
    if (view !== "quiz" && view !== "flashcard" && view !== "study") return;
    const navCount = view === "study" ? studyRoundNums.length : qNumbers.length;
    const maxIdx = Math.max(0, navCount - 1);
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (view === "quiz" || view === "study") {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setCurrentIdx((i) => (i > 0 ? i - 1 : i));
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          if (view === "study" && currentIdx >= maxIdx) {
            submitStudyRound();
          } else {
            setCurrentIdx((i) => (i < maxIdx ? i + 1 : i));
          }
        }
        if (view === "study" && e.key === "Enter") {
          e.preventDefault();
          submitStudyRound();
        }
      }
      if (view === "flashcard") {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setFlashIdx((i) => (i > 0 ? i - 1 : i));
          setAnswerVisible(false);
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setFlashIdx((i) => (i < maxIdx ? i + 1 : i));
          setAnswerVisible(false);
        }
        if (e.key === "Enter") {
          e.preventDefault();
          setAnswerVisible((v) => !v);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, qNumbers.length, studyRoundNums.length, currentIdx, submitStudyRound]);

  const flashQNum = qNumbers[flashIdx];
  const flashData = flashQNum !== undefined ? questions[flashQNum] : undefined;
  const currentUserSet = qNum !== undefined ? userPickToSet(userAnswers[qNum]) : new Set<string>();
  const showStudyFeedback = view === "study" && qNum !== undefined && studyLocked[qNum];
  const studyAnsweredCorrectly = setsEqual(currentUserSet, currentCorrectSet);

  return (
    <>
      {view === "setup" && homeTab === "single" && (
        <>
          <header className="path-hero">
            <h1 className="path-hero__title">Chọn lộ trình ôn tập</h1>
            <p className="path-hero__sub">
              Làm bài trắc nghiệm có chấm điểm, hoặc học nhanh với thẻ ghi nhớ — tất cả từ kho đề trên MongoDB.
            </p>
            <p className="path-hero__sub">
              {learnMode === "similar"
                ? "Chế độ này đọc thứ tự câu + hint từ file same-question.txt; đáp án và phương án trắc nghiệm lấy qua API theo từng [tên đề] Qn. Gợi ý chỉ hiện sau khi bạn chọn đáp án."
                : "Chọn chế độ bên dưới, rồi bấm bắt đầu trên thẻ bộ đề bạn muốn."}
            </p>
          </header>

          <div className="mode-toggle" role="tablist" aria-label="Chế độ học">
            <div className="mode-toggle__inner">
              <button
                type="button"
                role="tab"
                aria-selected={learnMode === "quiz"}
                className={`mode-toggle__btn${learnMode === "quiz" ? " mode-toggle__btn--active" : ""}`}
                onClick={() => setLearnMode("quiz")}
              >
                Quiz Mode
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={learnMode === "flashcard"}
                className={`mode-toggle__btn${learnMode === "flashcard" ? " mode-toggle__btn--active" : ""}`}
                onClick={() => setLearnMode("flashcard")}
              >
                Flashcard Mode
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={learnMode === "study"}
                className={`mode-toggle__btn${learnMode === "study" ? " mode-toggle__btn--active" : ""}`}
                onClick={() => setLearnMode("study")}
              >
                Chế độ Học
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={learnMode === "similar"}
                className={`mode-toggle__btn${learnMode === "similar" ? " mode-toggle__btn--active" : ""}`}
                onClick={() => setLearnMode("similar")}
              >
                Câu gần giống
              </button>
            </div>
          </div>

          <p className="path-hint">
            {learnMode === "similar"
              ? "Nội dung ôn: file same-question.txt (đồng bộ vào quiz-web/public khi chạy npm run dev/build). Server chỉ dùng để tra đáp án đúng theo mã đề + số câu."
              : "Chọn một bộ đề từ MongoDB để bắt đầu."}
          </p>

          {listLoading && <div className="path-loading">Đang tải danh sách đề…</div>}

          {learnMode !== "similar" && !listLoading && serverExams.length === 0 && (
            <div className="path-empty">Chưa có bộ đề trên server. Hãy import dữ liệu (quiz-server) rồi tải lại trang.</div>
          )}

          {learnMode !== "similar" && !listLoading && serverExams.length > 0 && (
            <div className="path-grid">
              {serverExams.map((e, idx) => {
                const theme = CARD_THEMES[idx % CARD_THEMES.length]!;
                const mins = estimateMinutes(e.questionCount);
                const qc = e.questionCount ?? 0;
                return (
                  <article key={e._id} className={`learning-card ${theme.variant}`}>
                    <span className="learning-card__badge">{CARD_BADGE}</span>
                    <h2 className="learning-card__title">{e.examKey}</h2>
                    <p className="learning-card__desc">{examCardDescription(e.examKey)}</p>
                    <hr className="learning-card__rule" />
                    <div className="learning-card__stats">
                      <div>
                        <span className={`learning-card__stat-val ${theme.stat}`}>{qc > 0 ? qc : "—"}</span>
                        <span className="learning-card__stat-label">Câu hỏi</span>
                      </div>
                      <div>
                        <span className={`learning-card__stat-val ${theme.stat}`}>~{mins} phút</span>
                        <span className="learning-card__stat-label">Ước lượng</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="learning-card__start"
                      disabled={serverLoading}
                      onClick={() =>
                        void startExamFromCard(e._id, learnMode as Exclude<LearnMode, "similar">)
                      }
                    >
                      {learnMode === "quiz"
                        ? "Bắt đầu Quiz"
                        : learnMode === "flashcard"
                          ? "Bắt đầu Flashcard"
                          : "Bắt đầu Học"}
                      <StartArrowIcon />
                    </button>
                  </article>
                );
              })}
            </div>
          )}

          {learnMode === "similar" && !listLoading && serverExams.length === 0 && (
            <div className="path-empty">
              Chưa có bộ đề trên server — không thể tra đáp án cho same-question.txt. Hãy import dữ liệu (quiz-server).
            </div>
          )}

          {learnMode === "similar" && !listLoading && serverExams.length > 0 && (
            <div className="path-grid path-grid--similar">
              <article className={`learning-card ${CARD_THEMES[0]!.variant}`}>
                <span className="learning-card__badge">Tổng hợp</span>
                <h2 className="learning-card__title">Câu gần giống (mọi đề)</h2>
                <p className="learning-card__desc">
                  Đọc same-question.txt (stem + hint theo nhóm). Đáp án và các lựa chọn A–F lấy từ MongoDB theo đúng [tên đề] Qn
                  trong file. Mỗi lượt 5 câu, câu sai được ôn lại ở lượt sau — giống chế độ Học. Gợi ý chỉ hiện sau khi chọn đáp án.
                </p>
                <hr className="learning-card__rule" />
                <div className="learning-card__stats">
                  <div>
                    <span className={`learning-card__stat-val ${CARD_THEMES[0]!.stat}`}>—</span>
                    <span className="learning-card__stat-label">Số câu</span>
                  </div>
                  <div>
                    <span className={`learning-card__stat-val ${CARD_THEMES[0]!.stat}`}>Học</span>
                    <span className="learning-card__stat-label">Chế độ</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="learning-card__start"
                  disabled={serverLoading}
                  onClick={() => void startSimilarPractice()}
                >
                  Tải &amp; bắt đầu
                  <StartArrowIcon />
                </button>
              </article>
            </div>
          )}

          <div className="path-footer-random">
            <button type="button" onClick={() => setHomeTab("random")}>
              Quiz ngẫu nhiên từ nhiều bộ đề →
            </button>
          </div>

          {error && <div className="error-banner">{error}</div>}
        </>
      )}

      {view === "setup" && homeTab === "random" && (
        <>
          <div className="path-back-random">
            <button type="button" onClick={() => setHomeTab("single")}>
              ← Chọn bộ đề
            </button>
          </div>
          <RandomQuizSection apiBase={API_BASE} />
        </>
      )}

      {(view === "quiz" || view === "study") && currentQ && qNum !== undefined && (
        <div className="quiz-panel">
          <div className="back-link quiz-back">
            <button type="button" onClick={() => setView("setup")}>
              ← Chọn bộ đề khác
            </button>
          </div>
          <div className="quiz-header-row">
            <span className="quiz-badge">
              {view === "study"
                ? `Học lượt ${studyRound} · Câu ${currentIdx + 1}/${studyRoundNums.length} · Q${qNum}`
                : `Câu ${currentIdx + 1} / ${qNumbers.length} · Q${qNum}`}
            </span>
            <span className="quiz-percent">
              {view === "study"
                ? `${Math.round(((currentIdx + 1) / Math.max(1, studyRoundNums.length)) * 100)}% lượt này`
                : `${Math.round(((currentIdx + 1) / qNumbers.length) * 100)}% hoàn thành`}
            </span>
          </div>
          {view === "study" && (
            <div className="study-note">
              Sai lượt trước: {studyWrongInLastRound} câu · Còn chờ ôn: {studyQueue.length} câu
            </div>
          )}
          <p className="question-title">{currentQ.question}</p>
          <p className="choose-hint">
            {currentQ.chooseCount === 1 ? "Chọn 1 đáp án" : `Chọn ${currentQ.chooseCount} đáp án`}
          </p>
          <div className="options-list">
            {currentQ.chooseCount === 1
              ? currentQ.options.map(([key, text]) => (
                  <label
                    key={key}
                    className={`option-card${
                      view === "study" && (userAnswers[qNum] ?? []).includes(key)
                        ? currentCorrectSet.has(key)
                          ? " option-card--correct"
                          : " option-card--wrong"
                        : ""
                    }`}
                    htmlFor={`opt-${qNum}-${key}`}
                  >
                    <input
                      type="radio"
                      className="option-input"
                      name={`q-${qNum}`}
                      id={`opt-${qNum}-${key}`}
                      checked={(userAnswers[qNum]?.[0] ?? "") === key}
                      disabled={view === "study" && !!studyLocked[qNum]}
                      onChange={() => saveSingle(key)}
                    />
                    <span className="option-radio-faux" aria-hidden />
                    <span className="option-label-text">
                      {key}. {text}
                    </span>
                    {view === "study" &&
                      (userAnswers[qNum] ?? []).includes(key) &&
                      (currentCorrectSet.has(key) ? (
                        <span className="option-chip option-chip--ok">Đúng</span>
                      ) : (
                        <span className="option-chip option-chip--bad">Sai</span>
                      ))}
                  </label>
                ))
              : currentQ.options.map(([key, text]) => (
                  <label
                    key={key}
                    className={`option-card${
                      view === "study" && (userAnswers[qNum] ?? []).includes(key)
                        ? currentCorrectSet.has(key)
                          ? " option-card--correct"
                          : " option-card--wrong"
                        : ""
                    }`}
                    htmlFor={`cb-${qNum}-${key}`}
                  >
                    <input
                      type="checkbox"
                      className="option-input"
                      id={`cb-${qNum}-${key}`}
                      checked={(userAnswers[qNum] ?? []).includes(key)}
                      disabled={view === "study" && !!studyLocked[qNum]}
                      onChange={() => toggleMulti(key)}
                    />
                    <span className="option-check-faux" aria-hidden />
                    <span className="option-label-text">
                      {key}. {text}
                    </span>
                    {view === "study" &&
                      (userAnswers[qNum] ?? []).includes(key) &&
                      (currentCorrectSet.has(key) ? (
                        <span className="option-chip option-chip--ok">Đúng</span>
                      ) : (
                        <span className="option-chip option-chip--bad">Sai</span>
                      ))}
                  </label>
                ))}
          </div>
          {showStudyFeedback && (
            <div className={studyAnsweredCorrectly ? "study-feedback study-feedback--ok" : "study-feedback study-feedback--bad"}>
              {studyAnsweredCorrectly ? (
                <span>Đúng rồi. Chuyển câu tiếp theo nhé.</span>
              ) : (
                <span>
                  Sai. Đáp án đúng:{" "}
                  {[...currentCorrectSet]
                    .sort()
                    .map((k) => `${k}. ${currentQ.options.find(([opt]) => opt === k)?.[1] ?? ""}`.trim())
                    .join(" | ")}
                </span>
              )}
            </div>
          )}
          <div className="quiz-nav-footer">
            <button type="button" className="btn-nav-prev" onClick={goPrev} disabled={currentIdx === 0}>
              ← Trước
            </button>
            <div className="quiz-nav-footer__right">
              <button type="button" className="btn-ghost" onClick={restartCurrentPractice}>
                Làm lại
              </button>
              <button type="button" className="btn-ghost" onClick={shuffleCurrentPractice}>
                Trộn câu hỏi
              </button>
              {trueFalseNumbers.length > 5 && (
                <button
                  type="button"
                  className={`btn-ghost${trueFalseOnlyActive ? " btn-ghost-active" : ""}`}
                  onClick={useOnlyTrueFalse}
                >
                  {trueFalseOnlyActive
                    ? `Đang chỉ True/False (${trueFalseNumbers.length})`
                    : `Chỉ True/False (${trueFalseNumbers.length})`}
                </button>
              )}
              {view !== "study" && (
                <button type="button" className="btn-submit-grade" onClick={submitQuiz}>
                  Nộp bài & chấm điểm
                </button>
              )}
              <button
                type="button"
                className="btn-nav-next"
                onClick={goNext}
                disabled={view !== "study" && currentIdx >= activeNumbers.length - 1}
              >
                Tiếp →
              </button>
            </div>
          </div>
          <div className="quiz-tip">
            <span className="quiz-tip__icon" aria-hidden>
              💡
            </span>
            <span>
              {view === "study"
                ? "Mẹo: Mỗi lượt 5 câu. Nộp lượt sẽ tự gom câu sai sang lượt kế tiếp cho đến khi hết đề."
                : "Mẹo: Dùng phím ← → để chuyển câu; bạn có thể đổi đáp án bất cứ lúc nào trước khi nộp bài."}
            </span>
          </div>
        </div>
      )}

      {view === "similar" && similarSlides.length > 0 && (
        <SimilarQuizPanel
          slides={similarSlides}
          onBack={() => {
            setView("setup");
            setSimilarSlides([]);
            setResultText(null);
          }}
        />
      )}

      {view === "flashcard" && flashData && flashQNum !== undefined && (
        <div className="quiz-panel">
          <div className="back-link quiz-back">
            <button type="button" onClick={() => setView("setup")}>
              ← Chọn bộ đề khác
            </button>
          </div>
          <div className="quiz-header-row">
            <span className="quiz-badge">
              Flashcard {flashIdx + 1} / {qNumbers.length} · Q{flashQNum}
            </span>
            <span className="quiz-percent">
              {Math.round(((flashIdx + 1) / qNumbers.length) * 100)}% hoàn thành
            </span>
          </div>
          <p className="question-title">{flashData.question}</p>
          <p className="choose-hint">Các lựa chọn</p>
          <div className="options-list">
            {flashData.options.map(([k, t]) => (
              <div key={k} className="option-card option-card--readonly">
                <span className="option-label-text">
                  {k}. {t}
                </span>
              </div>
            ))}
          </div>
          <p className="answer-reveal">
            Đáp án:{" "}
            {answerVisible
              ? [...(answerKey.get(flashQNum) ?? new Set())].sort().join(", ")
              : "(ẩn)"}
          </p>
          <div className="quiz-nav-footer">
            <button
              type="button"
              className="btn-nav-prev"
              onClick={() => {
                if (flashIdx > 0) {
                  setFlashIdx((i) => i - 1);
                  setAnswerVisible(false);
                }
              }}
              disabled={flashIdx === 0}
            >
              ← Trước
            </button>
            <div className="quiz-nav-footer__right">
              <button type="button" className="btn-submit-grade" onClick={() => setAnswerVisible((v) => !v)}>
                {answerVisible ? "Ẩn đáp án" : "Hiện đáp án"}
              </button>
              <button
                type="button"
                className="btn-nav-next"
                onClick={() => {
                  if (flashIdx < qNumbers.length - 1) {
                    setFlashIdx((i) => i + 1);
                    setAnswerVisible(false);
                  }
                }}
                disabled={flashIdx >= qNumbers.length - 1}
              >
                Tiếp →
              </button>
            </div>
          </div>
          <div className="quiz-tip">
            <span className="quiz-tip__icon" aria-hidden>
              💡
            </span>
            <span>Mẹo: Phím ← → chuyển thẻ; Enter bật/tắt đáp án.</span>
          </div>
        </div>
      )}

      {resultText && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
          <div className="modal">
            <h2 id="result-title">Kết quả</h2>
            <pre>{resultText}</pre>
            <div className="quiz-nav-footer__right" style={{ marginTop: 16 }}>
              {(view === "quiz" || view === "study") && (
                <button type="button" className="btn-submit-grade" onClick={restartCurrentPractice}>
                  Làm lại
                </button>
              )}
              <button type="button" className="btn-primary" onClick={() => setResultText(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
