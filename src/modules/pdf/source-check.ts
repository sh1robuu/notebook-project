import { abortError, checkAbort } from "./runtime.ts";
/** Validate image dictionaries in an isolated parser before PDF.js decodes pixels. */
export function checkPdfResources(
  bytes: Uint8Array,
  password: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./source-check.worker.ts", import.meta.url),
      { type: "module" },
    );
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("PDF resource validation exceeded 30 seconds."));
    }, 30000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (ev) => {
      finish();
      ev.data.ok ? resolve() : reject(new Error(ev.data.error));
    };
    worker.onerror = () => {
      finish();
      reject(new Error("PDF resource validator could not finish."));
    };
    try {
      worker.postMessage({ bytes, password });
    } catch (e) {
      finish();
      reject(e);
    }
  });
}
