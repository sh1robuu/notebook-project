import type {
  MathAst,
  ParsedExpression,
  PlotData,
  PlotViewport,
} from "./types.ts";
import type {
  MathValue,
  VariationAnalysis,
  VariationInterval,
} from "./variation.ts";

export type FigureStyle = {
  stroke: string;
  strokeWidth: number;
  background: "white" | "transparent" | "dark" | "green";
  grid: boolean;
  axes: boolean;
  tickDensity: "low" | "normal" | "high";
};

export const defaultFigureStyle: FigureStyle = {
  stroke: "#1759b5",
  strokeWidth: 2,
  background: "white",
  grid: true,
  axes: true,
  tickDensity: "normal",
};

type FigureSource = {
  schemaVersion: 1;
  expression: ParsedExpression;
  style: FigureStyle;
};

export type GraphFigure = FigureSource & {
  kind: "graph";
  viewport: PlotViewport;
  sampleSize: { width: number; height: number };
  data: PlotData;
};

export type VariationFigure = FigureSource & {
  kind: "variation";
  data: VariationAnalysis;
};

export type MathFigure = GraphFigure | VariationFigure;
export type MathFigureProps = { w: number; h: number; figure: MathFigure };

export const MAX_LESSON_MATH_SAMPLES = 250_000;
export const MAX_LESSON_MATH_SOURCE_CHARS = 8_000_000;
const sourceSizes = new WeakMap<MathFigure, number>();

export function mathFigureSampleCount(figure: MathFigure) {
  return figure.kind === "graph"
    ? figure.data.holes.length +
        figure.data.segments.reduce((sum, segment) => sum + segment.length, 0)
    : 0;
}

/** Native records retain figure identity across pen saves and transforms. */
export function mathFigureSourceSize(figure: MathFigure) {
  const cached = sourceSizes.get(figure);
  if (cached !== undefined) return cached;
  const sourceOnly =
    figure.kind === "graph"
      ? {
          ...figure,
          data: {
            evaluations: figure.data.evaluations,
            warnings: figure.data.warnings,
          },
        }
      : figure;
  const size = JSON.stringify(sourceOnly).length;
  sourceSizes.set(figure, size);
  return size;
}

const expressionLimit = 1024;
const normalizedLimit = 2048;
const nodeLimit = 192;
const depthLimit = 32;
const pointLimit = 8192;
const viewportLimit = 1e12;
const numberLiteral = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const calls = [
  "sqrt",
  "ln",
  "log",
  "log10",
  "exp",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "abs",
  "root",
] as const;

function check(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(`Invalid math figure ${detail}.`);
}

function record(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "record",
  );
  const keys = Object.keys(value);
  check(
    required.every((key) => Object.hasOwn(value, key)) &&
      keys.length <= required.length + optional.length &&
      keys.every((key) => required.includes(key) || optional.includes(key)),
    "fields",
  );
  return value as Record<string, unknown>;
}

function isChoice<T extends string | number>(
  value: unknown,
  choices: readonly T[],
): value is T {
  return choices.includes(value as T);
}

function finite(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function integer(value: unknown, min: number, max: number): value is number {
  return finite(value, min, max) && Number.isSafeInteger(value);
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function strings(value: unknown, maxCount = 64): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxCount &&
    value.every((item) => boundedText(item, 512))
  );
}

function validateAst(
  value: unknown,
  budget: { count: number },
  depth = 1,
): asserts value is MathAst {
  check(
    depth <= depthLimit && ++budget.count <= nodeLimit,
    "expression complexity",
  );
  const node = value as { kind?: unknown } | null;
  switch (node?.kind) {
    case "number": {
      const n = record(value, ["kind", "raw", "value"]);
      check(
        boundedText(n.raw, expressionLimit) &&
          numberLiteral.test(n.raw) &&
          finite(n.value, 0, Number.MAX_VALUE) &&
          Number(n.raw) === n.value,
        "number literal",
      );
      break;
    }
    case "symbol":
      check(
        isChoice(record(value, ["kind", "name"]).name, ["x", "pi", "e"]),
        "symbol",
      );
      break;
    case "unary":
    case "postfix": {
      const n = record(value, ["kind", "op", "arg"]);
      check(
        isChoice(n.op, node.kind === "unary" ? ["+", "-"] : ["!", "%"]),
        "operator",
      );
      validateAst(n.arg, budget, depth + 1);
      break;
    }
    case "binary": {
      const n = record(value, ["kind", "op", "left", "right"]);
      check(isChoice(n.op, ["+", "-", "*", "/", "^"]), "binary operator");
      validateAst(n.left, budget, depth + 1);
      validateAst(n.right, budget, depth + 1);
      break;
    }
    case "call": {
      const n = record(value, ["kind", "name", "args"]);
      check(
        isChoice(n.name, calls) &&
          Array.isArray(n.args) &&
          n.args.length === (n.name === "root" ? 2 : 1),
        "function call",
      );
      for (const arg of n.args) validateAst(arg, budget, depth + 1);
      break;
    }
    default:
      check(false, "expression node");
  }
}

function validateExpression(value: unknown): asserts value is ParsedExpression {
  const expression = record(value, [
    "source",
    "normalized",
    "ast",
    "variables",
    "angleMode",
    "domain",
  ]);
  check(
    boundedText(expression.source, expressionLimit) &&
      boundedText(expression.normalized, normalizedLimit) &&
      isChoice(expression.angleMode, ["RAD", "DEG"]) &&
      Array.isArray(expression.variables) &&
      expression.variables.length <= 1 &&
      expression.variables.every((name) => name === "x") &&
      Array.isArray(expression.domain) &&
      expression.domain.length <= nodeLimit,
    "expression",
  );
  validateAst(expression.ast, { count: 0 });
  for (const value of expression.domain) {
    const restriction = record(value, ["kind", "expression", "description"]);
    check(
      isChoice(restriction.kind, [
        "positive",
        "nonnegative",
        "nonzero",
        "unit-interval",
        "real-power",
        "trig-pole",
      ]) && boundedText(restriction.description, normalizedLimit),
      "domain restriction",
    );
    validateAst(restriction.expression, { count: 0 });
  }
}

function validateStyle(value: unknown): asserts value is FigureStyle {
  const style = record(value, [
    "stroke",
    "strokeWidth",
    "background",
    "grid",
    "axes",
    "tickDensity",
  ]);
  check(
    typeof style.stroke === "string" &&
      /^#[0-9a-f]{6}$/i.test(style.stroke) &&
      finite(style.strokeWidth, 0.5, 12) &&
      isChoice(style.background, ["white", "transparent", "dark", "green"]) &&
      typeof style.grid === "boolean" &&
      typeof style.axes === "boolean" &&
      isChoice(style.tickDensity, ["low", "normal", "high"]),
    "style",
  );
}

function validateGraph(figure: Record<string, unknown>) {
  const bounds = record(figure.viewport, ["xMin", "xMax", "yMin", "yMax"]);
  const { xMin, xMax, yMin, yMax } = bounds;
  check(
    finite(xMin, -viewportLimit, viewportLimit) &&
      finite(xMax, -viewportLimit, viewportLimit) &&
      finite(yMin, -viewportLimit, viewportLimit) &&
      finite(yMax, -viewportLimit, viewportLimit) &&
      xMax - xMin >=
        Math.max(
          1e-12,
          Math.max(Math.abs(xMin), Math.abs(xMax)) * Number.EPSILON * 32,
        ) &&
      yMax - yMin >=
        Math.max(
          1e-12,
          Math.max(Math.abs(yMin), Math.abs(yMax)) * Number.EPSILON * 32,
        ),
    "graph window",
  );
  const size = record(figure.sampleSize, ["width", "height"]);
  check(
    finite(size.width, 32, 8192) && finite(size.height, 32, 8192),
    "sample dimensions",
  );
  const data = record(figure.data, [
    "segments",
    "holes",
    "evaluations",
    "warnings",
  ]);
  check(
    Array.isArray(data.segments) &&
      data.segments.length <= pointLimit / 2 &&
      Array.isArray(data.holes) &&
      data.holes.length <= 64 &&
      integer(data.evaluations, 0, pointLimit) &&
      strings(data.warnings),
    "plot data",
  );
  let points = 0;
  const validatePoint = (value: unknown) => {
    const p = record(value, ["x", "y"]);
    const toleranceX =
      32 * Number.EPSILON * Math.max(1, Math.abs(xMin), Math.abs(xMax));
    const toleranceY =
      32 * Number.EPSILON * Math.max(1, Math.abs(yMin), Math.abs(yMax));
    check(
      finite(p.x, xMin - toleranceX, xMax + toleranceX) &&
        finite(p.y, yMin - toleranceY, yMax + toleranceY),
      "clipped point",
    );
    return p.x;
  };
  for (const segment of data.segments) {
    check(
      Array.isArray(segment) &&
        segment.length >= 2 &&
        (points += segment.length) <= pointLimit,
      "plot point limit",
    );
    let previous = -Infinity;
    for (const p of segment) {
      const x = validatePoint(p);
      check(x >= previous, "plot point order");
      previous = x;
    }
  }
  data.holes.forEach(validatePoint);
}

function mathValue(value: unknown): asserts value is MathValue {
  const v = record(value, ["value", "label", "exact"]);
  check(
    boundedText(v.label, 512) &&
      typeof v.exact === "boolean" &&
      (finite(v.value, -Number.MAX_VALUE, Number.MAX_VALUE) ||
        (v.value === null &&
          v.exact &&
          isChoice(v.label, ["−∞", "-∞", "+∞", "∞"]))),
    "analysis value",
  );
}

function sameMathValue(a: MathValue | undefined, b: MathValue | undefined) {
  return (
    a !== undefined &&
    b !== undefined &&
    a.value === b.value &&
    a.label === b.label &&
    a.exact === b.exact
  );
}

function coordinate(value: MathValue, side: "left" | "right"): number {
  if (value.value !== null) return value.value;
  check(
    isChoice(value.label, side === "left" ? ["−∞", "-∞"] : ["+∞", "∞"]),
    "variation infinity direction",
  );
  return side === "left" ? -Infinity : Infinity;
}

function expectedExtremum(left: VariationInterval, right: VariationInterval) {
  if (left.sign > 0 && right.sign < 0) return "maximum";
  if (left.sign < 0 && right.sign > 0) return "minimum";
  return "none";
}

function validateVariationLinks(data: VariationAnalysis) {
  const { points, intervals } = data;
  const first = intervals[0],
    last = intervals[intervals.length - 1];
  const boundaries = new Map<number, MathValue>();
  let previous = -Infinity;
  for (const point of points) {
    check(
      point.x.value !== null && point.x.value > previous,
      "variation point order",
    );
    previous = point.x.value;
  }
  for (const [index, interval] of intervals.entries()) {
    const left = coordinate(interval.left, "left"),
      right = coordinate(interval.right, "right");
    check(left < right, "variation interval order");
    check(
      (Number.isFinite(left) || index === 0) &&
        (Number.isFinite(right) || index === intervals.length - 1),
      "variation outer infinity",
    );
    if (index > 0)
      check(
        sameMathValue(interval.left, intervals[index - 1].right),
        "variation linked intervals",
      );
    for (const boundary of [interval.left, interval.right]) {
      if (boundary.value === null) continue;
      const prior = boundaries.get(boundary.value);
      check(
        prior === undefined || sameMathValue(prior, boundary),
        "variation shared boundary",
      );
      boundaries.set(boundary.value, boundary);
    }
  }
  check(boundaries.size === points.length, "variation boundary count");
  for (const point of points) {
    const x = point.x.value!;
    check(
      sameMathValue(boundaries.get(x), point.x),
      "variation point boundary",
    );
    const left = intervals.find((interval) => interval.right.value === x);
    const right = intervals.find((interval) => interval.left.value === x);
    check(
      Boolean(left) === Boolean(point.leftLimit) &&
        Boolean(right) === Boolean(point.rightLimit),
      "variation one-sided limits",
    );
    if (point.kind === "excluded") {
      check(
        !point.included &&
          !point.derivativeZero &&
          point.derivativeUndefined &&
          point.extremum === "none" &&
          point.value === undefined,
        "variation excluded point",
      );
      if (left && right) {
        check(
          point.discontinuity !== undefined,
          "variation excluded discontinuity",
        );
        if (point.discontinuity === "hole")
          check(
            point.leftLimit?.value !== null &&
              sameMathValue(point.leftLimit, point.rightLimit),
            "variation removable limit",
          );
        else
          check(
            point.leftLimit?.value === null || point.rightLimit?.value === null,
            "variation pole limit",
          );
      }
    } else {
      check(
        point.included &&
          point.value?.value != null &&
          point.discontinuity === undefined,
        "variation included point",
      );
      if (left)
        check(
          sameMathValue(point.value, point.leftLimit),
          "variation continuous left limit",
        );
      if (right)
        check(
          sameMathValue(point.value, point.rightLimit),
          "variation continuous right limit",
        );
      if (point.kind === "endpoint")
        check(
          Boolean(left) !== Boolean(right) &&
            !point.derivativeZero &&
            point.derivativeUndefined &&
            point.extremum === "none",
          "variation endpoint",
        );
      else {
        check(
          left !== undefined && right !== undefined,
          "variation interior point",
        );
        check(
          point.derivativeZero === (point.kind === "stationary") &&
            point.derivativeUndefined === (point.kind === "nondifferentiable"),
          "variation derivative flags",
        );
        check(
          point.extremum === expectedExtremum(left, right),
          "variation extremum signs",
        );
      }
    }
  }
  const leftPoint = points.find((point) => point.x.value === first.left.value);
  const rightPoint = points.find((point) => point.x.value === last.right.value);
  if (first.left.value !== null)
    check(
      sameMathValue(data.leftLimit, leftPoint?.rightLimit),
      "variation domain left limit",
    );
  if (last.right.value !== null)
    check(
      sameMathValue(data.rightLimit, rightPoint?.leftLimit),
      "variation domain right limit",
    );
}

function validateVariation(
  figure: Record<string, unknown>,
  expression: ParsedExpression,
) {
  const data = record(figure.data, [
    "schemaVersion",
    "engineVersion",
    "family",
    "source",
    "normalized",
    "domain",
    "derivative",
    "verified",
    "method",
    "points",
    "intervals",
    "leftLimit",
    "rightLimit",
    "notes",
  ]);
  check(
    expression.angleMode === "RAD" &&
      data.schemaVersion === 1 &&
      data.engineVersion === "s06-exact-v1" &&
      isChoice(data.family, [
        "polynomial",
        "rational",
        "logarithmic",
        "radical",
        "absolute",
      ]) &&
      data.source === expression.source &&
      data.normalized === expression.normalized &&
      data.verified === true &&
      boundedText(data.domain, normalizedLimit) &&
      boundedText(data.derivative, normalizedLimit) &&
      boundedText(data.method, 512) &&
      Array.isArray(data.points) &&
      data.points.length <= 48 &&
      Array.isArray(data.intervals) &&
      data.intervals.length > 0 &&
      data.intervals.length <= 48 &&
      strings(data.notes, 48),
    "variation analysis",
  );
  mathValue(data.leftLimit);
  mathValue(data.rightLimit);
  for (const value of data.points) {
    const point = record(
      value,
      [
        "x",
        "kind",
        "included",
        "derivativeZero",
        "derivativeUndefined",
        "extremum",
      ],
      ["value", "leftLimit", "rightLimit", "discontinuity"],
    );
    mathValue(point.x);
    check(
      point.x.value !== null &&
        isChoice(point.kind, [
          "stationary",
          "excluded",
          "endpoint",
          "nondifferentiable",
        ]) &&
        typeof point.included === "boolean" &&
        typeof point.derivativeZero === "boolean" &&
        typeof point.derivativeUndefined === "boolean" &&
        isChoice(point.extremum, ["maximum", "minimum", "none"]) &&
        (point.discontinuity === undefined ||
          isChoice(point.discontinuity, ["pole", "hole"])),
      "variation point",
    );
    for (const key of ["value", "leftLimit", "rightLimit"]) {
      if (Object.hasOwn(point, key)) mathValue(point[key]);
    }
  }
  for (const value of data.intervals) {
    const interval = record(value, ["left", "right", "sign", "trend"]);
    mathValue(interval.left);
    mathValue(interval.right);
    check(
      (interval.sign === -1 && interval.trend === "decreasing") ||
        (interval.sign === 0 && interval.trend === "constant") ||
        (interval.sign === 1 && interval.trend === "increasing"),
      "variation sign",
    );
  }
  validateVariationLinks(data as unknown as VariationAnalysis);
}

/** Validate only the retained v1 format. Archive reads do not silently recalculate it. */
export function validateMathFigure(value: unknown): MathFigure {
  const kind = (value as { kind?: unknown } | null)?.kind;
  check(isChoice(kind, ["graph", "variation"]), "kind");
  const figure = record(value, [
    "kind",
    "schemaVersion",
    "expression",
    "style",
    "data",
    ...(kind === "graph" ? ["viewport", "sampleSize"] : []),
  ]);
  check(figure.schemaVersion === 1, "version");
  validateExpression(figure.expression);
  validateStyle(figure.style);
  if (kind === "graph") validateGraph(figure);
  else validateVariation(figure, figure.expression);
  return value as MathFigure;
}

export function validateFigureProps(value: unknown): MathFigureProps {
  const props = record(value, ["w", "h", "figure"]);
  check(finite(props.w, 1, 100000) && finite(props.h, 1, 100000), "dimensions");
  validateMathFigure(props.figure);
  return value as MathFigureProps;
}
