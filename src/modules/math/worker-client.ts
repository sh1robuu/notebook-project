import type {
  MathJob,
  MathJobOutput,
  MathJobReply,
} from "./worker-protocol.ts";
import type { MathResult } from "./types.ts";

function createWorker() {
  return new Worker(new URL("../../workers/math.worker.ts", import.meta.url), {
    type: "module",
  });
}

/** A dialog owns one warm worker. Superseded, timed-out and closed jobs terminate it. */
export class MathWorkerClient {
  #worker?: Worker;
  #cancel?: () => void;
  #id = 0;
  readonly #create: () => Worker;
  readonly #timeout: number;

  constructor(create = createWorker, timeout = 2500) {
    this.#create = create;
    this.#timeout = timeout;
  }

  run<J extends MathJob>(
    job: J,
    signal?: AbortSignal,
  ): Promise<MathResult<MathJobOutput[J["kind"]]>> {
    this.#cancel?.();
    return new Promise((resolve, reject) => {
      const aborted = () =>
        new DOMException("Calculation cancelled.", "AbortError");
      if (signal?.aborted) {
        reject(aborted());
        return;
      }
      let worker: Worker;
      try {
        worker = this.#worker ??= this.#create();
      } catch {
        resolve({
          status: "inconclusive",
          message: "The calculation worker could not start.",
        });
        return;
      }
      const id = ++this.#id;
      const finish = (terminate = false) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.#cancel = undefined;
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        if (terminate) {
          worker.terminate();
          this.#worker = undefined;
        }
      };
      const abort = () => {
        finish(true);
        reject(aborted());
      };
      const fail = () => {
        finish(true);
        resolve({
          status: "inconclusive",
          message: "The calculation worker could not finish. Try again.",
        });
      };
      const timer = setTimeout(() => {
        finish(true);
        resolve({
          status: "limit",
          message:
            "Calculation took too long. Try a simpler expression or a smaller graph window.",
        });
      }, this.#timeout);
      this.#cancel = abort;
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event: MessageEvent<MathJobReply>) => {
        if (event.data?.id !== id) return;
        finish();
        resolve(event.data.result as MathResult<MathJobOutput[J["kind"]]>);
      };
      worker.onerror = worker.onmessageerror = fail;
      try {
        worker.postMessage({ ...job, id });
      } catch {
        fail();
      }
    });
  }

  close() {
    this.#cancel?.();
    this.#worker?.terminate();
    this.#worker = undefined;
  }
}
