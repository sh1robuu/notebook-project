import { parseExpression } from "./expression.ts";
import type { MathAst, MathResult, ParsedExpression } from "./types.ts";
import {
  AlgebraError,
  algebraBudget,
  approximate,
  asFraction,
  asSurd,
  compareSurds,
  degree,
  differentiate,
  divideSurds,
  evaluatePolynomial,
  isZero,
  lead,
  leadingLocalTerm,
  multiply,
  negative,
  over,
  polynomialDivision,
  polynomialLabel,
  rational,
  realRoots,
  scale,
  sign,
  subtract,
  surdLabel,
  surdSign,
} from "./algebra.ts";
import type { Budget, Polynomial, Sign, Surd } from "./algebra.ts";

export type MathValue = {
  /** Finite approximate coordinate for display. The label carries the exact value. */
  value: number | null;
  label: string;
  exact: boolean;
};
export type VariationPoint = {
  x: MathValue;
  kind: "stationary" | "excluded" | "endpoint" | "nondifferentiable";
  included: boolean;
  derivativeZero: boolean;
  derivativeUndefined: boolean;
  extremum: "maximum" | "minimum" | "none";
  value?: MathValue;
  leftLimit?: MathValue;
  rightLimit?: MathValue;
  discontinuity?: "pole" | "hole";
};
export type VariationInterval = {
  left: MathValue;
  right: MathValue;
  sign: Sign;
  trend: "increasing" | "decreasing" | "constant";
};
export type VariationAnalysis = {
  schemaVersion: 1;
  engineVersion: "s06-exact-v1";
  family: "polynomial" | "rational" | "logarithmic" | "radical" | "absolute";
  source: string;
  normalized: string;
  domain: string;
  derivative: string;
  verified: true;
  method: string;
  points: VariationPoint[];
  intervals: VariationInterval[];
  leftLimit: MathValue;
  rightLimit: MathValue;
  notes: string[];
};

const infinity = (sign: Sign): MathValue => ({
  value: null,
  label: sign < 0 ? "−∞" : "+∞",
  exact: true,
});
const zero = () => value(asSurd(rational(0n)));
function value(x: Surd): MathValue {
  const position = approximate(x);
  if (!Number.isFinite(position) || (position === 0 && surdSign(x) !== 0))
    throw new AlgebraError(
      "inconclusive",
      "A value is outside the supported display range.",
    );
  return { value: position, label: surdLabel(x), exact: true };
}

const negateSign = (sign: Sign): Sign => (sign === 0 ? 0 : sign === 1 ? -1 : 1);
const productSign = (a: Sign, b: Sign): Sign =>
  a === -1 ? negateSign(b) : a === 0 ? 0 : b;

function interval(
  left: MathValue,
  right: MathValue,
  sign: Sign,
): VariationInterval {
  return {
    left,
    right,
    sign,
    trend: sign > 0 ? "increasing" : sign < 0 ? "decreasing" : "constant",
  };
}

function limitAtInfinity(
  numerator: Polynomial,
  denominator: Polynomial,
  left: boolean,
): MathValue {
  const exponent = degree(numerator) - degree(denominator);
  if (isZero(numerator) || exponent < 0) return zero();
  const ratio = over(lead(numerator), lead(denominator));
  if (exponent === 0) return value(asSurd(ratio));
  return infinity(left && exponent % 2 ? negateSign(sign(ratio)) : sign(ratio));
}

function limitsAt(
  numerator: Polynomial,
  denominator: Polynomial,
  x: Surd,
  spend: Budget,
) {
  const n = leadingLocalTerm(numerator, x, spend);
  const d = leadingLocalTerm(denominator, x, spend)!;
  if (!n || n.order > d.order)
    return {
      leftLimit: zero(),
      rightLimit: zero(),
      discontinuity: "hole" as const,
    };
  if (n.order === d.order) {
    const limit = value(divideSurds(n.coefficient, d.coefficient, x.r));
    return {
      leftLimit: limit,
      rightLimit: limit,
      discontinuity: "hole" as const,
    };
  }
  const right = productSign(surdSign(n.coefficient), surdSign(d.coefficient));
  const left = (d.order - n.order) % 2 ? negateSign(right) : right;
  return {
    leftLimit: infinity(left),
    rightLimit: infinity(right),
    discontinuity: "pole" as const,
  };
}

function quotientLabel(numerator: Polynomial, denominator: Polynomial) {
  if (isZero(numerator)) return "0";
  const n = polynomialLabel(numerator),
    d = polynomialLabel(denominator);
  if (d === "1") return n;
  const group = (text: string) =>
    /[+-]/.test(text.slice(1)) || text.includes("/") ? `(${text})` : text;
  return `${group(n)}/${group(d)}`;
}

function reducedDerivative(
  numerator: Polynomial,
  denominator: Polynomial,
  spend: Budget,
) {
  if (isZero(numerator)) return "0";
  let a = numerator,
    b = denominator;
  while (!isZero(b)) {
    spend();
    [a, b] = [b, polynomialDivision(a, b).remainder];
  }
  const divisor = scale(a, over(rational(1n), lead(a)));
  return quotientLabel(
    polynomialDivision(numerator, divisor).quotient,
    polynomialDivision(denominator, divisor).quotient,
  );
}

type CoreAnalysis = Omit<
  VariationAnalysis,
  "schemaVersion" | "engineVersion" | "source" | "normalized" | "verified"
>;

function rationalAnalysis(ast: MathAst, spend: Budget): CoreAnalysis {
  const { numerator, denominator, exclusions } = asFraction(ast, spend);
  const domainFactors = [...exclusions, denominator].filter(
    (factor) => degree(factor) > 0,
  );
  const isRational = domainFactors.length > 0;
  if (isRational && (degree(numerator) > 2 || degree(denominator) > 2))
    throw new AlgebraError(
      "unsupported",
      "Verified rational tables support numerator and denominator degree at most 2.",
    );
  if (!isRational && degree(numerator) > 3)
    throw new AlgebraError(
      "unsupported",
      "Verified polynomial tables support degree at most 3.",
    );

  const numeratorDerivative = subtract(
    multiply(differentiate(numerator), denominator),
    multiply(numerator, differentiate(denominator)),
  );
  const derivativeRoots = realRoots(numeratorDerivative, spend);
  const excludedRoots = domainFactors.flatMap((poly) =>
    realRoots(poly, spend).map((root) => root.x),
  );
  type Boundary = { x: Surd; derivativeOrder: number; excluded: boolean };
  const sorted = [
    ...derivativeRoots.map((root) => ({
      x: root.x,
      derivativeOrder: root.order,
      excluded: false,
    })),
    ...excludedRoots.map((x) => ({ x, derivativeOrder: 0, excluded: true })),
  ].sort((a, b) => compareSurds(a.x, b.x, spend));
  const boundaries: Boundary[] = [];
  for (const item of sorted) {
    const prior = boundaries.at(-1);
    if (prior && compareSurds(prior.x, item.x, spend) === 0) {
      prior.excluded ||= item.excluded;
      prior.derivativeOrder = Math.max(
        prior.derivativeOrder,
        item.derivativeOrder,
      );
    } else boundaries.push(item);
  }
  if (boundaries.length > 16)
    throw new AlgebraError(
      "limit",
      "This variation table has more than 16 boundaries.",
    );
  const labels = boundaries.map((boundary) => value(boundary.x));
  if (labels.some((label, i) => i > 0 && label.value! <= labels[i - 1].value!))
    throw new AlgebraError(
      "inconclusive",
      "Distinct boundaries are too close to display reliably.",
    );
  const ticks = [infinity(-1), ...labels, infinity(1)];
  const signs = Array<Sign>(ticks.length - 1);
  // The square denominator is positive on the original domain. Start with the
  // numerator's exact leading sign at +∞ and cross each real root by multiplicity.
  let currentSign = sign(lead(numeratorDerivative));
  for (let i = signs.length - 1; i >= 0; i--) {
    signs[i] = currentSign;
    if (i > 0 && boundaries[i - 1].derivativeOrder % 2)
      currentSign = negateSign(currentSign);
  }

  const points: VariationPoint[] = boundaries.map(({ x, excluded }, i) => {
    const common = {
      x: labels[i],
      included: !excluded,
      derivativeZero: !excluded,
      derivativeUndefined: excluded,
    };
    if (excluded)
      return {
        ...common,
        kind: "excluded",
        extremum: "none",
        ...limitsAt(numerator, denominator, x, spend),
      };
    const result = value(
      divideSurds(
        evaluatePolynomial(numerator, x),
        evaluatePolynomial(denominator, x),
        x.r,
      ),
    );
    const left = signs[i],
      right = signs[i + 1];
    return {
      ...common,
      kind: "stationary",
      value: result,
      leftLimit: result,
      rightLimit: result,
      extremum:
        left > 0 && right < 0
          ? "maximum"
          : left < 0 && right > 0
            ? "minimum"
            : "none",
    };
  });
  const holes = points
    .filter((p) => p.discontinuity === "hole")
    .map((p) => p.x.label);
  const poles = points
    .filter((p) => p.discontinuity === "pole")
    .map((p) => p.x.label);
  const excluded = points.filter((p) => !p.included).map((p) => p.x.label);
  const notes: string[] = [];
  if (holes.length)
    notes.push(`Removable discontinuity at x = ${holes.join(", ")}.`);
  if (poles.length)
    notes.push(`Vertical asymptote at x = ${poles.join(", ")}.`);
  if (isRational) {
    const { quotient, remainder } = polynomialDivision(numerator, denominator);
    if (degree(denominator) > 0 && degree(quotient) <= 1) {
      const kind = degree(quotient) === 0 ? "Horizontal" : "Oblique";
      if (!isZero(remainder))
        notes.push(`${kind} asymptote y = ${polynomialLabel(quotient)}.`);
    }
  }
  if (isZero(numeratorDerivative))
    notes.push(
      "The derivative is zero everywhere on the domain. There are no isolated turning points.",
    );
  if (points.some((p) => p.derivativeZero && p.extremum === "none"))
    notes.push(
      "A stationary point with the same derivative sign on both sides is not a turning point.",
    );
  return {
    family: isRational ? "rational" : "polynomial",
    domain: excluded.length ? `ℝ ∖ {${excluded.join(", ")}}` : "ℝ",
    derivative: reducedDerivative(
      numeratorDerivative,
      multiply(denominator, denominator),
      spend,
    ),
    method:
      "Exact rational coefficients, real roots with multiplicity, and leading terms for limits.",
    points,
    intervals: signs.map((sign, i) => interval(ticks[i], ticks[i + 1], sign)),
    leftLimit: limitAtInfinity(numerator, denominator, true),
    rightLimit: limitAtInfinity(numerator, denominator, false),
    notes,
  };
}

function affineAnalysis(
  ast: Extract<MathAst, { kind: "call" }>,
  spend: Budget,
): CoreAnalysis {
  const logarithm = ast.name === "ln";
  const absolute = ast.name === "abs";
  const family = logarithm ? "logarithmic" : absolute ? "absolute" : "radical";
  const { numerator, denominator, exclusions } = asFraction(ast.args[0], spend);
  if (
    degree(numerator) > 1 ||
    degree(denominator) > 0 ||
    exclusions.some((factor) => degree(factor) > 0)
  )
    throw new AlgebraError(
      "unsupported",
      "Verified ln, sqrt, and abs tables require an affine argument with no excluded points.",
    );
  if (!degree(numerator)) {
    const argument = numerator[0];
    if (!absolute && (logarithm ? sign(argument) <= 0 : sign(argument) < 0))
      throw new AlgebraError(
        "undefined",
        "This constant argument is outside the function's real domain.",
      );
    const numericArgument = approximate(asSurd(argument));
    const result: MathValue = absolute
      ? value(asSurd(sign(argument) < 0 ? negative(argument) : argument))
      : {
          value: logarithm
            ? Math.log(numericArgument)
            : Math.sqrt(numericArgument),
          label: `${logarithm ? "ln" : "√"}(${polynomialLabel(numerator)})`,
          exact: true,
        };
    return {
      family,
      domain: "ℝ",
      derivative: "0",
      method: "Constant function on its real domain.",
      points: [],
      intervals: [interval(infinity(-1), infinity(1), 0)],
      leftLimit: result,
      rightLimit: result,
      notes: [],
    };
  }

  const [b, a] = numerator;
  const signA = sign(a),
    increasing = signA > 0;
  const endpoint = value(asSurd(over(negative(b), a)));
  if (absolute) {
    const slope = signA > 0 ? a : negative(a);
    const minimum = zero();
    return {
      family,
      domain: "ℝ",
      derivative: `${polynomialLabel([negative(slope)])} for x < ${endpoint.label}; ${polynomialLabel([slope])} for x > ${endpoint.label}`,
      method:
        "Exact slopes of the two affine pieces and continuity at their common endpoint.",
      points: [
        {
          x: endpoint,
          kind: "nondifferentiable",
          included: true,
          derivativeZero: false,
          derivativeUndefined: true,
          extremum: "minimum",
          value: minimum,
          leftLimit: minimum,
          rightLimit: minimum,
        },
      ],
      intervals: [
        interval(infinity(-1), endpoint, -1),
        interval(endpoint, infinity(1), 1),
      ],
      leftLimit: infinity(1),
      rightLimit: infinity(1),
      notes: [
        "At the minimum the one-sided slopes differ, so the derivative is undefined.",
      ],
    };
  }
  const endpointLimit = logarithm ? infinity(-1) : zero();
  const farLimit = infinity(1);
  const bracket = logarithm ? (increasing ? "(" : ")") : increasing ? "[" : "]";
  const formula = polynomialLabel(numerator);
  return {
    family,
    domain: increasing
      ? `${bracket}${endpoint.label}, +∞)`
      : `(−∞, ${endpoint.label}${bracket}`,
    derivative: logarithm
      ? quotientLabel([a], numerator)
      : `${polynomialLabel([a])}/(2√(${formula}))`,
    method:
      "Exact affine domain and derivative sign, with analytic endpoint limits.",
    points: [
      {
        x: endpoint,
        kind: logarithm ? "excluded" : "endpoint",
        included: !logarithm,
        derivativeZero: false,
        derivativeUndefined: true,
        extremum: "none",
        ...(!logarithm ? { value: endpointLimit } : {}),
        ...(increasing
          ? { rightLimit: endpointLimit }
          : { leftLimit: endpointLimit }),
      },
    ],
    intervals: [
      increasing
        ? interval(endpoint, infinity(1), signA)
        : interval(infinity(-1), endpoint, signA),
    ],
    leftLimit: increasing ? endpointLimit : farLimit,
    rightLimit: increasing ? farLimit : endpointLimit,
    notes: logarithm
      ? [`Vertical asymptote x = ${endpoint.label}.`]
      : [
          "The endpoint belongs to the domain. Its one-sided slope is infinite, so it is listed separately from interior critical points.",
        ],
  };
}

/** Computes the declared exact subset and returns a typed failure beyond that subset. */
export function analyzeVariation(
  source: string,
  options: { signal?: AbortSignal; maxOperations?: number } = {},
): MathResult<VariationAnalysis> {
  try {
    const spend = algebraBudget(options.signal, options.maxOperations);
    spend();
    const parsed: MathResult<ParsedExpression> = parseExpression(source, {
      angleMode: "RAD",
    });
    if (parsed.status !== "supported") return parsed;
    const { ast, normalized } = parsed.value;
    const result =
      ast.kind === "call" &&
      (ast.name === "ln" || ast.name === "sqrt" || ast.name === "abs")
        ? affineAnalysis(ast, spend)
        : rationalAnalysis(ast, spend);
    const labels = [
      result.domain,
      result.derivative,
      ...result.notes,
      ...result.points.flatMap((point) =>
        [point.x, point.value, point.leftLimit, point.rightLimit].flatMap(
          (item) => (item ? [item.label] : []),
        ),
      ),
    ];
    if (labels.some((label) => label.length > 512))
      return {
        status: "limit",
        message: "Exact labels are too long to display in a variation table.",
      };
    return {
      status: "supported",
      warnings: parsed.warnings,
      value: {
        ...result,
        source,
        normalized,
        schemaVersion: 1,
        engineVersion: "s06-exact-v1",
        verified: true,
      },
    };
  } catch (error) {
    if (error instanceof AlgebraError)
      return { status: error.status, message: error.message };
    throw error;
  }
}
