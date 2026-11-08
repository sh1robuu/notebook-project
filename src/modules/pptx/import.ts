import { validateDocumentImages } from "../documents/import.ts";
import {
  MAX_PPTX_BYTES,
  validateSlideDocument,
  type PptxImportResult,
} from "./model.ts";
import { validatePptxSources } from "./sources.ts";

type WorkerMessage =
  | { type: "progress" | "error"; message: string }
  | { type: "result"; result: PptxImportResult };

export async function inspectPptx(
  file: File,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<PptxImportResult> {
  signal.throwIfAborted();
  if (!/\.pptx$/i.test(file.name) || !file.size || file.size > MAX_PPTX_BYTES)
    throw new Error(
      "Choose a nonempty .pptx file up to 50 MB. Macro-enabled and legacy PowerPoint formats are unsupported.",
    );
  progress(`Reading ${file.name} (${file.size.toLocaleString()} bytes)…`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const worker = new Worker(new URL("./import.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<PptxImportResult>((resolve, reject) => {
    let settled = false;
    const finish = (result: PptxImportResult | undefined, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal.removeEventListener("abort", cancel);
      worker.terminate();
      if (result) resolve(result);
      else reject(error);
    };
    const cancel = () =>
      finish(
        undefined,
        signal.reason ??
          new DOMException("PowerPoint import cancelled.", "AbortError"),
      );
    const deadline = setTimeout(() => {
      finish(
        undefined,
        new Error(
          "PowerPoint inspection exceeded 60 seconds. Try a smaller deck.",
        ),
      );
    }, 60_000);
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      finish(
        undefined,
        new Error("PowerPoint parser failed to load or parse the deck."),
      );
    };
    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (settled) return;
      if (data.type === "progress") return progress(data.message.slice(0, 500));
      if (data.type === "error")
        return finish(undefined, new Error(data.message));
      if (data.type !== "result") return;
      void (async () => {
        try {
          const sources = validatePptxSources(data.result.sources);
          const document = validateSlideDocument(data.result.document, sources);
          progress("Checking embedded PowerPoint images…");
          await validateDocumentImages(sources, signal);
          signal.throwIfAborted();
          finish({ document, sources });
        } catch (error) {
          finish(undefined, error);
        }
      })();
    };
    if (signal.aborted) return cancel();
    try {
      worker.postMessage({ bytes, name: file.name }, [bytes.buffer]);
    } catch (error) {
      finish(undefined, error);
    }
  });
}
