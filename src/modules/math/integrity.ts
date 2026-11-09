import { parseExpression } from "./expression.ts";
import { samplePlot } from "./plot.ts";
import { analyzeVariation } from "./variation.ts";
import { validateMathFigure } from "./descriptor.ts";
import type { MathFigure } from "./descriptor.ts";

function identical(
  a: unknown,
  b: unknown,
  tolerance?: (a: number, b: number) => number,
): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number" && tolerance)
    return (
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) <= tolerance(a, b)
    );
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        identical(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          tolerance,
        ),
    )
  );
}

const roundoff = (a: number, b: number) =>
  64 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);

function samePlot(
  a: Extract<MathFigure, { kind: "graph" }>["data"],
  figure: Extract<MathFigure, { kind: "graph" }>,
) {
  const b = figure.data;
  if (
    a.evaluations !== b.evaluations ||
    !identical(a.warnings, b.warnings) ||
    a.segments.length !== b.segments.length ||
    a.holes.length !== b.holes.length
  )
    return false;
  const { xMin, xMax, yMin, yMax } = figure.viewport;
  const xTolerance =
    64 * Number.EPSILON * Math.max(Math.abs(xMin), Math.abs(xMax), xMax - xMin);
  const yTolerance =
    64 * Number.EPSILON * Math.max(Math.abs(yMin), Math.abs(yMax), yMax - yMin);
  const samePoints = (
    left: { x: number; y: number }[],
    right: { x: number; y: number }[],
  ) =>
    left.length === right.length &&
    left.every(
      (point, index) =>
        Math.abs(point.x - right[index].x) <= xTolerance &&
        Math.abs(point.y - right[index].y) <= yTolerance,
    );
  return (
    samePoints(a.holes, b.holes) &&
    a.segments.every((segment, index) => samePoints(segment, b.segments[index]))
  );
}

/** Frozen v1 import verifier. It compares retained data and never replaces it. */
export function verifyMathFigures(figures: MathFigure[]) {
  const verified = new Set<string>();
  const deadline = performance.now() + 2000;
  for (const input of figures) {
    const figure = validateMathFigure(input);
    const fingerprint = JSON.stringify(figure);
    if (verified.has(fingerprint)) continue;
    if (verified.size >= 512 || performance.now() > deadline)
      throw new Error(
        "Math import exceeded its verification limit. Split the lesson into smaller files.",
      );
    const expression = parseExpression(figure.expression.source, {
      angleMode: figure.expression.angleMode,
    });
    if (
      expression.status !== "supported" ||
      !identical(expression.value, figure.expression)
    )
      throw new Error(
        "Math source differs from its retained expression. Recreate this figure from its source.",
      );
    if (figure.kind === "variation") {
      const analysis = analyzeVariation(figure.expression.source);
      if (
        analysis.status !== "supported" ||
        !identical(analysis.value, figure.data, roundoff)
      )
        throw new Error(
          "Math analysis differs from its retained v1 proof. Recreate this table from its source.",
        );
    } else {
      const plot = samplePlot(
        expression.value,
        figure.viewport,
        figure.sampleSize,
      );
      if (plot.status !== "supported" || !samePlot(plot.value, figure))
        throw new Error(
          "Math plot differs from its retained v1 samples. Recreate this graph from its source.",
        );
    }
    verified.add(fingerprint);
  }
}
