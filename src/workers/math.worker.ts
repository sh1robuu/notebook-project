import { parseExpression } from "../modules/math/expression.ts";
import { calculate } from "../modules/math/calculator.ts";
import { samplePlot } from "../modules/math/plot.ts";
import { analyzeVariation } from "../modules/math/variation.ts";
import { verifyMathFigures } from "../modules/math/integrity.ts";
import type {
  MathJobReply,
  MathJobRequest,
} from "../modules/math/worker-protocol.ts";

function perform(job: MathJobRequest): MathJobReply["result"] {
  if (job.kind === "calculator") return calculate(job.source, job.mode);
  if (job.kind === "verify") {
    verifyMathFigures(job.figures);
    return { status: "supported", value: { verified: true }, warnings: [] };
  }
  const parsed = parseExpression(job.source);
  if (parsed.status !== "supported") return parsed;
  if (job.kind === "graph") {
    const plot = samplePlot(parsed.value, job.viewport, {
      width: job.width,
      height: job.height,
    });
    if (plot.status !== "supported") return plot;
    return {
      status: "supported",
      value: { expression: parsed.value, data: plot.value },
      warnings: plot.warnings,
    };
  }
  if (job.kind === "variation") {
    const analysis = analyzeVariation(job.source);
    if (analysis.status !== "supported") return analysis;
    return {
      status: "supported",
      value: { expression: parsed.value, data: analysis.value },
      warnings: analysis.warnings,
    };
  }
  return { status: "unsupported", message: "Unknown calculation." };
}

self.onmessage = (event: MessageEvent<MathJobRequest>) => {
  const job = event.data;
  try {
    self.postMessage({
      id: job.id,
      result: perform(job),
    } satisfies MathJobReply);
  } catch {
    self.postMessage({
      id: job?.id,
      result: {
        status: "inconclusive",
        message: "The expression could not be processed safely.",
      },
    });
  }
};
