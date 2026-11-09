import { useEffect, useState } from "react";
import type {
  MathJob,
  MathJobOutput,
} from "../../modules/math/worker-protocol.ts";
import type { MathWorkerClient } from "../../modules/math/worker-client.ts";
import type { MathResult } from "../../modules/math/types.ts";

export function useMathJob<J extends MathJob>(
  worker: MathWorkerClient,
  job: J | null,
) {
  const [completed, setCompleted] = useState<{
    job: J;
    result: MathResult<MathJobOutput[J["kind"]]>;
  }>();
  useEffect(() => {
    if (!job) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void worker
        .run(job, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setCompleted({ job, result });
        })
        .catch(() => {});
    }, 170);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [job, worker]);
  return completed?.job === job ? completed.result : undefined;
}
