import { useCallback, useEffect, useRef, useState } from "react";
import { setsEqual } from "./parseQuiz";
import type { SimilarSlide } from "./similarQuestions";

type Props = {
  slides: SimilarSlide[];
  onBack: () => void;
};

function userPickToSet(pick: string[] | undefined): Set<string> {
  return new Set((pick ?? []).map((x) => x.toUpperCase()));
}

export function SimilarQuizPanel({ slides, onBack }: Props) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, string[]>>({});
  const userAnswersRef = useRef(userAnswers);
  userAnswersRef.current = userAnswers;
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const [resultText, setResultText] = useState<string | null>(null);

  const slide = slides[currentIdx];
  const item = slide?.item;
  const currentCorrectSet = item?.answer ?? new Set<string>();
  const currentUserSet = item ? userPickToSet(userAnswers[item.id]) : new Set<string>();
  const isLocked = item ? !!locked[item.id] : false;
  const showFeedback = item ? isLocked : false;
  const answeredCorrectly = item ? setsEqual(currentUserSet, currentCorrectSet) : false;

  const saveSingle = useCallback(
    (letter: string) => {
      const it = slides[currentIdx]?.item;
      if (!it || lockedRef.current[it.id]) return;
      setUserAnswers((prev) => ({
        ...prev,
        [it.id]: letter ? [letter.toUpperCase()] : [],
      }));
      setLocked((prev) => ({ ...prev, [it.id]: true }));
    },
    [slides, currentIdx]
  );

  const toggleMulti = useCallback(
    (letter: string) => {
      const it = slides[currentIdx]?.item;
      if (!it || lockedRef.current[it.id]) return;
      const upper = letter.toUpperCase();
      const chooseCount = it.chooseCount ?? 1;
      setUserAnswers((prev) => {
        const cur = new Set(prev[it.id] ?? []);
        if (cur.has(upper)) cur.delete(upper);
        else cur.add(upper);
        const next = [...cur].sort();
        if (cur.size >= chooseCount) {
          queueMicrotask(() => setLocked((lk) => ({ ...lk, [it.id]: true })));
        }
        return { ...prev, [it.id]: next };
      });
    },
    [slides, currentIdx]
  );

  const submitQuiz = useCallback(() => {
    const answersNow = userAnswersRef.current;
    let correct = 0;
    const wrong: string[] = [];
    for (const s of slides) {
      const q = s.item;
      const user = userPickToSet(answersNow[q.id]);
      if (setsEqual(user, q.answer)) correct++;
      else {
        const ut = user.size ? [...user].sort().join(",") : "(trống)";
        const kt = [...q.answer].sort().join(",");
        wrong.push(`[${q.sourceExam}] Q${q.qNum}: bạn ${ut} | đáp án ${kt}`);
      }
    }
    const total = slides.length;
    const score = total ? (correct / total) * 10 : 0;
    let msg = `Đúng ${correct}/${total} câu\nĐiểm (thang 10): ${score.toFixed(2)}`;
    if (wrong.length) {
      msg += "\n\nCâu sai:\n- " + wrong.slice(0, 25).join("\n- ");
      if (wrong.length > 25) msg += `\n... và ${wrong.length - 25} câu nữa`;
    }
    setResultText(msg);
  }, [slides]);

  useEffect(() => {
    if (!slides.length) return;
    const maxIdx = slides.length - 1;
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
        setCurrentIdx((i) => (i < maxIdx ? i + 1 : i));
      }
      const char = (e.key.length === 1 ? e.key : "").toUpperCase();
      if (char >= "A" && char <= "F") {
        const it = slides[currentIdx]?.item;
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
  }, [slides, currentIdx, submitQuiz, saveSingle, toggleMulti]);

  if (!item || !slide) return null;

  return (
    <div className="quiz-panel">
      <div className="back-link quiz-back">
        <button type="button" onClick={onBack}>
          ← Chọn chế độ khác
        </button>
      </div>
      <div className="quiz-header-row">
        <span className="quiz-badge">
          Câu {currentIdx + 1} / {slides.length} · Nhóm {slide.groupIndex} ({slide.indexInGroup}/{slide.groupSize})
        </span>
        <span className="quiz-percent">
          {Math.round(((currentIdx + 1) / slides.length) * 100)}% hoàn thành
        </span>
      </div>
      <p className="meta-line">
        [{item.sourceExam}] · Q{item.qNum}
      </p>
      <div className="similar-hint-box" role="note">
        <strong>Gợi ý khác biệt</strong> (so với câu mẫu trong nhóm): {slide.hint}
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
      <div className="quiz-nav-footer">
        <button
          type="button"
          className="btn-nav-prev"
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
          disabled={currentIdx === 0}
        >
          ← Trước
        </button>
        <div className="quiz-nav-footer__right">
          <button type="button" className="btn-submit-grade" onClick={submitQuiz}>
            Nộp bài &amp; chấm điểm
          </button>
          <button
            type="button"
            className="btn-nav-next"
            onClick={() => setCurrentIdx((i) => Math.min(slides.length - 1, i + 1))}
            disabled={currentIdx >= slides.length - 1}
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
          Giống chế độ Học: sau khi chọn đủ đáp án sẽ khóa câu và hiện đúng/sai ngay. ← → chuyển câu; A–F chọn đáp án.
        </span>
      </div>

      {resultText && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Kết quả</h2>
            <pre>{resultText}</pre>
            <button type="button" className="btn-primary" style={{ marginTop: 12 }} onClick={() => setResultText(null)}>
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
