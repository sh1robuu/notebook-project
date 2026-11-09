import { useEffect, useId, useRef, useState } from "react";
import type {
  AngleMode,
  Calculation,
  MathResult,
} from "../../modules/math/types.ts";
import type { MathWorkerClient } from "../../modules/math/worker-client.ts";

const modeKey = "lessonboard.math.angle";
const keys = [
  ["sin", "sin("],
  ["cos", "cos("],
  ["tan", "tan("],
  ["√", "sqrt("],
  ["xʸ", "^"],
  ["asin", "asin("],
  ["acos", "acos("],
  ["atan", "atan("],
  ["ln", "ln("],
  ["log₁₀", "log("],
  ["π", "pi"],
  ["e", "e"],
  ["exp", "exp("],
  ["|x|", "abs("],
  ["ⁿ√", "root("],
  ["7", "7"],
  ["8", "8"],
  ["9", "9"],
  ["÷", "/"],
  ["(", "("],
  ["4", "4"],
  ["5", "5"],
  ["6", "6"],
  ["×", "*"],
  [")", ")"],
  ["1", "1"],
  ["2", "2"],
  ["3", "3"],
  ["−", "-"],
  ["x!", "!"],
  ["0", "0"],
  [".", "."],
  ["%", "%"],
  ["+", "+"],
  [";", ";"],
] as const;
const accessible: Record<string, string> = {
  "√": "Square root",
  "ⁿ√": "Nth root",
  xʸ: "Power",
  "x!": "Factorial",
  "|x|": "Absolute value",
  "log₁₀": "Base-10 logarithm",
  ";": "Argument separator",
  "÷": "Divide",
  "×": "Multiply",
  "−": "Subtract",
  "%": "Percent",
  π: "Pi",
};
let recentCalculations: Calculation[] = [];

export function Calculator({
  worker,
  readOnly,
  onInsert,
}: {
  worker: MathWorkerClient;
  readOnly: boolean;
  onInsert: (text: string) => boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | undefined>(undefined);
  const [source, setSource] = useState("");
  const [mode, setMode] = useState<AngleMode>(() => {
    try {
      return localStorage.getItem(modeKey) === "DEG" ? "DEG" : "RAD";
    } catch {
      return "RAD";
    }
  });
  const [history, setHistory] = useState(recentCalculations);
  const [result, setResult] = useState<MathResult<Calculation>>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const value = result?.status === "supported" ? result.value : undefined;
  useEffect(() => () => pending.current?.abort(), []);

  function resetResult() {
    pending.current?.abort();
    pending.current = undefined;
    setResult(undefined);
    setBusy(false);
    setNotice("");
  }
  function changeMode(next: AngleMode) {
    resetResult();
    setMode(next);
    try {
      localStorage.setItem(modeKey, next);
    } catch {
      /* Can still calculate in this session. */
    }
  }
  function write(text: string, backspace = false) {
    const field = input.current;
    const selection = field?.selectionStart ?? source.length;
    const end = field?.selectionEnd ?? selection;
    const start =
      backspace && selection === end ? Math.max(0, selection - 1) : selection;
    const next = source.slice(0, start) + text + source.slice(end);
    if (next.length > 1024) return;
    resetResult();
    setSource(next);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + text.length, start + text.length);
    });
  }
  async function calculate() {
    if (!source.trim() || busy) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNotice("");
    try {
      const calculated = await worker.run(
        { kind: "calculator", source, mode },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setResult(calculated);
      if (calculated.status === "supported") {
        recentCalculations = [
          calculated.value,
          ...recentCalculations.filter(
            (item) => item.expression !== source || item.mode !== mode,
          ),
        ].slice(0, 12);
        setHistory(recentCalculations);
      }
    } catch {
      if (!controller.signal.aborted)
        setNotice("The calculation could not finish. Try again.");
    } finally {
      if (pending.current === controller) {
        pending.current = undefined;
        setBusy(false);
      }
    }
  }
  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value.display);
      setNotice("Result copied.");
    } catch {
      setNotice(
        "Clipboard access was unavailable. Select and copy the result manually.",
      );
    }
  }
  return (
    <form
      className="math-panel-body"
      onSubmit={(event) => {
        event.preventDefault();
        void calculate();
      }}
    >
      <div className="calculator-display">
        <label htmlFor={id}>Calculator expression</label>
        <input
          ref={input}
          id={id}
          autoFocus
          className="math-input"
          value={source}
          onChange={(event) => {
            resetResult();
            setSource(event.target.value);
          }}
          maxLength={1024}
          spellCheck={false}
        />
        <output
          htmlFor={id}
          data-testid="calculator-result"
          aria-label="Calculation result"
        >
          {value ? `≈ ${value.display}` : "—"}
        </output>
        <div className="angle-modes" role="group" aria-label="Angle mode">
          {(["DEG", "RAD"] as const).map((angle) => (
            <button
              type="button"
              key={angle}
              aria-pressed={mode === angle}
              onClick={() => changeMode(angle)}
            >
              {angle}
            </button>
          ))}
        </div>
      </div>
      <div
        className="calculator-keys"
        role="group"
        aria-label="Scientific keypad"
      >
        <button
          type="button"
          onClick={() => {
            resetResult();
            setSource("");
            input.current?.focus();
          }}
        >
          Clear
        </button>
        <button type="button" onClick={() => write("", true)}>
          Backspace
        </button>
        <button
          type="button"
          aria-label="Reciprocal"
          onClick={() => {
            if (!source.trim()) {
              write("1/(");
              return;
            }
            if (source.length <= 1020) {
              resetResult();
              setSource(`1/(${source})`);
              input.current?.focus();
            }
          }}
        >
          1/x
        </button>
        <button
          type="button"
          aria-label="Scientific notation"
          onClick={() => write("e")}
        >
          ×10ⁿ
        </button>
        <button
          type="submit"
          className="primary"
          disabled={busy || !source.trim()}
        >
          Calculate
        </button>
        {keys.map(([label, token]) => (
          <button
            type="button"
            key={label}
            aria-label={accessible[label]}
            onClick={() => write(token)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="math-hint">
        Press Enter to calculate. <code>10%</code> means <code>10/100</code>.
        Use <code>root(8;3)</code> for a cube root or <code>1.5e3</code> for
        scientific notation. Decimal commas are accepted. Results show up to 15
        significant digits.
      </p>
      {result && result.status !== "supported" ? (
        <p role="alert" className="dialog-error">
          {result.message}
        </p>
      ) : null}
      {busy ? <p role="status">Calculating…</p> : null}
      <div className="math-table-options">
        <button type="button" disabled={!value} onClick={() => void copy()}>
          Copy result
        </button>
        <button
          type="button"
          disabled={!value || readOnly}
          onClick={() => {
            if (value)
              setNotice(
                onInsert(`≈ ${value.display}`)
                  ? "Result inserted."
                  : "The result could not be inserted on this page.",
              );
          }}
        >
          Insert result
        </button>
      </div>
      {notice ? <p role="status">{notice}</p> : null}
      <details className="math-inspection">
        <summary>Calculation history</summary>
        <p className="math-hint">
          The last 12 results stay available until you reload or close this
          page.
        </p>
        {history.length ? (
          <ol>
            {history.map((item) => (
              <li key={item.expression + item.mode}>
                <button
                  type="button"
                  onClick={() => {
                    changeMode(item.mode);
                    setSource(item.expression);
                    setResult({
                      status: "supported",
                      value: item,
                      warnings: [],
                    });
                    input.current?.focus();
                  }}
                >
                  {item.expression} ≈ {item.display} · {item.mode}
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p>No calculations yet.</p>
        )}
      </details>
    </form>
  );
}
