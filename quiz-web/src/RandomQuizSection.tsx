import { useCallback, useEffect, useRef, useState } from "react";
import { buildPoolFromExamDocuments, samplePool, type ExamDocument, type PoolQuestionItem } from "./randomQuizPool";
import { setsEqual } from "./parseQuiz";

type ExamListItem = { _id: string; examKey: string };

type View = "setup" | "quiz";

function apiUrl(base: string, path: string) {
  return `${base.replace(/\/$/, "")}${path}`;
}

function userPickToSet(pick: string[] | undefined): Set<string> {
  return new Set((pick ?? []).map((x) => x.toUpperCase()));
}

type Props = {
  apiBase: string;
};

export function RandomQuizSection({ apiBase }: Props) {
  const [pool, setPool] = useState<PoolQuestionItem[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolError, setPoolError] = useState<string | null>(null);

  const [countStr, setCountStr] = useState("20");
  const [seedStr, setSeedStr] = useState("");
  const [startError, setStartError] = useState<string | null>(null);

  const [view, setView] = useState<View>("setup");
  const [quizItems, setQuizItems] = useState<PoolQuestionItem[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, string[]>>({});
  const userAnswersRef = useRef(userAnswers);
  userAnswersRef.current = userAnswers;
  const [resultText, setResultText] = useState<string | null>(null);

  const loadPool = useCallback(async () => {
    setPoolLoading(true);
    setPoolError(null);
    setPool([]);
    try {
      const listRes = await fetch(apiUrl(apiBase, "/api/exams"));
      if (!listRes.ok) {
        setPoolError(`Không đọc được danh sách đề (${listRes.status}).`);
        return;
      }
      const list = (await listRes.json()) as ExamListItem[];
      if (!Array.isArray(list) || !list.length) {
        setPoolError("Chưa có bộ đề nào trên server.");
        return;
      }
      const docs = await Promise.all(
        list.map(async (row) => {
          const r = await fetch(apiUrl(apiBase, `/api/exams/${row._id}`));
          if (!r.ok) throw new Error(`Lỗi tải ${row.examKey}`);
          return (await r.json()) as ExamDocument & { _id: string };
        })
      );
      const built = buildPoolFromExamDocuments(docs);
      setPool(built);
      if (!built.length) {
        setPoolError("Không ghép được câu nào (đề/đáp án không khớp).");
      }
    } catch {
      setPoolError("Lỗi mạng hoặc server (đang chạy quiz-server?).");
    } finally {
      setPoolLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadPool();
  }, [loadPool]);

  const startQuiz = () => {
    setStartError(null);
    const raw = countStr.trim();
    const n = parseInt(raw, 10);
    if (!raw || Number.isNaN(n) || n < 1) {
      setStartError("Số câu phải là số nguyên ≥ 1.");
      return;
    }
    if (!pool.length) {
      setStartError("Chưa có pool — kiểm tra dữ liệu MongoDB.");
      return;
    }
    const seedRaw = seedStr.trim();
    const seed = seedRaw === "" ? undefined : parseInt(seedRaw, 10);
    if (seedRaw !== "" && Number.isNaN(seed)) {
      setStartError("Seed phải là số nguyên hoặc để trống.");
      return;
    }
    const picked = samplePool(pool, n, seed);
    setQuizItems(picked);
    setCurrentIdx(0);
    setUserAnswers({});
    setView("quiz");
  };

  const item = quizItems[currentIdx];

  const saveSingle = useCallback(
    (letter: string) => {
      const it = quizItems[currentIdx];
      if (!it) return;
      setUserAnswers((prev) => ({
        ...prev,
        [it.id]: letter ? [letter.toUpperCase()] : [],
      }));
    },
    [quizItems, currentIdx]
  );

  const toggleMulti = useCallback(
    (letter: string) => {
      const it = quizItems[currentIdx];
      if (!it) return;
      const upper = letter.toUpperCase();
      setUserAnswers((prev) => {
        const cur = new Set(prev[it.id] ?? []);
        if (cur.has(upper)) cur.delete(upper);
        else cur.add(upper);
        return { ...prev, [it.id]: [...cur].sort() };
      });
    },
    [quizItems, currentIdx]
  );

  const submitQuiz = useCallback(() => {
    const answersNow = userAnswersRef.current;
    let correct = 0;
    const wrong: string[] = [];
    for (const q of quizItems) {
      const user = userPickToSet(answersNow[q.id]);
      if (setsEqual(user, q.answer)) correct++;
      else {
        const ut = user.size ? [...user].sort().join(",") : "(trống)";
        const kt = [...q.answer].sort().join(",");
        wrong.push(`[${q.sourceExam}] Q${q.qNum}: bạn ${ut} | đáp án ${kt}`);
      }
    }
    const total = quizItems.length;
    const score = total ? (correct / total) * 10 : 0;
    let msg = `Đúng ${correct}/${total} câu\nĐiểm (thang 10): ${score.toFixed(2)}`;
    if (wrong.length) {
      msg += "\n\nCâu sai:\n- " + wrong.slice(0, 25).join("\n- ");
      if (wrong.length > 25) msg += `\n... và ${wrong.length - 25} câu nữa`;
    }
    setResultText(msg);
  }, [quizItems]);

  useEffect(() => {
    if (view !== "quiz" || !quizItems.length) return;
    const maxIdx = quizItems.length - 1;
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
      if (e.key === "Enter") {
        e.preventDefault();
        submitQuiz();
      }
      const char = (e.key.length === 1 ? e.key : "").toUpperCase();
      if (char >= "A" && char <= "F") {
        const it = quizItems[currentIdx];
        if (!it) return;
        const valid = new Set(it.options.map(([k]) => k));
        if (!valid.has(char)) return;
        e.preventDefault();
        if (it.chooseCount === 1) saveSingle(char);
        else toggleMulti(char);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, quizItems, currentIdx, submitQuiz, saveSingle, toggleMulti]);

  if (view === "setup") {
    return (
      <div className="setup-panel random-quiz-panel">
        <p style={{ fontWeight: 600, margin: "0 0 8px" }}>Quiz ngẫu nhiên (nhiều bộ đề)</p>
        <p className="hint" style={{ marginTop: 0 }}>
          Giống <code>create_quiz_gui.py</code>: gom mọi bộ đề trên MongoDB, rút ngẫu nhiên một số câu.
        </p>

        <p style={{ margin: "12px 0 6px", color: "#333" }}>
          {poolLoading
            ? "Đang tải pool…"
            : poolError
              ? poolError
              : `Pool: ${pool.length} câu hợp lệ (từ các bộ đề trên server).`}
        </p>

        <button type="button" className="btn-ghost" disabled={poolLoading} onClick={() => void loadPool()} style={{ marginBottom: 12 }}>
          Tải lại pool
        </button>

        <div className="file-row">
          <label htmlFor="rq-count">Số câu ngẫu nhiên:</label>
          <input
            id="rq-count"
            type="text"
            inputMode="numeric"
            value={countStr}
            onChange={(e) => setCountStr(e.target.value)}
            style={{ width: 80, padding: "6px 8px", font: "inherit" }}
          />
        </div>
        <div className="file-row">
          <label htmlFor="rq-seed">Seed (tùy chọn):</label>
          <input
            id="rq-seed"
            type="text"
            inputMode="numeric"
            placeholder="để trống = ngẫu nhiên mỗi lần"
            value={seedStr}
            onChange={(e) => setSeedStr(e.target.value)}
            style={{ width: 200, padding: "6px 8px", font: "inherit" }}
          />
        </div>

        {startError && <div className="error-banner">{startError}</div>}

        <div className="actions" style={{ marginTop: 14 }}>
          <button type="button" className="btn-load" disabled={poolLoading || !pool.length} onClick={startQuiz}>
            Start Random Quiz
          </button>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          Khi đang làm bài: ← → chuyển câu, A–F chọn đáp án, Enter nộp bài.
        </p>

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

  if (!item) {
    return null;
  }

  return (
    <div className="quiz-panel">
      <div className="back-link quiz-back">
        <button
          type="button"
          onClick={() => {
            setView("setup");
            setQuizItems([]);
            setUserAnswers({});
          }}
        >
          ← Cấu hình lại
        </button>
      </div>
      <div className="quiz-header-row">
        <span className="quiz-badge">
          Câu {currentIdx + 1} / {quizItems.length}
        </span>
        <span className="quiz-percent">
          {Math.round(((currentIdx + 1) / quizItems.length) * 100)}% hoàn thành
        </span>
      </div>
      <p className="meta-line">
        [{item.sourceExam}] · Q{item.qNum}
      </p>
      <p className="question-title">{item.question}</p>
      <p className="choose-hint">
        {item.chooseCount === 1 ? "Chọn 1 đáp án" : `Chọn ${item.chooseCount} đáp án`}
      </p>
      <div className="options-list">
        {item.chooseCount === 1
          ? item.options.map(([key, text]) => (
              <label key={key} className="option-card" htmlFor={`rq-opt-${item.id}-${key}`}>
                <input
                  type="radio"
                  className="option-input"
                  name={`rq-${item.id}`}
                  id={`rq-opt-${item.id}-${key}`}
                  checked={(userAnswers[item.id]?.[0] ?? "") === key}
                  onChange={() => saveSingle(key)}
                />
                <span className="option-radio-faux" aria-hidden />
                <span className="option-label-text">
                  {key}. {text}
                </span>
              </label>
            ))
          : item.options.map(([key, text]) => (
              <label key={key} className="option-card" htmlFor={`rq-cb-${item.id}-${key}`}>
                <input
                  type="checkbox"
                  className="option-input"
                  id={`rq-cb-${item.id}-${key}`}
                  checked={(userAnswers[item.id] ?? []).includes(key)}
                  onChange={() => toggleMulti(key)}
                />
                <span className="option-check-faux" aria-hidden />
                <span className="option-label-text">
                  {key}. {text}
                </span>
              </label>
            ))}
      </div>
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
            onClick={() => setCurrentIdx((i) => Math.min(quizItems.length - 1, i + 1))}
            disabled={currentIdx >= quizItems.length - 1}
          >
            Tiếp →
          </button>
        </div>
      </div>
      <div className="quiz-tip">
        <span className="quiz-tip__icon" aria-hidden>
          💡
        </span>
        <span>Mẹo: ← → chuyển câu; phím A–F chọn đáp án; Enter nộp bài.</span>
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
