import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { setsEqual } from "./parseQuiz";
import type { SimilarSlide } from "./similarQuestions";

const SIMILAR_BATCH_SIZE = 5;

type Props = {
  slides: SimilarSlide[];
  onBack: () => void;
};

function userPickToSet(pick: string[] | undefined): Set<string> {
  return new Set((pick ?? []).map((x) => x.toUpperCase()));
}

export function SimilarQuizPanel({ slides, onBack }: Props) {
  const [studyRound, setStudyRound] = useState(1);
  const [roundSlides, setRoundSlides] = useState<SimilarSlide[]>([]);
  const [queue, setQueue] = useState<SimilarSlide[]>([]);
  const [wrongInLastRound, setWrongInLastRound] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, string[]>>({});
  const userAnswersRef = useRef(userAnswers);
  userAnswersRef.current = userAnswers;
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const [resultText, setResultText] = useState<string | null>(null);

  const roundRef = useRef(roundSlides);
  roundRef.current = roundSlides;
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const totalDeckRef = useRef(0);

  const deckSigRef = useRef("");
  useLayoutEffect(() => {
    const sig = slides.map((s) => s.item.id).join("|");
    if (!sig || sig === deckSigRef.current) return;
    deckSigRef.current = sig;
    totalDeckRef.current = slides.length;
    const first = slides.slice(0, SIMILAR_BATCH_SIZE);
    const rest = slides.slice(first.length);
    setRoundSlides(first);
    setQueue(rest);
    setStudyRound(1);
    setWrongInLastRound(0);
    setCurrentIdx(0);
    setUserAnswers({});
    setLocked({});
    setResultText(null);
  }, [slides]);

  const slide = roundSlides[currentIdx];
  const item = slide?.item;
  const currentCorrectSet = item?.answer ?? new Set<string>();
  const currentUserSet = item ? userPickToSet(userAnswers[item.id]) : new Set<string>();
  const isLocked = item ? !!locked[item.id] : false;
  const showFeedback = item ? isLocked : false;
  const answeredCorrectly = item ? setsEqual(currentUserSet, currentCorrectSet) : false;

  const submitSimilarRound = useCallback(() => {
    const round = roundRef.current;
    const qrest = queueRef.current;
    if (!round.length) return;

    const wrongSlides: SimilarSlide[] = [];
    for (const s of round) {
      const user = userPickToSet(userAnswersRef.current[s.item.id]);
      if (!setsEqual(user, s.item.answer)) wrongSlides.push(s);
    }
    setWrongInLastRound(wrongSlides.length);

    const nextQueue = [...wrongSlides, ...qrest];
    const finishedAll = nextQueue.length === 0;
    if (finishedAll) {
      const total = totalDeckRef.current;
      const remainUnique = new Set(nextQueue).size;
      const masteredUnique = Math.max(0, total - remainUnique);
      const msg =
        `Hoàn thành cả bộ same-question.\n` +
        `- Lượt cuối sai: ${wrongSlides.length} câu\n` +
        `- Nắm chắc: ${masteredUnique}/${total} câu\n` +
        `- Còn cần ôn: ${remainUnique} câu`;
      setResultText(msg);
      return;
    }

    const nextRound = nextQueue.slice(0, SIMILAR_BATCH_SIZE);
    const rest = nextQueue.slice(nextRound.length);
    setStudyRound((r) => r + 1);
    setRoundSlides(nextRound);
    setQueue(rest);
    setCurrentIdx(0);
    setLocked({});
    setUserAnswers((prev) => {
      const copied = { ...prev };
      for (const s of nextRound) delete copied[s.item.id];
      return copied;
    });
  }, []);

  const restartSession = useCallback(() => {
    totalDeckRef.current = slides.length;
    const first = slides.slice(0, SIMILAR_BATCH_SIZE);
    const rest = slides.slice(first.length);
    setRoundSlides(first);
    setQueue(rest);
    setStudyRound(1);
    setWrongInLastRound(0);
    setCurrentIdx(0);
    setUserAnswers({});
    setLocked({});
    setResultText(null);
  }, [slides]);

  const saveSingle = useCallback(
    (letter: string) => {
      const it = roundSlides[currentIdx]?.item;
      if (!it || lockedRef.current[it.id]) return;
      setUserAnswers((prev) => ({
        ...prev,
        [it.id]: letter ? [letter.toUpperCase()] : [],
      }));
      setLocked((prev) => ({ ...prev, [it.id]: true }));
    },
    [roundSlides, currentIdx]
  );

  const toggleMulti = useCallback(
    (letter: string) => {
      const it = roundSlides[currentIdx]?.item;
      if (!it || lockedRef.current[it.id]) return;
      const upper = letter.toUpperCase();
      const chooseCount = it.chooseCount ?? 1;
      setUserAnswers((prev) => {
        const cur = new Set(prev[it.id] ?? []);
        if (cur.has(upper)) cur.delete(upper);
        else cur.add(upper);
        if (cur.size >= chooseCount) {
          queueMicrotask(() => setLocked((lk) => ({ ...lk, [it.id]: true })));
        }
        return { ...prev, [it.id]: [...cur].sort() };
      });
    },
    [roundSlides, currentIdx]
  );

  const goPrev = () => {
    if (currentIdx > 0) setCurrentIdx((i) => i - 1);
  };

  const goNext = () => {
    if (currentIdx >= roundSlides.length - 1) {
      submitSimilarRound();
      return;
    }
    setCurrentIdx((i) => i + 1);
  };

  useEffect(() => {
    if (!roundSlides.length) return;
    const maxIdx = roundSlides.length - 1;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentIdx((i) => (i > 0 ? i - 1 : i));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setCurrentIdx((i) => {
          if (i >= maxIdx) {
            submitSimilarRound();
            return i;
          }
          return i + 1;
        });
      }
      if (e.key === "Enter") {
        e.preventDefault();
        submitSimilarRound();
      }
      const char = (e.key.length === 1 ? e.key : "").toUpperCase();
      if (char >= "A" && char <= "F") {
        const it = roundSlides[currentIdx]?.item;
        if (!it || lockedRef.current[it.id]) return;
        const valid = new Set(it.options.map(([k]) => k));
        if (!valid.has(char)) return;
        e.preventDefault();
        if (it.chooseCount === 1) saveSingle(char);
        else toggleMulti(char);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roundSlides, currentIdx, submitSimilarRound, saveSingle, toggleMulti]);

  if (!item || !slide || !roundSlides.length) return null;

  return (
    <div className="quiz-panel">
      <div className="back-link quiz-back">
        <button type="button" onClick={onBack}>
          ← Chọn chế độ khác
        </button>
      </div>
      <div className="quiz-header-row">
        <span className="quiz-badge">
          Học lượt {studyRound} · Câu {currentIdx + 1}/{roundSlides.length} · Nhóm {slide.groupIndex} ({slide.indexInGroup}/
          {slide.groupSize}) · [{item.sourceExam}] Q{item.qNum}
        </span>
        <span className="quiz-percent">
          {Math.round(((currentIdx + 1) / Math.max(1, roundSlides.length)) * 100)}% lượt này
        </span>
      </div>
      <div className="study-note">
        Sai lượt trước: {wrongInLastRound} câu · Còn chờ ôn: {queue.length} câu
      </div>
      <p className="question-title">{item.question}</p>
      <p className="choose-hint">
        {item.chooseCount === 1 ? "Chọn 1 đáp án" : `Chọn ${item.chooseCount} đáp án`}
      </p>
      <div className="options-list">
        {item.chooseCount === 1
          ? item.options.map(([key, text]) => (
              <label
                key={key}
                className={`option-card${
                  isLocked && (userAnswers[item.id] ?? []).includes(key)
                    ? currentCorrectSet.has(key)
                      ? " option-card--correct"
                      : " option-card--wrong"
                    : ""
                }`}
                htmlFor={`sim-opt-${item.id}-${key}`}
              >
                <input
                  type="radio"
                  className="option-input"
                  name={`sim-${item.id}`}
                  id={`sim-opt-${item.id}-${key}`}
                  checked={(userAnswers[item.id]?.[0] ?? "") === key}
                  disabled={isLocked}
                  onChange={() => saveSingle(key)}
                />
                <span className="option-radio-faux" aria-hidden />
                <span className="option-label-text">
                  {key}. {text}
                </span>
                {isLocked &&
                  (userAnswers[item.id] ?? []).includes(key) &&
                  (currentCorrectSet.has(key) ? (
                    <span className="option-chip option-chip--ok">Đúng</span>
                  ) : (
                    <span className="option-chip option-chip--bad">Sai</span>
                  ))}
              </label>
            ))
          : item.options.map(([key, text]) => (
              <label
                key={key}
                className={`option-card${
                  isLocked && (userAnswers[item.id] ?? []).includes(key)
                    ? currentCorrectSet.has(key)
                      ? " option-card--correct"
                      : " option-card--wrong"
                    : ""
                }`}
                htmlFor={`sim-cb-${item.id}-${key}`}
              >
                <input
                  type="checkbox"
                  className="option-input"
                  id={`sim-cb-${item.id}-${key}`}
                  checked={(userAnswers[item.id] ?? []).includes(key)}
                  disabled={isLocked}
                  onChange={() => toggleMulti(key)}
                />
                <span className="option-check-faux" aria-hidden />
                <span className="option-label-text">
                  {key}. {text}
                </span>
                {isLocked &&
                  (userAnswers[item.id] ?? []).includes(key) &&
                  (currentCorrectSet.has(key) ? (
                    <span className="option-chip option-chip--ok">Đúng</span>
                  ) : (
                    <span className="option-chip option-chip--bad">Sai</span>
                  ))}
              </label>
            ))}
      </div>
      {showFeedback && (
        <div className={answeredCorrectly ? "study-feedback study-feedback--ok" : "study-feedback study-feedback--bad"}>
          {answeredCorrectly ? (
            <span>Đúng rồi. Chuyển câu tiếp theo nhé.</span>
          ) : (
            <span>
              Sai. Đáp án đúng:{" "}
              {[...currentCorrectSet]
                .sort()
                .map((k) => `${k}. ${item.options.find(([opt]) => opt === k)?.[1] ?? ""}`.trim())
                .join(" | ")}
            </span>
          )}
        </div>
      )}
      {isLocked && (
        <div className="similar-hint-box" role="note">
          <strong>Gợi ý khác biệt</strong> (so với câu mẫu trong nhóm): {slide.hint}
        </div>
      )}
      <div className="quiz-nav-footer">
        <button type="button" className="btn-nav-prev" onClick={goPrev} disabled={currentIdx === 0}>
          ← Trước
        </button>
        <div className="quiz-nav-footer__right">
          <button type="button" className="btn-ghost" onClick={restartSession}>
            Làm lại
          </button>
          <button type="button" className="btn-nav-next" onClick={goNext}>
            Tiếp →
          </button>
        </div>
      </div>
      <div className="quiz-tip">
        <span className="quiz-tip__icon" aria-hidden>
          💡
        </span>
        <span>
          Mỗi lượt {SIMILAR_BATCH_SIZE} câu (same-question.txt). Ở câu cuối lượt, bấm Tiếp hoặc Enter để nộp lượt — câu sai
          được ưu tiên ở lượt sau. Sau khi chọn đáp án mới hiện gợi ý khác biệt.
        </span>
      </div>

      {resultText && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Kết quả</h2>
            <pre>{resultText}</pre>
            <div className="quiz-nav-footer__right" style={{ marginTop: 12 }}>
              <button type="button" className="btn-submit-grade" onClick={restartSession}>
                Làm lại
              </button>
              <button type="button" className="btn-primary" onClick={() => setResultText(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
