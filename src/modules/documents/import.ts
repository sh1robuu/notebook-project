import { validateDocument } from "./model.ts";
import type { DocumentImportResult } from "./model.ts";
import {
  MAX_DOCUMENT_SOURCE_BYTES,
  validateDocumentSources,
} from "./sources.ts";
import type { DocumentSources } from "./sources.ts";
function aborted(signal: AbortSignal) {
  if (signal.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Document operation cancelled.", "AbortError");
}
/** Decoded pixels are checked in the real browser before candidate activation. */
export async function validateDocumentImages(
  sources: DocumentSources,
  signal: AbortSignal,
): Promise<void> {
  for (const source of Object.values(sources)) {
    if (source.mime !== "image/png" && source.mime !== "image/jpeg") continue;
    aborted(signal);
    const pending = createImageBitmap(
      new Blob([source.bytes.slice().buffer], { type: source.mime }),
    );
    const image = await new Promise<ImageBitmap>((resolve, reject) => {
      const cancel = () =>
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException("Image validation cancelled.", "AbortError"),
        );
      signal.addEventListener("abort", cancel, { once: true });
      void pending.then(
        (bitmap) => {
          signal.removeEventListener("abort", cancel);
          if (signal.aborted) {
            bitmap.close();
            cancel();
          } else resolve(bitmap);
        },
        (error) => {
          signal.removeEventListener("abort", cancel);
          reject(error);
        },
      );
    });
    try {
      if (
        !image.width ||
        !image.height ||
        image.width > 8192 ||
        image.height > 8192 ||
        image.width * image.height > 16_000_000
      )
        throw new Error(
          "Decoded document image exceeds 8192 px /16 megapixels.",
        );
    } finally {
      image.close();
    }
  }
}
/** The worker owns staged parsing; termination is the cancellation boundary. */
export async function inspectDocx(
  file: File,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<DocumentImportResult> {
  aborted(signal);
  if (!/\.docx$/i.test(file.name))
    throw new Error(
      "Choose a modern .docx file. Convert legacy .doc using Word or LibreOffice Save As .docx.",
    );
  if (!file.size || file.size > MAX_DOCUMENT_SOURCE_BYTES)
    throw new Error("DOCX files must be nonempty and no larger than 50 MB.");
  progress(`Reading ${file.name} (${file.size.toLocaleString()} bytes)…`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  aborted(signal);
  const worker = new Worker(new URL("./import.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<DocumentImportResult>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, result?: DocumentImportResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal.removeEventListener("abort", cancel);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const cancel = () =>
      finish(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException(
              "DOCX import cancelled. Existing work is unchanged.",
              "AbortError",
            ),
      );
    const deadline = setTimeout(
      () =>
        finish(
          new Error(
            "DOCX checking exceeded 120 seconds. Try a smaller document; existing work is unchanged.",
          ),
        ),
      120000,
    );
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      finish(
        new Error(
          "Document parser failed. Keep the original DOCX; existing work is unchanged.",
        ),
      );
    };
    worker.onmessage = (event) => {
      if (settled) return;
      if (event.data.type === "progress") {
        progress(String(event.data.message).slice(0, 500));
        return;
      }
      if (event.data.type === "error") {
        finish(new Error(String(event.data.message)));
        return;
      }
      if (event.data.type !== "result") return;
      void (async () => {
        try {
          aborted(signal);
          const sources = validateDocumentSources(event.data.result.sources);
          const document = validateDocument(
            event.data.result.document,
            sources,
          );
          progress("Checking embedded image pixels…");
          await validateDocumentImages(sources, signal);
          aborted(signal);
          finish(undefined, { document, sources });
        } catch (error) {
          finish(error);
        }
      })();
    };
    if (signal.aborted) {
      cancel();
      return;
    }
    try {
      worker.postMessage({ bytes, name: file.name }, [bytes.buffer]);
    } catch (error) {
      finish(error);
    }
  });
}
