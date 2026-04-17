import { useCallback, useEffect, useRef, useState } from "react";
import { RandomQuizSection } from "./RandomQuizSection";
import "./App.css";
import type { QuestionsMap } from "./parseQuiz";
import {
  intersectQuestionNumbers,
  parseAnswers,
  parseQuestions,
  setsEqual,
} from "./parseQuiz";

type View = "setup" | "quiz" | "flashcard" | "study";

type HomeTab = "single" | "random";

type ExamListItem = { _id: string; examKey: string; updatedAt?: string; questionCount?: number };

type LearnMode = "quiz" | "flashcard" | "study";

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
  const [qNumbers, setQNumbers] = useState<number[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string[]>>({});

  const [flashIdx, setFlashIdx] = useState(0);
  const [answerVisible, setAnswerVisible] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [studyRound, setStudyRound] = useState(1);
  const [studyRoundNums, setStudyRoundNums] = useState<number[]>([]);
  const [studyQueue, setStudyQueue] = useState<number[]>([]);
  const [studyWrongInLastRound, setStudyWrongInLastRound] = useState(0);
  const [studyLocked, setStudyLocked] = useState<Record<number, boolean>>({});

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
      setQNumbers(nums);
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
    async (examId: string, mode: LearnMode) => {
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

  const activeNumbers = view === "study" ? studyRoundNums : qNumbers;
  const qNum = activeNumbers[currentIdx];
  const currentQ = qNum !== undefined ? questions[qNum] : undefined;
  const currentCorrectSet = qNum !== undefined ? answerKey.get(qNum) ?? new Set<string>() : new Set<string>();
  const trueFalseNumbers = qNumbers.filter((n) => {
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
    setQNumbers(trueFalseNumbers);
    setCurrentIdx(0);
    setUserAnswers({});
    setResultText(null);
    if (view === "study") {
      startStudySession(trueFalseNumbers);
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
          setCurrentIdx((i) => (i < maxIdx ? i + 1 : i));
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
  }, [view, qNumbers.length, studyRoundNums.length]);

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
            <p className="path-hero__sub">Chọn chế độ bên dưới, rồi bấm bắt đầu trên thẻ bộ đề bạn muốn.</p>
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
            </div>
          </div>

          <p className="path-hint">Chọn một bộ đề từ MongoDB để bắt đầu.</p>

          {listLoading && <div className="path-loading">Đang tải danh sách đề…</div>}

          {!listLoading && serverExams.length === 0 && (
            <div className="path-empty">Chưa có bộ đề trên server. Hãy import dữ liệu (quiz-server) rồi tải lại trang.</div>
          )}

          {!listLoading && serverExams.length > 0 && (
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
                      onClick={() => void startExamFromCard(e._id, learnMode)}
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
                <button type="button" className="btn-ghost" onClick={useOnlyTrueFalse}>
                  Chỉ True/False ({trueFalseNumbers.length})
                </button>
              )}
              <button
                type="button"
                className="btn-submit-grade"
                onClick={view === "study" ? submitStudyRound : submitQuiz}
              >
                {view === "study" ? "Kết thúc lượt 5 câu" : "Nộp bài & chấm điểm"}
              </button>
              <button
                type="button"
                className="btn-nav-next"
                onClick={goNext}
                disabled={currentIdx >= activeNumbers.length - 1}
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
