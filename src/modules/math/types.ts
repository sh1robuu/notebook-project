export type AngleMode = "RAD" | "DEG";
export type MathCallName =
  | "sqrt"
  | "ln"
  | "log"
  | "log10"
  | "exp"
  | "sin"
  | "cos"
  | "tan"
  | "asin"
  | "acos"
  | "atan"
  | "abs"
  | "root";
export type MathAst =
  | { kind: "number"; value: number; raw: string }
  | { kind: "symbol"; name: "x" | "pi" | "e" }
  | { kind: "unary"; op: "+" | "-"; arg: MathAst }
  | {
      kind: "binary";
      op: "+" | "-" | "*" | "/" | "^";
      left: MathAst;
      right: MathAst;
    }
  | { kind: "call"; name: MathCallName; args: MathAst[] }
  | { kind: "postfix"; op: "!" | "%"; arg: MathAst };
export type DomainRestriction = {
  kind:
    | "positive"
    | "nonnegative"
    | "nonzero"
    | "unit-interval"
    | "real-power"
    | "trig-pole";
  expression: MathAst;
  description: string;
};
export type ParsedExpression = {
  source: string;
  normalized: string;
  ast: MathAst;
  variables: "x"[];
  angleMode: AngleMode;
  domain: DomainRestriction[];
};
export type MathResult<T> =
  | { status: "supported"; value: T; warnings: string[] }
  | {
      status:
        "invalid" | "undefined" | "unsupported" | "inconclusive" | "limit";
      message: string;
      position?: number;
    };
export type EvaluationBudget = { remaining: number; signal?: AbortSignal };
export type PlotViewport = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};
export type PlotPoint = { x: number; y: number };
export type PlotOptions = {
  width: number;
  height: number;
  maxSamples?: number;
  signal?: AbortSignal;
};
export type PlotData = {
  segments: PlotPoint[][];
  holes: PlotPoint[];
  evaluations: number;
  warnings: string[];
};
export type Calculation = {
  expression: string;
  mode: AngleMode;
  value: number;
  display: string;
  approximate: true;
};
