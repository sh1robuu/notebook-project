import type { MathAst } from "./types.ts";

export type AnalysisFailure =
  "undefined" | "unsupported" | "inconclusive" | "limit";
export class AlgebraError extends Error {
  readonly status: AnalysisFailure;
  constructor(status: AnalysisFailure, message: string) {
    super(message);
    this.status = status;
  }
}

export type Budget = () => void;
export function algebraBudget(
  signal?: AbortSignal,
  maxOperations = 12_000,
): Budget {
  let remaining = Number.isFinite(maxOperations)
    ? Math.min(12_000, maxOperations)
    : 12_000;
  return () => {
    if (signal?.aborted || --remaining < 0)
      throw new AlgebraError(
        "limit",
        "The variation analysis exceeded its calculation budget or was cancelled.",
      );
  };
}

export type Sign = -1 | 0 | 1;
export type Rational = { n: bigint; d: bigint };
export type Polynomial = Rational[];
const zero: Rational = { n: 0n, d: 1n };
const one: Rational = { n: 1n, d: 1n };
const bits = (n: bigint) => (n < 0n ? -n : n).toString(2).length;
export const sign = (q: Rational): Sign => (q.n < 0n ? -1 : q.n > 0n ? 1 : 0);
const flip = (value: bigint) => (value < 0n ? -value : value);

function gcd(a: bigint, b: bigint) {
  a = flip(a);
  b = flip(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function rational(n: bigint, d = 1n): Rational {
  if (d === 0n)
    throw new AlgebraError("undefined", "Division by zero has no real value.");
  if (n === 0n) return zero;
  const divisor = gcd(n, d) * (d < 0n ? -1n : 1n);
  const reduced = { n: n / divisor, d: d / divisor };
  if (bits(reduced.n) > 256 || bits(reduced.d) > 256)
    throw new AlgebraError(
      "limit",
      "An exact coefficient is too large for the variation table.",
    );
  return reduced;
}

export const plus = (a: Rational, b: Rational) =>
  rational(a.n * b.d + b.n * a.d, a.d * b.d);
export const minus = (a: Rational, b: Rational) =>
  rational(a.n * b.d - b.n * a.d, a.d * b.d);
export const times = (a: Rational, b: Rational) =>
  rational(a.n * b.n, a.d * b.d);
export const over = (a: Rational, b: Rational) =>
  rational(a.n * b.d, a.d * b.n);
export const negative = (q: Rational): Rational => ({ n: -q.n, d: q.d });
const same = (a: Rational, b: Rational) => a.n === b.n && a.d === b.d;
const absolute = (q: Rational): Rational => ({ n: flip(q.n), d: q.d });

function fromLiteral(raw: string): Rational {
  const match = /^(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!match || !(match[1] || match[2]))
    throw new AlgebraError(
      "unsupported",
      "This coefficient cannot be represented exactly.",
    );
  const decimals = match[2] ?? "";
  const digits = (match[1] + decimals).replace(/^0+/, "");
  if (!digits) return zero;
  const exponent = Number(match[3] ?? 0) - decimals.length;
  if (
    digits.length > 64 ||
    !Number.isSafeInteger(exponent) ||
    Math.abs(exponent) > 64
  )
    throw new AlgebraError(
      "limit",
      "Use at most 64 significant digits and a decimal exponent from −64 to 64 for exact analysis.",
    );
  const magnitude = 10n ** BigInt(Math.abs(exponent));
  return exponent >= 0
    ? rational(BigInt(digits) * magnitude)
    : rational(BigInt(digits), magnitude);
}

function trim(poly: Polynomial): Polynomial {
  while (poly.length > 1 && sign(poly.at(-1)!) === 0) poly.pop();
  return poly;
}

export const isZero = (poly: Polynomial) =>
  poly.length === 1 && sign(poly[0]) === 0;
export const degree = (poly: Polynomial) => poly.length - 1;
export const lead = (poly: Polynomial) => poly.at(-1)!;
export const scale = (poly: Polynomial, factor: Rational) =>
  trim(poly.map((q) => times(q, factor)));

export function subtract(a: Polynomial, b: Polynomial) {
  return trim(
    Array.from({ length: Math.max(a.length, b.length) }, (_, i) =>
      minus(a[i] ?? zero, b[i] ?? zero),
    ),
  );
}

export function multiply(a: Polynomial, b: Polynomial): Polynomial {
  if (isZero(a) || isZero(b)) return [zero];
  if (degree(a) + degree(b) > 8)
    throw new AlgebraError(
      "unsupported",
      "An intermediate polynomial exceeds degree 8.",
    );
  const result = Array<Rational>(a.length + b.length - 1).fill(zero);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++)
      result[i + j] = plus(result[i + j], times(a[i], b[j]));
  }
  return trim(result);
}

export const differentiate = (poly: Polynomial) =>
  poly.length === 1
    ? [zero]
    : trim(poly.slice(1).map((q, i) => times(q, rational(BigInt(i + 1)))));

export function polynomialDivision(
  numerator: Polynomial,
  denominator: Polynomial,
) {
  let remainder = numerator;
  const quotient = Array<Rational>(
    Math.max(1, degree(numerator) - degree(denominator) + 1),
  ).fill(zero);
  while (!isZero(remainder) && degree(remainder) >= degree(denominator)) {
    const shift = degree(remainder) - degree(denominator);
    const factor = over(lead(remainder), lead(denominator));
    quotient[shift] = factor;
    remainder = subtract(remainder, [
      ...Array<Rational>(shift).fill(zero),
      ...scale(denominator, factor),
    ]);
  }
  return { quotient: trim(quotient), remainder };
}

type Fraction = {
  numerator: Polynomial;
  denominator: Polynomial;
  exclusions: Polynomial[];
};
function fraction(
  numerator: Polynomial,
  denominator: Polynomial = [one],
  exclusions: Polynomial[] = [],
): Fraction {
  if (isZero(denominator))
    throw new AlgebraError(
      "undefined",
      "The denominator vanishes throughout its real domain.",
    );
  const normalization = over(one, lead(denominator));
  return {
    numerator: scale(numerator, normalization),
    denominator: scale(denominator, normalization),
    exclusions,
  };
}

function exponentOf(ast: MathAst): Rational | undefined {
  if (ast.kind === "number") return fromLiteral(ast.raw);
  if (ast.kind === "unary") {
    const arg = exponentOf(ast.arg);
    return arg && (ast.op === "-" ? negative(arg) : arg);
  }
}

// Keep every original denominator constraint, including those removed by inversion or powers.
export function asFraction(ast: MathAst, spend: Budget): Fraction {
  spend();
  switch (ast.kind) {
    case "number":
      return fraction([fromLiteral(ast.raw)]);
    case "symbol":
      if (ast.name === "x") return fraction([zero, one]);
      break;
    case "unary": {
      const a = asFraction(ast.arg, spend);
      return ast.op === "-"
        ? { ...a, numerator: scale(a.numerator, negative(one)) }
        : a;
    }
    case "binary": {
      const a = asFraction(ast.left, spend);
      if (ast.op === "^") {
        const exponent = exponentOf(ast.right);
        if (!exponent || exponent.d !== 1n || flip(exponent.n) > 8n)
          throw new AlgebraError(
            "unsupported",
            "Exact rational analysis requires integer literal powers from −8 to 8.",
          );
        const inverse = exponent.n < 0n;
        const excludesZero = exponent.n <= 0n;
        if (excludesZero && isZero(a.numerator))
          throw new AlgebraError(
            "undefined",
            "Zero to a nonpositive power is undefined.",
          );
        let numerator = [one],
          denominator = [one];
        for (let i = 0; i < Number(flip(exponent.n)); i++) {
          spend();
          numerator = multiply(
            numerator,
            inverse ? a.denominator : a.numerator,
          );
          denominator = multiply(
            denominator,
            inverse ? a.numerator : a.denominator,
          );
        }
        return fraction(
          numerator,
          denominator,
          excludesZero ? [...a.exclusions, a.numerator] : a.exclusions,
        );
      }
      const b = asFraction(ast.right, spend);
      const exclusions = [...a.exclusions, ...b.exclusions];
      if (ast.op === "/")
        return fraction(
          multiply(a.numerator, b.denominator),
          multiply(a.denominator, b.numerator),
          [...exclusions, b.numerator],
        );
      const denominator = multiply(a.denominator, b.denominator);
      if (ast.op === "*")
        return fraction(
          multiply(a.numerator, b.numerator),
          denominator,
          exclusions,
        );
      const left = multiply(a.numerator, b.denominator);
      const right = multiply(b.numerator, a.denominator);
      return fraction(
        subtract(left, ast.op === "+" ? scale(right, negative(one)) : right),
        denominator,
        exclusions,
      );
    }
  }
  throw new AlgebraError(
    "unsupported",
    "Verified tables support rational-coefficient polynomials, low-degree rational functions, and ln, sqrt, or abs of an affine expression.",
  );
}

export const rationalLabel = (q: Rational) =>
  q.d === 1n ? String(q.n) : `${q.n}/${q.d}`;
export function polynomialLabel(poly: Polynomial) {
  const terms: string[] = [];
  for (let exponent = degree(poly); exponent >= 0; exponent--) {
    const coefficient = poly[exponent];
    if (!sign(coefficient)) continue;
    const magnitude = absolute(coefficient);
    const prefix = sign(coefficient) < 0 ? "-" : terms.length ? "+" : "";
    const factor =
      exponent === 0 || !same(magnitude, one) ? rationalLabel(magnitude) : "";
    const variable = exponent > 1 ? `x^${exponent}` : exponent ? "x" : "";
    terms.push(
      prefix +
        (factor && variable && magnitude.d !== 1n ? `(${factor})` : factor) +
        variable,
    );
  }
  return terms.join("") || "0";
}

// An exact real quadratic value a + b√r. Rational values have b=0 and r=0.
export type Surd = { a: Rational; b: Rational; r: Rational };
export const asSurd = (a: Rational): Surd => ({ a, b: zero, r: zero });

function isqrt(value: bigint, spend: Budget): bigint {
  if (value < 2n) return value;
  let previous = 1n << BigInt(Math.ceil(bits(value) / 2));
  for (;;) {
    spend();
    const next = (previous + value / previous) >> 1n;
    if (next >= previous) return previous;
    previous = next;
  }
}

function sqrtExact(value: Rational, spend: Budget) {
  const n = isqrt(value.n, spend),
    d = isqrt(value.d, spend);
  return n * n === value.n && d * d === value.d ? rational(n, d) : undefined;
}

export function realRoots(
  poly: Polynomial,
  spend: Budget,
): { x: Surd; order: number }[] {
  spend();
  if (!degree(poly)) return [];
  const [c, b, a] = poly;
  if (degree(poly) === 1)
    return [{ x: asSurd(over(negative(c), b)), order: 1 }];
  if (degree(poly) !== 2)
    throw new AlgebraError(
      "unsupported",
      "An original denominator or derivative factor exceeds degree 2.",
    );
  const twoA = times(rational(2n), a);
  const center = over(negative(b), twoA);
  const discriminant = minus(times(b, b), times(rational(4n), times(a, c)));
  if (sign(discriminant) < 0) return [];
  if (sign(discriminant) === 0) return [{ x: asSurd(center), order: 2 }];
  const radiusScale = over(one, absolute(twoA));
  const radicand = times(times(radiusScale, radiusScale), discriminant);
  const radius = sqrtExact(radicand, spend);
  return radius
    ? [
        { x: asSurd(minus(center, radius)), order: 1 },
        { x: asSurd(plus(center, radius)), order: 1 },
      ]
    : [
        { x: { a: center, b: negative(one), r: radicand }, order: 1 },
        { x: { a: center, b: one, r: radicand }, order: 1 },
      ];
}

const squaredRadical = (x: Surd) => times(times(x.b, x.b), x.r);
export function surdSign(x: Surd): Sign {
  const a = sign(x.a),
    b = sign(x.b);
  if (!a) return b;
  if (!b || a === b) return a;
  const magnitude = sign(minus(times(x.a, x.a), squaredRadical(x)));
  return magnitude === 0 ? 0 : magnitude > 0 ? a : b;
}

// Raw fractions used only in root isolation. They can exceed stored coefficient precision.
function compareFractions(a: Rational, b: Rational): Sign {
  const delta = a.n * b.d - b.n * a.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

function surdBounds(
  x: Surd,
  precision: bigint,
  spend: Budget,
): [Rational, Rational] {
  if (!sign(x.b)) return [x.a, x.a];
  const square = squaredRadical(x);
  const lower = isqrt((square.n * precision * precision) / square.d, spend);
  const denominator = x.a.d * precision;
  const center = x.a.n * precision;
  return sign(x.b) > 0
    ? [
        { n: center + x.a.d * lower, d: denominator },
        { n: center + x.a.d * (lower + 1n), d: denominator },
      ]
    : [
        { n: center - x.a.d * (lower + 1n), d: denominator },
        { n: center - x.a.d * lower, d: denominator },
      ];
}

export function compareSurds(a: Surd, b: Surd, spend: Budget): Sign {
  spend();
  if (
    same(a.a, b.a) &&
    sign(a.b) === sign(b.b) &&
    same(squaredRadical(a), squaredRadical(b))
  )
    return 0;
  for (const bits of [24n, 48n, 96n, 192n, 384n]) {
    const precision = 1n << bits;
    const [aLow, aHigh] = surdBounds(a, precision, spend);
    const [bLow, bHigh] = surdBounds(b, precision, spend);
    if (compareFractions(aHigh, bLow) < 0) return -1;
    if (compareFractions(aLow, bHigh) > 0) return 1;
  }
  throw new AlgebraError(
    "inconclusive",
    "Two exact boundaries could not be separated within the calculation budget.",
  );
}

function quadratic(a: Rational, b: Rational, r: Rational): Surd {
  return sign(b) === 0 ? asSurd(a) : { a, b, r };
}

function surdMultiply(a: Surd, b: Surd, r: Rational): Surd {
  return quadratic(
    plus(times(a.a, b.a), times(times(a.b, b.b), r)),
    plus(times(a.a, b.b), times(a.b, b.a)),
    r,
  );
}

export function evaluatePolynomial(poly: Polynomial, x: Surd): Surd {
  let result = asSurd(zero);
  for (let i = degree(poly); i >= 0; i--) {
    result = surdMultiply(result, x, x.r);
    result = quadratic(plus(result.a, poly[i]), result.b, x.r);
  }
  return result;
}

export function divideSurds(a: Surd, b: Surd, r: Rational): Surd {
  const conjugate = quadratic(b.a, negative(b.b), r);
  const product = surdMultiply(a, conjugate, r);
  const norm = minus(times(b.a, b.a), times(times(b.b, b.b), r));
  return quadratic(over(product.a, norm), over(product.b, norm), r);
}

export function leadingLocalTerm(poly: Polynomial, at: Surd, spend: Budget) {
  let derivative = poly;
  for (let order = 0; order <= degree(poly); order++) {
    spend();
    const coefficient = evaluatePolynomial(derivative, at);
    if (surdSign(coefficient)) {
      // The Taylor coefficient is f^(order)(x)/order!. The positive factorial cancels when
      // comparing equal orders and cannot affect the sign of an infinite one-sided limit.
      return { order, coefficient };
    }
    derivative = differentiate(derivative);
  }
}

export function surdLabel(x: Surd) {
  if (!sign(x.b)) return rationalLabel(x.a);
  const coefficient = absolute(x.b);
  const radical = `${same(coefficient, one) ? "" : `${rationalLabel(coefficient)}·`}√(${rationalLabel(x.r)})`;
  const center = sign(x.a) ? rationalLabel(x.a) : "";
  return center + (sign(x.b) < 0 ? "-" : center ? "+" : "") + radical;
}

export function approximate(x: Surd): number {
  const number = (q: Rational) => Number(q.n) / Number(q.d);
  const center = number(x.a),
    radius = number(x.b) * Math.sqrt(number(x.r));
  // Use the conjugate when subtraction cancels most significant digits.
  if (
    center * radius < 0 &&
    Math.abs(center + radius) < Math.max(Math.abs(center), Math.abs(radius)) / 4
  ) {
    const norm = minus(times(x.a, x.a), squaredRadical(x));
    return number(norm) / (center - radius);
  }
  return center + radius;
}
