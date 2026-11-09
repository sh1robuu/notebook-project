import type {
  AngleMode,
  DomainRestriction,
  EvaluationBudget,
  MathAst,
  MathCallName,
  MathResult,
  ParsedExpression,
} from "./types.ts";

export const MAX_EXPRESSION_LENGTH = 1024;
export const MAX_AST_NODES = 192;
export const MAX_AST_DEPTH = 32;

type Failure = Exclude<MathResult<never>, { status: "supported" }>;
class MathFailure extends Error {
  readonly result: Failure;
  constructor(result: Failure) {
    super(result.message);
    this.result = result;
  }
}
function fail(
  status: Failure["status"],
  message: string,
  position?: number,
): never {
  throw new MathFailure({
    status,
    message,
    ...(position === undefined ? {} : { position }),
  });
}

const calls = new Set<string>([
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
]);
const numberPattern = /(?:\d+(?:[.,]\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const namePattern = /[a-zA-Z_][a-zA-Z_0-9]*/y;
const punctuation = new Map([
  ["−", "-"],
  ["×", "*"],
  ["·", "*"],
  ["÷", "/"],
  ["π", "pi"],
]);
type Token = {
  kind: "number" | "name" | "punctuation" | "end";
  text: string;
  position: number;
};

function lex(source: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < source.length;) {
    const char = source[index];
    if (/\s/u.test(char)) {
      index++;
      continue;
    }
    numberPattern.lastIndex = index;
    namePattern.lastIndex = index;
    const number = numberPattern.exec(source)?.[0];
    const name = !number ? namePattern.exec(source)?.[0] : undefined;
    const normalized = punctuation.get(char) ?? char;
    if (number)
      tokens.push({
        kind: "number",
        text: number.replace(",", "."),
        position: index,
      });
    else if (name || normalized === "pi")
      tokens.push({
        kind: "name",
        text: (name ?? normalized).toLowerCase(),
        position: index,
      });
    else if ("+-*/^!%();=".includes(normalized))
      tokens.push({ kind: "punctuation", text: normalized, position: index });
    else fail("invalid", `Unexpected character “${char}”.`, index);
    index += (number ?? name ?? char).length;
  }
  tokens.push({ kind: "end", text: "", position: source.length });
  return tokens;
}

const bindingPower: Record<string, number> = {
  "+": 10,
  "-": 10,
  "*": 20,
  "/": 20,
  "^": 30,
};
type BinaryOperator = Extract<MathAst, { kind: "binary" }>["op"];

class Parser {
  private cursor = 0;
  private nodes = 0;
  private readonly depths = new WeakMap<MathAst, number>();
  private readonly tokens: Token[];
  private readonly allowVariable: boolean;
  readonly variables = new Set<"x">();

  constructor(tokens: Token[], allowVariable: boolean) {
    this.tokens = tokens;
    this.allowVariable = allowVariable;
  }

  private peek() {
    return this.tokens[this.cursor];
  }

  private take() {
    return this.tokens[this.cursor++];
  }

  private expect(text: string) {
    if (this.peek().text !== text)
      fail("invalid", `Expected “${text}”.`, this.peek().position);
    this.take();
  }

  private node<T extends MathAst>(value: T, ...children: MathAst[]): T {
    const depth =
      1 + Math.max(0, ...children.map((child) => this.depths.get(child) ?? 0));
    if (++this.nodes > MAX_AST_NODES || depth > MAX_AST_DEPTH)
      fail("limit", "This expression is too complex. Try a shorter one.");
    this.depths.set(value, depth);
    return value;
  }

  parse(): MathAst {
    if (
      this.allowVariable &&
      this.peek().text === "y" &&
      this.tokens[1]?.text === "="
    )
      this.cursor = 2;
    const expression = this.expression(0, 0);
    if (this.peek().kind !== "end")
      fail(
        "invalid",
        `Unexpected “${this.peek().text}”.`,
        this.peek().position,
      );
    return expression;
  }

  private expression(min: number, depth: number): MathAst {
    if (depth > MAX_AST_DEPTH)
      fail("limit", "Too many nested operations.", this.peek().position);
    let left = this.prefix(depth);
    while (true) {
      const token = this.peek();
      if (token.text === "!" || token.text === "%") {
        if (40 < min) break;
        this.take();
        left = this.node({ kind: "postfix", op: token.text, arg: left }, left);
        continue;
      }
      // A following number is multiplication only after a closing parenthesis.
      // This keeps accidental input such as 2 3 or 1.2.3 invalid.
      const implied =
        token.kind === "name" ||
        token.text === "(" ||
        (token.kind === "number" && this.tokens[this.cursor - 1]?.text === ")");
      const op = implied ? "*" : token.text;
      const power = Object.hasOwn(bindingPower, op)
        ? bindingPower[op]
        : undefined;
      if (power === undefined || power < min) break;
      if (!implied) this.take();
      const right = this.expression(power + (op === "^" ? 0 : 1), depth + 1);
      left = this.node(
        { kind: "binary", op: op as BinaryOperator, left, right },
        left,
        right,
      );
    }
    return left;
  }

  private prefix(depth: number): MathAst {
    const token = this.peek();
    if (token.kind === "end")
      fail("invalid", "Enter a number, variable, or function.", token.position);
    this.take();
    if (token.text === "+" || token.text === "-") {
      const arg = this.expression(25, depth + 1);
      return this.node({ kind: "unary", op: token.text, arg }, arg);
    }
    if (token.text === "(") {
      const expression = this.expression(0, depth + 1);
      this.expect(")");
      return expression;
    }
    if (token.kind === "number") {
      const value = Number(token.text);
      if (!Number.isFinite(value))
        fail("limit", "A number is too large to evaluate.", token.position);
      if (value === 0 && /[1-9]/.test(token.text.split(/[eE]/)[0]))
        fail("limit", "A number is too small to evaluate.", token.position);
      return this.node({ kind: "number", value, raw: token.text });
    }
    if (token.kind !== "name")
      fail("invalid", `Unexpected “${token.text}”.`, token.position);
    if (token.text === "pi" || token.text === "e")
      return this.node({ kind: "symbol", name: token.text });
    if (token.text === "x") {
      if (!this.allowVariable)
        fail(
          "unsupported",
          "This calculation needs a number in place of x.",
          token.position,
        );
      this.variables.add("x");
      return this.node({ kind: "symbol", name: "x" });
    }
    if (!calls.has(token.text))
      fail(
        "unsupported",
        `“${token.text}” is not a supported function or variable.`,
        token.position,
      );
    const name = token.text as MathCallName;
    this.expect("(");
    const args = [this.expression(0, depth + 1)];
    if (name === "root") {
      this.expect(";");
      args.push(this.expression(0, depth + 1));
    }
    this.expect(")");
    return this.node({ kind: "call", name, args }, ...args);
  }
}

/** Explicit parentheses and multiplication describe the parsed expression without ambiguous precedence. */
function normalize(node: MathAst): string {
  switch (node.kind) {
    case "number":
      return node.raw;
    case "symbol":
      return node.name;
    case "unary":
      return `(${node.op}${normalize(node.arg)})`;
    case "binary":
      return `(${normalize(node.left)}${node.op}${normalize(node.right)})`;
    case "postfix":
      return `(${normalize(node.arg)}${node.op})`;
    case "call":
      return `${node.name}(${node.args.map(normalize).join(";")})`;
  }
}

function domainRestrictions(ast: MathAst): DomainRestriction[] {
  const domain: DomainRestriction[] = [];
  const add = (
    kind: DomainRestriction["kind"],
    expression: MathAst,
    description: string,
  ) => domain.push({ kind, expression, description });
  function visit(node: MathAst) {
    switch (node.kind) {
      case "binary":
        visit(node.left);
        visit(node.right);
        if (node.op === "/")
          add("nonzero", node.right, `${normalize(node.right)} ≠ 0`);
        if (node.op === "^")
          add(
            "real-power",
            node,
            "Powers must be defined over the real numbers.",
          );
        break;
      case "call":
        for (const arg of node.args) visit(arg);
        if (node.name === "sqrt")
          add("nonnegative", node.args[0], `${normalize(node.args[0])} ≥ 0`);
        if (node.name === "ln" || node.name === "log" || node.name === "log10")
          add("positive", node.args[0], `${normalize(node.args[0])} > 0`);
        if (node.name === "asin" || node.name === "acos")
          add(
            "unit-interval",
            node.args[0],
            `−1 ≤ ${normalize(node.args[0])} ≤ 1`,
          );
        if (node.name === "tan")
          add(
            "trig-pole",
            node.args[0],
            "Tangent excludes odd multiples of a quarter turn.",
          );
        if (node.name === "root")
          add(
            "real-power",
            node,
            "Roots need a positive integer degree and a real result.",
          );
        break;
      case "unary":
      case "postfix":
        visit(node.arg);
        break;
    }
  }
  visit(ast);
  return domain;
}

export function parseExpression(
  source: string,
  {
    angleMode = "RAD",
    allowVariable = true,
  }: { angleMode?: AngleMode; allowVariable?: boolean } = {},
): MathResult<ParsedExpression> {
  if (typeof source !== "string")
    return { status: "invalid", message: "Enter an expression." };
  if (source.length > MAX_EXPRESSION_LENGTH)
    return {
      status: "limit",
      message: `Use at most ${MAX_EXPRESSION_LENGTH} characters.`,
    };
  if (angleMode !== "RAD" && angleMode !== "DEG")
    return { status: "invalid", message: "Choose radians or degrees." };
  try {
    const parser = new Parser(lex(source), allowVariable);
    const ast = parser.parse();
    return {
      status: "supported",
      value: {
        source,
        ast,
        normalized: normalize(ast),
        angleMode,
        variables: [...parser.variables],
        domain: domainRestrictions(ast),
      },
      warnings: [],
    };
  } catch (error) {
    if (error instanceof MathFailure) return error.result;
    throw error;
  }
}

function finite(value: number, underflow = false): number {
  if (Number.isNaN(value))
    fail("undefined", "The result is not a real number.");
  if (!Number.isFinite(value))
    fail("limit", "The result is too large to represent.");
  if (value === 0 && underflow)
    fail("limit", "The result is too small to represent.");
  return value === 0 ? 0 : value;
}

export const MAX_TRIG_ARGUMENT = 1e10;
function call(name: MathCallName, args: number[], mode: AngleMode): number {
  const [value, degree] = args;
  switch (name) {
    case "sqrt":
      return finite(Math.sqrt(value));
    case "ln":
    case "log":
    case "log10":
      if (value <= 0)
        fail("undefined", "Logarithms require a positive argument.");
      return name === "ln" ? Math.log(value) : Math.log10(value);
    case "exp":
      return finite(Math.exp(value), true);
    case "abs":
      return Math.abs(value);
    case "root": {
      if (!Number.isInteger(degree) || degree < 1 || degree > 1024)
        fail("unsupported", "Use an integer root degree from 1 to 1024.");
      if (value < 0 && degree % 2 === 0)
        fail("undefined", "An even root of a negative number is not real.");
      if (degree === 2) return Math.sqrt(value);
      if (degree === 3) return Math.cbrt(value);
      return Math.sign(value) * Math.pow(Math.abs(value), 1 / degree);
    }
    case "asin":
    case "acos":
    case "atan": {
      const radians = finite(Math[name](value));
      return mode === "DEG" ? radians * (180 / Math.PI) : radians;
    }
    case "sin":
    case "cos":
    case "tan": {
      if (Math.abs(value) > MAX_TRIG_ARGUMENT)
        fail(
          "limit",
          "The trigonometric argument is too large to evaluate reliably.",
        );
      const radians = mode === "DEG" ? (value % 360) * (Math.PI / 180) : value;
      if (
        name === "tan" &&
        Math.abs(Math.cos(radians)) <=
          4 * Number.EPSILON * Math.max(1, Math.abs(radians))
      )
        fail("undefined", "Tangent is undefined at this angle.");
      return Math[name](radians);
    }
  }
}

function binary(op: BinaryOperator, left: number, right: number): number {
  switch (op) {
    case "+":
      return finite(left + right);
    case "-":
      return finite(left - right);
    case "*":
      return finite(left * right, left !== 0 && right !== 0);
    case "/":
      if (right === 0) fail("undefined", "Division by zero is undefined.");
      return finite(left / right, left !== 0);
    case "^":
      if (left === 0 && right <= 0)
        fail("undefined", "Zero to a nonpositive power is undefined.");
      if (left < 0 && !Number.isSafeInteger(right))
        fail(
          "undefined",
          "Use an integer exponent for a negative base, or an explicit odd root.",
        );
      return finite(Math.pow(left, right), left !== 0);
  }
}

export function evaluateAst(
  ast: MathAst,
  x: number,
  mode: AngleMode,
  budget: EvaluationBudget = { remaining: 1024 },
): MathResult<number> {
  function visit(node: MathAst, depth: number): number {
    if (
      budget.signal?.aborted ||
      --budget.remaining < 0 ||
      depth > MAX_AST_DEPTH
    )
      fail(
        "limit",
        "The calculation was cancelled or exceeded its work limit.",
      );
    switch (node.kind) {
      case "number":
        return node.value;
      case "symbol":
        return node.name === "x" ? x : node.name === "pi" ? Math.PI : Math.E;
      case "unary":
        return node.op === "-"
          ? -visit(node.arg, depth + 1)
          : visit(node.arg, depth + 1);
      case "binary":
        return binary(
          node.op,
          visit(node.left, depth + 1),
          visit(node.right, depth + 1),
        );
      case "call":
        return call(
          node.name,
          node.args.map((arg) => visit(arg, depth + 1)),
          mode,
        );
      case "postfix": {
        const value = visit(node.arg, depth + 1);
        if (node.op === "%") return finite(value / 100, value !== 0);
        if (!Number.isInteger(value) || value < 0)
          fail("undefined", "Factorial requires a nonnegative integer.");
        if (value > 170) fail("limit", "Factorial is supported up to 170!.");
        budget.remaining -= value;
        if (budget.remaining < 0)
          fail("limit", "The calculation exceeded its work limit.");
        let product = 1;
        for (let factor = 2; factor <= value; factor++) product *= factor;
        return product;
      }
    }
  }
  try {
    if (!Number.isFinite(x))
      fail("invalid", "The variable value must be finite.");
    return { status: "supported", value: finite(visit(ast, 0)), warnings: [] };
  } catch (error) {
    if (error instanceof MathFailure) return error.result;
    throw error;
  }
}

export function evaluateExpression(
  expression: ParsedExpression,
  x?: number,
  budget?: EvaluationBudget,
): MathResult<number> {
  if (x === undefined && expression.variables.length)
    return { status: "invalid", message: "Enter a value for x." };
  return evaluateAst(expression.ast, x ?? 0, expression.angleMode, budget);
}
