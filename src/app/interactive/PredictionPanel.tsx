import { useEffect, useId, useRef, useState } from "react";
import {
  createPrediction,
  predictionLimits,
  predictionResults,
  transitionPrediction,
} from "../../modules/interactive/prediction.ts";
import type {
  PredictionAction,
  PredictionInput,
  PredictionPhase,
  PredictionRound,
} from "../../modules/interactive/prediction.ts";
import "./prediction.css";

type Props = {
  value: PredictionRound | null;
  materialName?: string;
  readOnly?: boolean;
  canObserve?: boolean;
  onChange: (
    next: PredictionRound,
    previous: PredictionRound | null,
  ) => boolean;
  onObserve?: (value: PredictionRound) => void;
};

const phaseLabels: Record<PredictionPhase, string> = {
  draft: "Chuẩn bị câu hỏi",
  predicting: "Đang ghi lượt dự đoán",
  locked: "Đã khóa lượt dự đoán",
  observing: "Đang quan sát",
  explaining: "Đang giải thích",
  completed: "Đã hoàn tất",
};
const percentage = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

export function PredictionPanel({
  value,
  materialName,
  readOnly = false,
  canObserve = true,
  onChange,
  onObserve,
}: Props) {
  const heading = useId();
  const panel = useRef<HTMLElement>(null);
  const advanceFocus = useRef(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<PredictionRound | null>(null);
  const phase = value?.phase ?? "draft";
  const activeStep =
    phase === "observing"
      ? 1
      : phase === "explaining" || phase === "completed"
        ? 2
        : 0;

  useEffect(() => {
    if (!advanceFocus.current) return;
    advanceFocus.current = false;
    panel.current
      ?.querySelector<HTMLElement>("[data-prediction-next]")
      ?.focus({ preventScroll: true });
  }, [value]);

  function commit(make: () => PredictionRound) {
    if (readOnly) return;
    setError("");
    try {
      const next = make();
      advanceFocus.current = !value || value.phase !== next.phase;
      if (!onChange(next, value)) {
        advanceFocus.current = false;
        setError("Hoạt động đã thay đổi. Hãy mở lại để tiếp tục.");
        return;
      }
      return next;
    } catch (reason) {
      advanceFocus.current = false;
      setError(
        reason instanceof Error ? reason.message : "Không lưu được thay đổi.",
      );
    }
  }

  function act(action: PredictionAction) {
    if (value) return commit(() => transitionPrediction(value, value, action));
  }

  function configure(input: PredictionInput, start: boolean) {
    return commit(() => {
      const draft = value
        ? transitionPrediction(value, value, { type: "configure", input })
        : createPrediction(input);
      return start
        ? transitionPrediction(draft, draft, { type: "start" })
        : draft;
    });
  }

  function observe(openRuntime: boolean) {
    if (openRuntime && (!canObserve || !onObserve)) return;
    const next = act({ type: "observe" });
    if (next && openRuntime) onObserve?.(next);
  }

  function saveNotes(
    observation: string,
    explanation: string | undefined,
    next?: "explain" | "complete",
  ) {
    if (!value) return;
    commit(() => {
      const noted = transitionPrediction(value, value, {
        type: "record",
        observation,
        explanation,
      });
      return next ? transitionPrediction(noted, noted, { type: next }) : noted;
    });
  }

  return (
    <section
      className="prediction-panel"
      lang="vi"
      aria-labelledby={heading}
      ref={panel}
    >
      <header className="prediction-heading">
        <h2 id={heading}>Dự đoán – Quan sát – Giải thích</h2>
        {materialName ? <p>Mô phỏng: {materialName}</p> : null}
        <p className="prediction-context">
          Giáo viên nhập số lượt trả lời tại chỗ.
        </p>
      </header>
      <ol className="prediction-steps" aria-label="Các bước của hoạt động">
        {["Dự đoán", "Quan sát", "Giải thích"].map((label, index) => (
          <li
            key={label}
            aria-current={activeStep === index ? "step" : undefined}
          >
            <span aria-hidden="true">{index + 1}.</span> {label}
          </li>
        ))}
      </ol>
      <p className="prediction-status" role="status">
        {value ? `Vòng ${value.epoch} · ` : ""}
        {phaseLabels[phase]}
      </p>
      {error ? (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      ) : null}

      {phase === "draft" && !readOnly ? (
        <DraftForm
          key={value ? `${value.epoch}:${value.revision}` : "new"}
          value={value}
          onSave={configure}
        />
      ) : value ? (
        <>
          <h3
            className="prediction-question"
            tabIndex={-1}
            data-prediction-next={
              phase === "predicting" || phase === "completed" || undefined
            }
          >
            {value.question}
          </h3>
          {value.teacherNotes ? (
            <Note label="Ghi chú cho giáo viên" value={value.teacherNotes} />
          ) : null}
          <Results
            value={value}
            tally={
              !readOnly && phase === "predicting"
                ? (optionId, delta) => act({ type: "tally", optionId, delta })
                : undefined
            }
          />
          {!readOnly && phase === "predicting" ? (
            <button
              type="button"
              className="primary"
              onClick={() => act({ type: "lock" })}
            >
              Khóa lượt dự đoán
            </button>
          ) : null}
          {!readOnly && phase === "locked" ? (
            <div className="prediction-actions">
              <button
                type="button"
                className="primary"
                data-prediction-next={(canObserve && !!onObserve) || undefined}
                disabled={!canObserve || !onObserve}
                onClick={() => observe(true)}
              >
                Mở mô phỏng để quan sát
              </button>
              <button
                type="button"
                data-prediction-next={!canObserve || !onObserve || undefined}
                onClick={() => observe(false)}
              >
                Ghi quan sát thủ công
              </button>
            </div>
          ) : null}
          {!readOnly && (phase === "observing" || phase === "explaining") ? (
            <NotesForm
              key={`${value.epoch}:${value.revision}`}
              value={value}
              onSave={saveNotes}
            />
          ) : (
            <>
              {value.observation ? (
                <Note label="Quan sát đã ghi" value={value.observation} />
              ) : null}
              {value.explanation ? (
                <Note
                  label="Lời giải thích của giáo viên"
                  value={value.explanation}
                />
              ) : null}
            </>
          )}
          {!readOnly && phase !== "draft" ? (
            confirming === value ? (
              <fieldset className="prediction-reset">
                <legend>Đặt lại vòng {value.epoch}?</legend>
                <p>
                  Vòng mới giữ câu hỏi và phương án, xóa lượt, quan sát và lời
                  giải thích của vòng hiện tại.
                </p>
                <div className="prediction-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(null);
                      act({ type: "reset" });
                    }}
                  >
                    Xác nhận đặt lại
                  </button>
                  <button type="button" onClick={() => setConfirming(null)}>
                    Hủy
                  </button>
                </div>
              </fieldset>
            ) : (
              <button type="button" onClick={() => setConfirming(value)}>
                Đặt lại vòng
              </button>
            )
          ) : null}
        </>
      ) : (
        <p>Chưa có câu hỏi dự đoán.</p>
      )}
    </section>
  );
}

function DraftForm({
  value,
  onSave,
}: {
  value: PredictionRound | null;
  onSave: (input: PredictionInput, start: boolean) => void;
}) {
  const [question, setQuestion] = useState(value?.question ?? "");
  const [options, setOptions] = useState(
    () => value?.options.map((option) => option.text) ?? ["", ""],
  );
  const [teacherNotes, setTeacherNotes] = useState(value?.teacherNotes ?? "");
  const draft = { question, options, teacherNotes };
  return (
    <form
      className="prediction-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft, false);
      }}
    >
      <label>
        Câu hỏi dự đoán
        <textarea
          value={question}
          rows={2}
          maxLength={predictionLimits.question}
          onChange={(event) => setQuestion(event.target.value)}
          required
        />
      </label>
      <fieldset>
        <legend>Phương án trả lời</legend>
        {options.map((option, index) => (
          <div key={index} className="prediction-option-editor">
            <label>
              Phương án {index + 1}
              <input
                type="text"
                value={option}
                maxLength={predictionLimits.option}
                required
                onChange={(event) =>
                  setOptions((previous) =>
                    previous.map((current, at) =>
                      at === index ? event.target.value : current,
                    ),
                  )
                }
              />
            </label>
            {options.length > 2 ? (
              <button
                type="button"
                aria-label={`Bỏ phương án ${index + 1}`}
                onClick={() =>
                  setOptions((previous) =>
                    previous.filter((_, at) => at !== index),
                  )
                }
              >
                Bỏ
              </button>
            ) : null}
          </div>
        ))}
        {options.length < predictionLimits.options ? (
          <button
            type="button"
            onClick={() => setOptions((previous) => [...previous, ""])}
          >
            Thêm phương án
          </button>
        ) : null}
      </fieldset>
      <label>
        Ghi chú cho giáo viên
        <textarea
          value={teacherNotes}
          rows={3}
          maxLength={predictionLimits.notes}
          onChange={(event) => setTeacherNotes(event.target.value)}
        />
      </label>
      <div className="prediction-actions">
        <button type="submit">Lưu câu hỏi</button>
        <button
          type="button"
          className="primary"
          data-prediction-next
          onClick={() => onSave(draft, true)}
        >
          Bắt đầu dự đoán
        </button>
      </div>
    </form>
  );
}

function Note({ label, value }: { label: string; value: string }) {
  return (
    <div className="prediction-note">
      <h4>{label}</h4>
      <p>{value}</p>
    </div>
  );
}

function Results({
  value,
  tally,
}: {
  value: PredictionRound;
  tally?: (optionId: string, delta: -1 | 1) => void;
}) {
  const results = predictionResults(value);
  return (
    <div className="prediction-results">
      <p role="status" className="prediction-total">
        Tổng số lượt: {results.total}
      </p>
      <ul aria-label="Số lượt dự đoán theo phương án">
        {results.options.map((option) => (
          <li key={option.id}>
            <div className="prediction-result-line">
              <strong>{option.text}</strong>
              <span>{option.manualCount} lượt</span>
              <span>{percentage.format(option.percentage)}%</span>
              {tally ? (
                <div className="prediction-tally-actions">
                  <button
                    type="button"
                    aria-label={`Bớt 1 lượt cho ${option.text}`}
                    disabled={option.manualCount === 0}
                    onClick={() => tally(option.id, -1)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    aria-label={`Thêm 1 lượt cho ${option.text}`}
                    disabled={
                      option.manualCount === predictionLimits.manualCount
                    }
                    onClick={() => tally(option.id, 1)}
                  >
                    +
                  </button>
                </div>
              ) : null}
            </div>
            <span className="prediction-meter" aria-hidden="true">
              <span style={{ width: `${option.percentage}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotesForm({
  value,
  onSave,
}: {
  value: PredictionRound;
  onSave: (
    observation: string,
    explanation: string | undefined,
    next?: "explain" | "complete",
  ) => void;
}) {
  const explaining = value.phase === "explaining";
  const [observation, setObservation] = useState(value.observation);
  const [explanation, setExplanation] = useState(value.explanation);
  return (
    <form
      className="prediction-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(observation, explaining ? explanation : undefined);
      }}
    >
      <label>
        Ghi lại quan sát
        <textarea
          value={observation}
          rows={3}
          maxLength={predictionLimits.notes}
          data-prediction-next={!explaining || undefined}
          onChange={(event) => setObservation(event.target.value)}
        />
      </label>
      {explaining ? (
        <label>
          Lời giải thích của giáo viên
          <textarea
            value={explanation}
            rows={4}
            maxLength={predictionLimits.notes}
            data-prediction-next
            onChange={(event) => setExplanation(event.target.value)}
          />
        </label>
      ) : null}
      <div className="prediction-actions">
        <button type="submit">Lưu ghi chép</button>
        {explaining ? (
          <button
            type="button"
            className="primary"
            disabled={!explanation.trim()}
            onClick={() => onSave(observation, explanation, "complete")}
          >
            Hoàn tất vòng
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() => onSave(observation, undefined, "explain")}
          >
            Sang phần giải thích
          </button>
        )}
      </div>
    </form>
  );
}
