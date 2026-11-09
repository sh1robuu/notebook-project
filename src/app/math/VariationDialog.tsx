import { useEffect, useId, useMemo, useRef, useState } from "react";
import { defaultFigureStyle } from "../../modules/math/descriptor.ts";
import type { MathFigure } from "../../modules/math/descriptor.ts";
import { FigureSvg, mathFigurePng } from "../../modules/math/figure-svg.tsx";
import type { MathWorkerClient } from "../../modules/math/worker-client.ts";
import { useMathJob } from "./useMathJob.ts";

type Variation = Extract<MathFigure, { kind: "variation" }>;
const examples = [
  "x^3 - 3x",
  "1/x",
  "ln(x)",
  "x^3",
  "(x^2 - 1)/(x - 1)",
  "sqrt(x)",
  "abs(2x - 6)",
];
const trendLabels = {
  increasing: "Increasing",
  decreasing: "Decreasing",
  constant: "Constant",
};

export function VariationDialog({
  worker,
  original,
  editing,
  onSave,
}: {
  worker: MathWorkerClient;
  original?: Variation;
  editing: boolean;
  onSave: (figure: Variation, dimensions: { w: number; h: number }) => boolean;
}) {
  const id = useId();
  const [source, setSource] = useState(
    original?.expression.source ?? "x^3 - 3x",
  );
  const [style, setStyle] = useState(original?.style ?? defaultFigureStyle);
  const [exportBackground, setExportBackground] = useState<
    "white" | "transparent"
  >("white");
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const task = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => task.current?.abort(), []);
  const reuseOriginal = original && source === original.expression.source;
  const job = useMemo(
    () =>
      source.trim() && !reuseOriginal
        ? { kind: "variation" as const, source }
        : null,
    [source, reuseOriginal],
  );
  const completed = useMathJob(worker, job);
  const result = reuseOriginal
    ? {
        status: "supported" as const,
        value: { expression: original.expression, data: original.data },
        warnings: [],
      }
    : completed;
  const figure: Variation | undefined =
    result?.status === "supported"
      ? { kind: "variation", schemaVersion: 1, ...result.value, style }
      : undefined;
  const analysis = figure?.data;
  const width = Math.max(
      640,
      140 +
        (analysis?.intervals.length ?? 1) * 132 +
        (analysis?.points.length ?? 0) * 104,
    ),
    height = 252;
  async function download() {
    if (!figure || task.current) return;
    const controller = new AbortController();
    task.current = controller;
    setExporting(true);
    setNotice("");
    try {
      const scale = Math.min(3, 4095 / width);
      const blob = await mathFigurePng({
        figure,
        width,
        height,
        scale,
        background: exportBackground,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = "variation-table.png";
        link.click();
        setNotice(
          `PNG ready (${Math.ceil(width * scale)} × ${Math.ceil(height * scale)} pixels).`,
        );
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice(
          error instanceof Error
            ? error.message
            : "The PNG could not be exported.",
        );
    } finally {
      task.current = undefined;
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  return (
    <div className="math-panel-body">
      <label className="math-source" htmlFor={id}>
        Function expression
      </label>
      <input
        className="math-input"
        id={id}
        autoFocus
        value={source}
        maxLength={1024}
        spellCheck={false}
        onChange={(event) => {
          setSource(event.target.value);
          setNotice("");
        }}
      />
      <p className="math-hint">
        Use a polynomial up to degree 3, a low-degree rational function, or a
        logarithm, square root, or absolute value of a linear expression.
      </p>
      <label className="math-inline">
        Example{" "}
        <select
          aria-label="Example"
          value=""
          onChange={(event) => {
            if (event.target.value) setSource(event.target.value);
          }}
        >
          <option value="">Choose an example</option>
          {examples.map((example) => (
            <option key={example}>{example}</option>
          ))}
        </select>
      </label>
      <p role="status" className="math-feedback">
        {!source.trim()
          ? "Enter a function to analyze it."
          : !result
            ? "Analyzing function…"
            : result.status !== "supported"
              ? result.message
              : "Analysis ready."}
      </p>
      {figure && analysis ? (
        <>
          <dl className="math-analysis" aria-label="Variation analysis">
            <div>
              <dt>Domain</dt>
              <dd>{analysis.domain}</dd>
            </div>
            <div>
              <dt>Derivative</dt>
              <dd>{analysis.derivative}</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>{analysis.method}</dd>
            </div>
          </dl>
          <div
            className="math-table-preview"
            tabIndex={0}
            aria-label="Variation table preview"
          >
            <FigureSvg figure={figure} width={width} height={height} />
          </div>
          <details className="math-inspection">
            <summary>Critical points, signs and limits</summary>
            <ul>
              {analysis.points.map((point) => (
                <li key={point.x.label}>
                  <strong>x = {point.x.label}</strong> ·{" "}
                  {point.kind === "excluded"
                    ? `Excluded${point.discontinuity ? ` (${point.discontinuity})` : ""}`
                    : point.kind === "endpoint"
                      ? "Domain endpoint"
                      : point.kind === "nondifferentiable"
                        ? "Non-differentiable point"
                        : "Stationary point"}
                  {point.derivativeZero
                    ? " · derivative zero"
                    : point.derivativeUndefined
                      ? " · derivative undefined"
                      : ""}
                  {point.extremum !== "none"
                    ? ` · local ${point.extremum}`
                    : ""}
                  {point.value
                    ? ` · f(x) ${point.value.exact ? "=" : "≈"} ${point.value.label.replace(/^≈\s*/, "")}`
                    : ""}
                  {point.leftLimit
                    ? ` · left limit ${point.leftLimit.label}`
                    : ""}
                  {point.rightLimit
                    ? ` · right limit ${point.rightLimit.label}`
                    : ""}
                </li>
              ))}
            </ul>
            <ul>
              {analysis.intervals.map((interval) => (
                <li key={interval.left.label}>
                  {trendLabels[interval.trend]} on ({interval.left.label},{" "}
                  {interval.right.label}) · derivative{" "}
                  {interval.sign > 0 ? "+" : interval.sign < 0 ? "−" : "0"}
                </li>
              ))}
            </ul>
            <p>
              Outer limits: {analysis.leftLimit.label},{" "}
              {analysis.rightLimit.label}.
            </p>
            {analysis.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </details>
          <div className="math-table-options">
            <label>
              Ink
              <input
                type="color"
                value={style.stroke}
                onChange={(event) =>
                  setStyle({ ...style, stroke: event.target.value })
                }
              />
            </label>
            <label>
              Background
              <select
                aria-label="Background"
                value={style.background}
                onChange={(event) =>
                  setStyle({
                    ...style,
                    background: event.target
                      .value as Variation["style"]["background"],
                  })
                }
              >
                <option value="white">White</option>
                <option value="transparent">Transparent</option>
                <option value="dark">Dark</option>
                <option value="green">Green</option>
              </select>
            </label>
            <label>
              PNG background
              <select
                aria-label="PNG background"
                value={exportBackground}
                onChange={(event) =>
                  setExportBackground(
                    event.target.value as typeof exportBackground,
                  )
                }
              >
                <option value="white">White</option>
                <option value="transparent">Transparent</option>
              </select>
            </label>
          </div>
        </>
      ) : null}
      <div className="dialog-actions">
        <button
          type="button"
          disabled={!figure || exporting}
          onClick={() => void download()}
        >
          {exporting ? "Preparing PNG…" : "Download table PNG"}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!figure}
          onClick={() => {
            if (
              figure &&
              !onSave(figure, { w: Math.min(width, 1000), h: height })
            )
              setNotice(
                "The table could not be saved on this page. Reopen the tool and try again.",
              );
          }}
        >
          {editing ? "Save variation table" : "Insert variation table"}
        </button>
      </div>
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  );
}
