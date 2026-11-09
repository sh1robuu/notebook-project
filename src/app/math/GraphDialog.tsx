import { useId, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { defaultFigureStyle } from "../../modules/math/descriptor.ts";
import type { MathFigure } from "../../modules/math/descriptor.ts";
import { FigureSvg, graphFrame } from "../../modules/math/figure-svg.tsx";
import type { PlotViewport } from "../../modules/math/types.ts";
import type { MathWorkerClient } from "../../modules/math/worker-client.ts";
import { useMathJob } from "./useMathJob.ts";

type Graph = Extract<MathFigure, { kind: "graph" }>;
const initialViewport: PlotViewport = { xMin: -5, xMax: 5, yMin: -5, yMax: 10 };
const boundKeys = ["xMin", "xMax", "yMin", "yMax"] as const;
const boundLabels = {
  xMin: "X min",
  xMax: "X max",
  yMin: "Y min",
  yMax: "Y max",
};
const examples = [
  "x^2",
  "x^3 - 3x",
  "1/x",
  "(x^2 - 1)/(x - 1)",
  "sqrt(x)",
  "ln(x)",
  "tan(x)",
  "2^x",
];
const number = (value: string) =>
  value.trim() ? Number(value.replace(",", ".")) : NaN;
const fieldValues = (window: PlotViewport) => ({
  xMin: String(window.xMin),
  xMax: String(window.xMax),
  yMin: String(window.yMin),
  yMax: String(window.yMax),
});
type Point = { x: number; y: number };
type Drag = { id: number; from: Point; to: Point; viewport: PlotViewport };

export function GraphDialog({
  worker,
  original,
  editing,
  onSave,
}: {
  worker: MathWorkerClient;
  original?: Graph;
  editing: boolean;
  onSave: (figure: Graph, dimensions: { w: number; h: number }) => boolean;
}) {
  const id = useId();
  const [source, setSource] = useState(original?.expression.source ?? "x^2");
  const [fields, setFields] = useState(() =>
    fieldValues(original?.viewport ?? initialViewport),
  );
  const [widthInput, setWidth] = useState(
    String(original?.sampleSize.width ?? 640),
  );
  const [heightInput, setHeight] = useState(
    String(original?.sampleSize.height ?? 400),
  );
  const [style, setStyle] = useState(original?.style ?? defaultFigureStyle);
  const [crop, setCrop] = useState(false);
  const [drag, setDrag] = useState<Drag>();
  const [notice, setNotice] = useState("");
  const gesture = useRef<Drag | undefined>(undefined);
  const width = number(widthInput),
    height = number(heightInput);
  const dimensionsOK =
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 240 &&
    width <= 1200 &&
    height >= 180 &&
    height <= 900;
  const viewport = useMemo<PlotViewport>(
    () => ({
      xMin: number(fields.xMin),
      xMax: number(fields.xMax),
      yMin: number(fields.yMin),
      yMax: number(fields.yMax),
    }),
    [fields],
  );
  const boundsOK =
    Object.values(viewport).every(Number.isFinite) &&
    viewport.xMin < viewport.xMax &&
    viewport.yMin < viewport.yMax;
  const reuseOriginal =
    original &&
    source === original.expression.source &&
    width === original.sampleSize.width &&
    height === original.sampleSize.height &&
    boundKeys.every((key) => viewport[key] === original.viewport[key]);
  const job = useMemo(
    () =>
      source.trim() && dimensionsOK && boundsOK && !reuseOriginal
        ? { kind: "graph" as const, source, viewport, width, height }
        : null,
    [source, dimensionsOK, boundsOK, viewport, width, height, reuseOriginal],
  );
  const completed = useMathJob(worker, job);
  const result = reuseOriginal
    ? {
        status: "supported" as const,
        value: { expression: original.expression, data: original.data },
        warnings: original.data.warnings,
      }
    : completed;
  const figure: Graph | undefined =
    result?.status === "supported"
      ? {
          kind: "graph",
          schemaVersion: 1,
          ...result.value,
          viewport,
          sampleSize: { width, height },
          style,
        }
      : undefined;
  const setViewport = (next: PlotViewport) => {
    setFields(fieldValues(next));
    setNotice("");
  };
  const shift = (x: number, y: number, scale = 1) => {
    const dx = viewport.xMax - viewport.xMin,
      dy = viewport.yMax - viewport.yMin;
    const cx = viewport.xMin + dx * (0.5 + x),
      cy = viewport.yMin + dy * (0.5 + y);
    setViewport({
      xMin: cx - (dx * scale) / 2,
      xMax: cx + (dx * scale) / 2,
      yMin: cy - (dy * scale) / 2,
      yMax: cy + (dy * scale) / 2,
    });
  };
  const point = (event: PointerEvent<HTMLDivElement>, clamp = false): Point => {
    const box = event.currentTarget.getBoundingClientRect(),
      frame = graphFrame(width, height);
    const x =
      (((event.clientX - box.left) * width) / box.width - frame.x) /
      frame.width;
    const y =
      (((event.clientY - box.top) * height) / box.height - frame.y) /
      frame.height;
    return clamp
      ? { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }
      : { x, y };
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!figure || event.button !== 0 || gesture.current) return;
    const from = point(event);
    if (from.x < 0 || from.x > 1 || from.y < 0 || from.y > 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id: event.pointerId, from, to: from, viewport };
    setDrag(gesture.current);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = { ...gesture.current, to: point(event, crop) };
    setDrag(gesture.current);
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const state = gesture.current;
    if (state?.id !== event.pointerId) return;
    gesture.current = undefined;
    setDrag(undefined);
    if (event.type !== "pointerup") return;
    const to = point(event, crop),
      { from, viewport: startWindow } = state;
    const xSpan = startWindow.xMax - startWindow.xMin,
      ySpan = startWindow.yMax - startWindow.yMin;
    if (crop) {
      if (Math.abs(to.x - from.x) < 0.015 || Math.abs(to.y - from.y) < 0.015)
        return;
      setViewport({
        xMin: startWindow.xMin + Math.min(from.x, to.x) * xSpan,
        xMax: startWindow.xMin + Math.max(from.x, to.x) * xSpan,
        yMin: startWindow.yMax - Math.max(from.y, to.y) * ySpan,
        yMax: startWindow.yMax - Math.min(from.y, to.y) * ySpan,
      });
      setCrop(false);
    } else {
      const dx = (from.x - to.x) * xSpan,
        dy = (to.y - from.y) * ySpan;
      setViewport({
        xMin: startWindow.xMin + dx,
        xMax: startWindow.xMax + dx,
        yMin: startWindow.yMin + dy,
        yMax: startWindow.yMax + dy,
      });
    }
  };
  const frame = dimensionsOK ? graphFrame(width, height) : null;
  const fitVisible = () => {
    if (!figure) return;
    let min = Infinity,
      max = -Infinity;
    for (const segment of figure.data.segments)
      for (const sample of segment) {
        min = Math.min(min, sample.y);
        max = Math.max(max, sample.y);
      }
    if (!Number.isFinite(min)) return;
    const pad = Math.max(
      (max - min) * 0.12,
      (viewport.yMax - viewport.yMin) * 0.04,
    );
    setViewport({ ...viewport, yMin: min - pad, yMax: max + pad });
  };
  return (
    <div className="math-panel-body">
      <label className="math-source" htmlFor={id}>
        Function expression
      </label>
      <input
        id={id}
        className="math-input"
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
        Use <code>x</code> as the variable. Graphs use radians. Try{" "}
        <code>cos(2x)</code>, <code>ln(x)</code> or <code>sqrt(x)</code>.
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
      <div className="math-graph-layout">
        <div className="math-graph-area">
          {figure ? (
            <div
              className="math-plot"
              style={{
                aspectRatio: width / height,
                cursor: crop ? "crosshair" : drag ? "grabbing" : "grab",
              }}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={finish}
              onLostPointerCapture={finish}
            >
              <FigureSvg figure={figure} width={width} height={height} />
              {crop && drag && frame ? (
                <div
                  className="math-crop"
                  aria-hidden="true"
                  style={{
                    left: `${((frame.x + Math.min(drag.from.x, drag.to.x) * frame.width) / width) * 100}%`,
                    top: `${((frame.y + Math.min(drag.from.y, drag.to.y) * frame.height) / height) * 100}%`,
                    width: `${((Math.abs(drag.from.x - drag.to.x) * frame.width) / width) * 100}%`,
                    height: `${((Math.abs(drag.from.y - drag.to.y) * frame.height) / height) * 100}%`,
                  }}
                />
              ) : null}
            </div>
          ) : (
            <div className="math-empty-preview" aria-hidden="true">
              Graph preview
            </div>
          )}
          <div
            className="math-view-tools"
            role="group"
            aria-label="Graph navigation"
          >
            <button
              type="button"
              onClick={() => shift(0, 0, 0.65)}
              disabled={!boundsOK}
              aria-label="Zoom graph in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => shift(0, 0, 1.55)}
              disabled={!boundsOK}
              aria-label="Zoom graph out"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => shift(-0.2, 0)}
              disabled={!boundsOK}
              aria-label="Pan graph left"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => shift(0.2, 0)}
              disabled={!boundsOK}
              aria-label="Pan graph right"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => shift(0, 0.2)}
              disabled={!boundsOK}
              aria-label="Pan graph up"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => shift(0, -0.2)}
              disabled={!boundsOK}
              aria-label="Pan graph down"
            >
              ↓
            </button>
            <button type="button" onClick={() => setViewport(initialViewport)}>
              Reset view
            </button>
            <button
              type="button"
              onClick={fitVisible}
              disabled={!figure?.data.segments.length}
            >
              Fit visible curve
            </button>
            <button
              type="button"
              aria-pressed={crop}
              disabled={!figure}
              onClick={() => setCrop((value) => !value)}
            >
              Crop region
            </button>
          </div>
          <p className="math-hint">
            {crop
              ? "Drag a rectangle inside the plot or enter the four bounds."
              : "Drag the plot to pan, or use the arrow buttons."}
          </p>
        </div>
        <div className="math-graph-settings">
          <fieldset>
            <legend>Graph window</legend>
            <div className="math-field-grid">
              {boundKeys.map((key) => (
                <label key={key}>
                  {boundLabels[key]}
                  <input
                    inputMode="decimal"
                    value={fields[key]}
                    onChange={(event) =>
                      setFields({ ...fields, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Appearance</legend>
            <div className="math-field-grid">
              <label>
                Stroke color
                <input
                  type="color"
                  value={style.stroke}
                  onChange={(event) =>
                    setStyle({ ...style, stroke: event.target.value })
                  }
                />
              </label>
              <label>
                Thickness
                <select
                  aria-label="Thickness"
                  value={style.strokeWidth}
                  onChange={(event) =>
                    setStyle({
                      ...style,
                      strokeWidth: Number(event.target.value),
                    })
                  }
                >
                  {[1, 2, 2.5, 3, 4, 6].map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </select>
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
                        .value as Graph["style"]["background"],
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
                Ticks
                <select
                  aria-label="Ticks"
                  value={style.tickDensity}
                  onChange={(event) =>
                    setStyle({
                      ...style,
                      tickDensity: event.target
                        .value as Graph["style"]["tickDensity"],
                    })
                  }
                >
                  <option value="low">Sparse</option>
                  <option value="normal">Normal</option>
                  <option value="high">Dense</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={style.grid}
                  onChange={(event) =>
                    setStyle({ ...style, grid: event.target.checked })
                  }
                />{" "}
                Grid
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={style.axes}
                  onChange={(event) =>
                    setStyle({ ...style, axes: event.target.checked })
                  }
                />{" "}
                Axes
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Preview size</legend>
            <div className="math-field-grid">
              <label>
                Width
                <input
                  inputMode="numeric"
                  value={widthInput}
                  onChange={(event) => setWidth(event.target.value)}
                />
              </label>
              <label>
                Height
                <input
                  inputMode="numeric"
                  value={heightInput}
                  onChange={(event) => setHeight(event.target.value)}
                />
              </label>
            </div>
          </fieldset>
        </div>
      </div>
      {figure?.expression.domain.length ? (
        <details className="math-inspection">
          <summary>Domain restrictions</summary>
          <ul>
            {[
              ...new Set(
                figure.expression.domain.map(
                  (restriction) => restriction.description,
                ),
              ),
            ].map((description) => (
              <li key={description}>{description}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div role="status" className="math-feedback">
        {!dimensionsOK
          ? "Use a width of 240–1200 and height of 180–900 pixels."
          : !boundsOK
            ? "Each minimum must be smaller than its maximum."
            : !source.trim()
              ? "Enter a function to preview it."
              : !result
                ? "Calculating preview…"
                : result.status !== "supported"
                  ? result.message
                  : result.warnings.length
                    ? result.warnings.join(" ")
                    : "Graph ready."}
        {notice ? <p>{notice}</p> : null}
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="primary"
          disabled={!figure}
          onClick={() => {
            if (figure && !onSave(figure, { w: width, h: height }))
              setNotice(
                "The figure could not be saved on this page. Reopen the tool and try again.",
              );
          }}
        >
          {editing ? "Save graph" : "Insert graph"}
        </button>
      </div>
    </div>
  );
}
