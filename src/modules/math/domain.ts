import { evaluateAst, MAX_TRIG_ARGUMENT } from "./expression.ts";
import type { AngleMode, MathAst, MathCallName } from "./types.ts";

export type Interval = { kind: "range"; min: number; max: number };
type DomainInterval =
  Interval | { kind: "outside" } | { kind: "unknown" } | { kind: "unresolved" };
const outside = { kind: "outside" } as const;
const unknown = { kind: "unknown" } as const;
const unresolved = { kind: "unresolved" } as const;
const range = (min: number, max: number): Interval => ({
  kind: "range",
  min,
  max,
});
const containsZero = ({ min, max }: Interval) => min <= 0 && max >= 0;
const exactZero = ({ min, max }: Interval) => min === 0 && max === 0;

function lower(value: number): number {
  return value === 0
    ? 0
    : value - Math.max(Math.abs(value) * Number.EPSILON * 4, Number.MIN_VALUE);
}
function upper(value: number): number {
  return value === 0
    ? 0
    : value + Math.max(Math.abs(value) * Number.EPSILON * 4, Number.MIN_VALUE);
}
function enclosing(...values: number[]): DomainInterval {
  if (!values.every(Number.isFinite)) return unknown;
  return range(lower(Math.min(...values)), upper(Math.max(...values)));
}

function powers(base: Interval, exponent: Interval): DomainInterval {
  if (exactZero(base))
    return exponent.min > 0
      ? range(0, 0)
      : exponent.max <= 0
        ? outside
        : unknown;
  if (exponent.min === exponent.max && Number.isSafeInteger(exponent.min)) {
    const n = exponent.min;
    if (n <= 0 && containsZero(base)) return unknown;
    const left = Math.pow(base.min, n),
      right = Math.pow(base.max, n);
    return n > 0 && n % 2 === 0 && containsZero(base)
      ? enclosing(0, left, right)
      : enclosing(left, right);
  }
  if (base.max < 0) return exponent.min === exponent.max ? outside : unresolved;
  if (base.min < 0 || (base.min === 0 && exponent.min <= 0)) return unknown;
  // Positive real powers are continuous. The extrema of exp(y*ln(x)) lie at corners.
  return enclosing(
    Math.pow(base.min, exponent.min),
    Math.pow(base.min, exponent.max),
    Math.pow(base.max, exponent.min),
    Math.pow(base.max, exponent.max),
  );
}

function divide(left: Interval, right: Interval): DomainInterval {
  if (containsZero(right)) return exactZero(right) ? outside : unknown;
  return enclosing(
    left.min / right.min,
    left.min / right.max,
    left.max / right.min,
    left.max / right.max,
  );
}

function periodicIn(
  min: number,
  max: number,
  phase: number,
  period: number,
): boolean {
  // Expand the input before counting crossings to account for argument/phase rounding.
  return (
    Math.ceil((lower(min) - phase) / period) <=
    Math.floor((upper(max) - phase) / period)
  );
}

function trig(
  name: "sin" | "cos" | "tan",
  arg: Interval,
  mode: AngleMode,
): DomainInterval {
  if (arg.min > MAX_TRIG_ARGUMENT || arg.max < -MAX_TRIG_ARGUMENT)
    return unresolved;
  if (Math.max(Math.abs(arg.min), Math.abs(arg.max)) > MAX_TRIG_ARGUMENT)
    return unknown;
  const full = mode === "DEG" ? 360 : 2 * Math.PI;
  const quarter = full / 4;
  const radians = (value: number) =>
    mode === "DEG" ? (value % 360) * (Math.PI / 180) : value;
  const min = Math[name](radians(arg.min)),
    max = Math[name](radians(arg.max));
  if (name === "tan") {
    if (periodicIn(arg.min, arg.max, quarter, full / 2)) return unknown;
    return enclosing(min, max);
  }
  if (arg.max - arg.min >= full) return range(-1, 1);
  const highest = name === "sin" ? quarter : 0;
  return range(
    periodicIn(arg.min, arg.max, highest + full / 2, full)
      ? -1
      : lower(Math.min(min, max)),
    periodicIn(arg.min, arg.max, highest, full) ? 1 : upper(Math.max(min, max)),
  );
}

function callRange(
  name: MathCallName,
  args: Interval[],
  mode: AngleMode,
): DomainInterval {
  const [arg, degree] = args;
  const { min, max } = arg;
  switch (name) {
    case "sqrt":
      return max < 0
        ? outside
        : min < 0
          ? unknown
          : enclosing(Math.sqrt(min), Math.sqrt(max));
    case "ln":
    case "log":
    case "log10": {
      if (max <= 0) return outside;
      if (min <= 0) return unknown;
      const log = name === "ln" ? Math.log : Math.log10;
      return enclosing(log(min), log(max));
    }
    case "exp":
      return enclosing(Math.exp(min), Math.exp(max));
    case "abs":
      return enclosing(
        containsZero(arg) ? 0 : Math.min(Math.abs(min), Math.abs(max)),
        Math.max(Math.abs(min), Math.abs(max)),
      );
    case "root": {
      const n = degree.min;
      if (n !== degree.max) return unknown;
      if (!Number.isInteger(n) || n < 1 || n > 1024) return outside;
      if (n % 2 === 0 && min < 0) return max < 0 ? outside : unknown;
      const root = (value: number) =>
        Math.sign(value) * Math.pow(Math.abs(value), 1 / n);
      return enclosing(root(min), root(max));
    }
    case "sin":
    case "cos":
    case "tan":
      return trig(name, arg, mode);
    case "asin":
    case "acos":
    case "atan": {
      if (name !== "atan") {
        if (max < -1 || min > 1) return outside;
        if (min < -1 || max > 1) return unknown;
      }
      const scale = mode === "DEG" ? 180 / Math.PI : 1;
      return enclosing(Math[name](min) * scale, Math[name](max) * scale);
    }
  }
}

/** Precompute constant branches once. A graph cell draws only when its domain is resolved. */
export function prepareDomain(ast: MathAst, mode: AngleMode) {
  const constants = new WeakMap<MathAst, DomainInterval>();
  let discrete = false,
    oscillatory = false;
  function classify(node: MathAst): boolean {
    let variable: boolean;
    switch (node.kind) {
      case "symbol":
        variable = node.name === "x";
        break;
      case "number":
        variable = false;
        break;
      case "unary":
      case "postfix":
        variable = classify(node.arg);
        if (node.kind === "postfix" && node.op === "!" && variable)
          discrete = true;
        break;
      case "binary": {
        const left = classify(node.left),
          right = classify(node.right);
        variable = left || right;
        break;
      }
      case "call": {
        const args = node.args.map(classify);
        if (node.name === "root" && args[1]) discrete = true;
        if (
          args[0] &&
          (node.name === "sin" || node.name === "cos" || node.name === "tan")
        )
          oscillatory = true;
        variable = args.some(Boolean);
        break;
      }
    }
    if (!variable) {
      const value = evaluateAst(node, 0, mode, { remaining: 4096 });
      constants.set(
        node,
        value.status === "supported"
          ? range(value.value, value.value)
          : value.status === "limit"
            ? unknown
            : outside,
      );
    }
    return variable;
  }
  classify(ast);

  function evaluate(node: MathAst, x: Interval): DomainInterval {
    const constant = constants.get(node);
    if (constant) return constant;
    switch (node.kind) {
      case "number":
        return range(node.value, node.value);
      case "symbol":
        return x;
      case "unary": {
        const arg = evaluate(node.arg, x);
        return arg.kind !== "range" || node.op === "+"
          ? arg
          : range(-arg.max, -arg.min);
      }
      case "postfix": {
        if (node.op === "!") return unknown;
        const arg = evaluate(node.arg, x);
        return arg.kind === "range"
          ? enclosing(arg.min / 100, arg.max / 100)
          : arg;
      }
      case "binary": {
        const left = evaluate(node.left, x),
          right = evaluate(node.right, x);
        if (left.kind === "outside" || right.kind === "outside") return outside;
        if (left.kind === "unresolved" || right.kind === "unresolved")
          return unresolved;
        if (left.kind !== "range" || right.kind !== "range") return unknown;
        switch (node.op) {
          case "+":
            return enclosing(left.min + right.min, left.max + right.max);
          case "-":
            return enclosing(left.min - right.max, left.max - right.min);
          case "*":
            return enclosing(
              left.min * right.min,
              left.min * right.max,
              left.max * right.min,
              left.max * right.max,
            );
          case "/":
            return divide(left, right);
          case "^":
            return powers(left, right);
        }
      }
      case "call": {
        const args = node.args.map((arg) => evaluate(arg, x));
        if (args.some((arg) => arg.kind === "outside")) return outside;
        if (args.some((arg) => arg.kind === "unresolved")) return unresolved;
        if (!args.every((arg): arg is Interval => arg.kind === "range"))
          return unknown;
        return callRange(node.name, args, mode);
      }
    }
  }
  return {
    discrete,
    oscillatory,
    interval: (min: number, max: number) => evaluate(ast, range(min, max)),
  };
}
