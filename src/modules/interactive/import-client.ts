import type { InspectedHtmlBundle, OpenedHtmlBundle } from "./bundle.ts";
import type { GeoGebraInspection } from "./geogebra.ts";

export type InspectedGeoGebraFile = {
  bytes: Uint8Array;
  inspection: GeoGebraInspection;
};
export type InteractiveImportRequest =
  | { kind: "inspect"; files: File[] }
  | { kind: "open"; bytes: Uint8Array; entry: string }
  | { kind: "inspect-ggb"; file: File };
export type InteractiveImportReply =
  | {
      ok: true;
      result: InspectedHtmlBundle | OpenedHtmlBundle | InspectedGeoGebraFile;
    }
  | { ok: false; error: string };

function runImport<T extends OpenedHtmlBundle | InspectedGeoGebraFile>(
  request: InteractiveImportRequest,
  signal?: AbortSignal,
) {
  return new Promise<T>((resolve, reject) => {
    const abortError = () =>
      new DOMException("Interactive import cancelled.", "AbortError");
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const worker = new Worker(
      new URL("../../workers/interactive-import.worker.ts", import.meta.url),
      { type: "module" },
    );
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    }
    function abort() {
      finish();
      reject(abortError());
    }
    function fail(message: string) {
      finish();
      reject(new Error(message));
    }
    const timer = setTimeout(
      () =>
        fail(
          "Interactive package inspection timed out. Try a smaller package.",
        ),
      8_000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = worker.onmessageerror = () =>
      fail("The interactive import worker could not finish.");
    worker.onmessage = ({ data }: MessageEvent<InteractiveImportReply>) => {
      finish();
      if (data.ok) resolve(data.result as T);
      else reject(new Error(data.error));
    };
    try {
      // Stored bytes may be the only in-memory reference to an immutable
      // source record. Structured clone keeps its ArrayBuffer intact.
      worker.postMessage(request);
    } catch {
      fail("The package could not be sent to the import worker.");
    }
  });
}

export function inspectHtmlFiles(files: File[], signal?: AbortSignal) {
  return runImport<InspectedHtmlBundle>({ kind: "inspect", files }, signal);
}

export function prepareStoredHtml(
  bytes: Uint8Array,
  entry: string,
  signal?: AbortSignal,
) {
  return runImport<OpenedHtmlBundle>({ kind: "open", bytes, entry }, signal);
}

export function inspectGeoGebraFile(file: File, signal?: AbortSignal) {
  return runImport<InspectedGeoGebraFile>(
    { kind: "inspect-ggb", file },
    signal,
  );
}
