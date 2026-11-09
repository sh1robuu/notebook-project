import { evaluateExpression, parseExpression } from "./expression.ts";
import type { AngleMode, Calculation, MathResult } from "./types.ts";

export function calculate(
  source: string,
  mode: AngleMode,
): MathResult<Calculation> {
  if (mode !== "RAD" && mode !== "DEG")
    return { status: "invalid", message: "Choose radians or degrees." };
  const parsed = parseExpression(source, {
    angleMode: mode,
    allowVariable: false,
  });
  if (parsed.status !== "supported") return parsed;
  const evaluated = evaluateExpression(parsed.value, undefined, {
    remaining: 4096,
  });
  if (evaluated.status !== "supported") return evaluated;
  const value = evaluated.value;
  // Keep the full binary64 number for continued calculation and round only the display.
  const rounded = Number(value.toPrecision(15));
  const display = (Number.isFinite(rounded) ? rounded : value).toString();
  return {
    status: "supported",
    value: { expression: source, mode, value, display, approximate: true },
    warnings: [],
  };
}
