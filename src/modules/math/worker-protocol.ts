import type {
  AngleMode,
  Calculation,
  MathResult,
  ParsedExpression,
  PlotData,
  PlotViewport,
} from "./types.ts";
import type { VariationAnalysis } from "./variation.ts";
import type { MathFigure } from "./descriptor.ts";

export type MathJob =
  | {
      kind: "graph";
      source: string;
      viewport: PlotViewport;
      width: number;
      height: number;
    }
  | { kind: "variation"; source: string }
  | { kind: "calculator"; source: string; mode: AngleMode }
  | { kind: "verify"; figures: MathFigure[] };

export type MathJobOutput = {
  graph: { expression: ParsedExpression; data: PlotData };
  variation: { expression: ParsedExpression; data: VariationAnalysis };
  calculator: Calculation;
  verify: { verified: true };
};

export type MathJobRequest = MathJob & { id: number };
export type MathJobReply = {
  id: number;
  result: MathResult<MathJobOutput[keyof MathJobOutput]>;
};
