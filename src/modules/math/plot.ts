import { prepareDomain } from "./domain.ts";
import { evaluateExpression } from "./expression.ts";
import type {
  MathResult,
  ParsedExpression,
  PlotData,
  PlotOptions,
  PlotPoint,
  PlotViewport,
} from "./types.ts";
import { analyzeVariation } from "./variation.ts";

export const MAX_PLOT_SAMPLES = 8192;
export const DEFAULT_PLOT_SAMPLES = 4096;
export const MAX_PLOT_COORDINATE = 1e12;
export const MAX_PLOT_HOLES = 64;

function validBounds(min: number, max: number): boolean {
  const magnitude = Math.max(Math.abs(min), Math.abs(max));
  return (
    Number.isFinite(magnitude) &&
    magnitude <= MAX_PLOT_COORDINATE &&
    max - min >= Math.max(1e-12, magnitude * Number.EPSILON * 32)
  );
}

export function validPlotViewport(viewport: PlotViewport): boolean {
  return (
    validBounds(viewport.xMin, viewport.xMax) &&
    validBounds(viewport.yMin, viewport.yMax)
  );
}

export function worldToPlot(
  point: PlotPoint,
  viewport: PlotViewport,
  width: number,
  height: number,
): PlotPoint {
  return {
    x: ((point.x - viewport.xMin) / (viewport.xMax - viewport.xMin)) * width,
    y: ((viewport.yMax - point.y) / (viewport.yMax - viewport.yMin)) * height,
  };
}

export function plotToWorld(
  point: PlotPoint,
  viewport: PlotViewport,
  width: number,
  height: number,
): PlotPoint {
  return {
    x: viewport.xMin + (point.x / width) * (viewport.xMax - viewport.xMin),
    y: viewport.yMax - (point.y / height) * (viewport.yMax - viewport.yMin),
  };
}

function samePoint(a: PlotPoint, b: PlotPoint) {
  return a.x === b.x && a.y === b.y;
}

// Clip each accepted line to the visible window before serialization. Scaling
// the interpolation keeps its subtraction finite even at the binary64 limits.
function clipLine(
  a: PlotPoint,
  b: PlotPoint,
  { yMin, yMax }: PlotViewport,
): [PlotPoint, PlotPoint] | null {
  if ((a.y < yMin && b.y < yMin) || (a.y > yMax && b.y > yMax)) return null;
  function clip(p: PlotPoint, other: PlotPoint): PlotPoint {
    const y = Math.max(yMin, Math.min(yMax, p.y));
    if (y === p.y) return p;
    const scale = Math.max(Math.abs(p.y), Math.abs(other.y), Math.abs(y));
    const t = Math.max(
      0,
      Math.min(1, (y / scale - p.y / scale) / (other.y / scale - p.y / scale)),
    );
    return { x: p.x + (other.x - p.x) * t, y };
  }
  return [clip(a, b), clip(b, a)];
}

export function samplePlot(
  expression: ParsedExpression,
  viewport: PlotViewport,
  { width, height, maxSamples = DEFAULT_PLOT_SAMPLES, signal }: PlotOptions,
): MathResult<PlotData> {
  if (!validPlotViewport(viewport))
    return {
      status: "invalid",
      message: "Use finite, ordered graph bounds with a visible span.",
    };
  if (![width, height].every((n) => Number.isFinite(n) && n >= 32 && n <= 8192))
    return {
      status: "invalid",
      message: "Graph dimensions must be between 32 and 8192 pixels.",
    };
  if (
    !Number.isInteger(maxSamples) ||
    maxSamples < 16 ||
    maxSamples > MAX_PLOT_SAMPLES
  )
    return {
      status: "limit",
      message: `Graph sampling is limited to ${MAX_PLOT_SAMPLES} points.`,
    };
  const cancelled: MathResult<PlotData> = {
    status: "limit",
    message: "Graph calculation was cancelled.",
  };
  if (signal?.aborted) return cancelled;

  const domain = prepareDomain(expression.ast, expression.angleMode);
  if (domain.discrete)
    return {
      status: "unsupported",
      message:
        "A graph needs a continuous real function. Use constant factorials and root degrees.",
    };

  const holes: PlotPoint[] = [],
    cuts: number[] = [];
  if (
    expression.variables.length &&
    expression.domain.some(
      (r) => r.kind === "nonzero" || r.kind === "real-power",
    )
  ) {
    const variation = analyzeVariation(expression.source, {
      signal,
      maxOperations: 3000,
    });
    if (variation.status === "supported") {
      for (const point of variation.value.points) {
        const x = point.x.value;
        if (
          point.included ||
          x === null ||
          x < viewport.xMin ||
          x > viewport.xMax
        )
          continue;
        cuts.push(x);
        const y = point.leftLimit?.value;
        if (
          point.discontinuity === "hole" &&
          y != null &&
          y >= viewport.yMin &&
          y <= viewport.yMax &&
          holes.length < MAX_PLOT_HOLES
        )
          holes.push({ x, y });
      }
    }
  }

  const xSpan = viewport.xMax - viewport.xMin;
  const ySpan = viewport.yMax - viewport.yMin;
  const minimumCell = xSpan / width / 8;
  const yTolerance = (ySpan / height) * 0.7;
  const seeds = Math.max(
    4,
    Math.min(128, Math.ceil(width / 20), Math.floor(maxSamples / 8)),
  );
  const starts = new Set<number>([viewport.xMin, viewport.xMax, ...cuts]);
  if (viewport.xMin < 0 && viewport.xMax > 0) starts.add(0);
  for (let i = 1; i < seeds; i++)
    starts.add(viewport.xMin + (xSpan * i) / seeds);
  const boundaries = [...starts].sort((a, b) => a - b);
  const forbidden = new Set(cuts);
  const samples = new Map<number, PlotPoint | null>();
  const segments: PlotPoint[][] = [];
  const budget = { remaining: 750_000, signal };
  let current: PlotPoint[] | undefined;
  let visited = 0,
    saved = 0;
  let sawRange = false,
    unresolvedDomain = false,
    unresolvedCurve = false,
    exhausted = false;

  function sample(x: number): PlotPoint | null {
    const existing = samples.get(x);
    if (existing !== undefined) return existing;
    if (samples.size >= maxSamples || budget.remaining <= 0) {
      exhausted = true;
      return null;
    }
    const result = forbidden.has(x)
      ? null
      : evaluateExpression(expression, x, budget);
    const point =
      result?.status === "supported" ? { x, y: result.value } : null;
    samples.set(x, point);
    return point;
  }

  function append(a: PlotPoint, b: PlotPoint) {
    const line = clipLine(a, b, viewport);
    if (!line || samePoint(...line) || line[0].x > line[1].x) {
      current = undefined;
      return;
    }
    if (saved + 2 > MAX_PLOT_SAMPLES) {
      exhausted = true;
      return;
    }
    if (current && samePoint(current[current.length - 1], line[0])) {
      current.push(line[1]);
      saved++;
    } else {
      current = line;
      segments.push(current);
      saved += 2;
    }
  }

  function visit(left: number, right: number, depth: number) {
    if (++visited > maxSamples * 2 || budget.remaining <= 0) exhausted = true;
    if (signal?.aborted || exhausted) return;
    const span = right - left,
      middle = left + span / 2;
    const canSplit =
      depth < 18 && span > minimumCell && middle > left && middle < right;
    const interval = domain.interval(left, right);
    if (interval.kind === "outside") {
      current = undefined;
      return;
    }
    if (interval.kind === "unresolved") {
      unresolvedDomain = true;
      current = undefined;
      return;
    }
    if (interval.kind === "range") {
      sawRange = true;
      if (interval.min > viewport.yMax || interval.max < viewport.yMin) {
        current = undefined;
        return;
      }
      const a = sample(left),
        b = sample(right),
        m = sample(middle);
      const q1 = sample(left + span / 4),
        q3 = sample(left + span * 0.75);
      if (a && b && m && q1 && q3) {
        // Include quarter probes and the enclosure. Three samples alone can
        // alias an oscillation and miss a visible peak at some zoom levels.
        const lineError = Math.max(
          Math.abs(a.y * 0.75 + b.y * 0.25 - q1.y),
          Math.abs(a.y / 2 + b.y / 2 - m.y),
          Math.abs(a.y * 0.25 + b.y * 0.75 - q3.y),
        );
        const sampleMin = Math.min(a.y, q1.y, m.y, q3.y, b.y);
        const sampleMax = Math.max(a.y, q1.y, m.y, q3.y, b.y);
        const visible = (y: number) =>
          Math.max(viewport.yMin, Math.min(viewport.yMax, y));
        const unseen = Math.max(
          visible(sampleMin) - visible(interval.min),
          visible(interval.max) - visible(sampleMax),
        );
        if (
          lineError <= yTolerance &&
          (!domain.oscillatory || unseen <= 2 * yTolerance)
        ) {
          append(a, b);
          return;
        }
      }
    }
    if (canSplit && !exhausted) {
      visit(left, middle, depth + 1);
      visit(middle, right, depth + 1);
    } else {
      if (interval.kind === "unknown") unresolvedDomain = true;
      else if (!forbidden.has(left) && !forbidden.has(right))
        unresolvedCurve = true;
      current = undefined;
    }
  }

  for (let i = 1; i < boundaries.length; i++) {
    if (exhausted || signal?.aborted) break;
    if (forbidden.has(boundaries[i - 1])) current = undefined;
    visit(boundaries[i - 1], boundaries[i], 0);
  }
  if (signal?.aborted) return cancelled;
  if (exhausted)
    return {
      status: "limit",
      message:
        "Graph sampling reached its work limit. Zoom in or use a simpler function.",
    };
  if (!segments.length && !holes.length) {
    if (unresolvedDomain || unresolvedCurve)
      return {
        status: "inconclusive",
        message:
          "No reliable curve was found in this window. Try a narrower window or simpler function.",
      };
    if (!sawRange)
      return {
        status: "undefined",
        message: "The function has no real values in this window.",
      };
  }
  const warnings: string[] = [];
  if (!segments.length && !holes.length)
    warnings.push("The curve is outside the visible vertical bounds.");
  if (unresolvedDomain)
    warnings.push(
      "Gaps mark possible discontinuities or boundaries the sampler could not resolve.",
    );
  if (unresolvedCurve)
    warnings.push(
      "Some detail could not be drawn at this scale. Zoom in to inspect it.",
    );
  return {
    status: "supported",
    value: { segments, holes, evaluations: samples.size, warnings },
    warnings,
  };
}
