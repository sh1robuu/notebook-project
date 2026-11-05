import { MAX_ARCHIVE_BYTES, WorkspaceError } from "./model.ts";
import type { Lesson } from "./model.ts";
function run(
  data: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ bytes?: Uint8Array; lesson?: Lesson }> {
  if (signal?.aborted)
    return Promise.reject(
      new DOMException("Archive checking cancelled.", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./archive.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(new DOMException("Archive checking cancelled.", "AbortError"));
    };
    const timer = setTimeout(() => {
      finish();
      reject(
        new WorkspaceError(
          "timeout",
          "The archive took too long to process. Current work is unchanged.",
        ),
      );
    }, 15000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (e) => {
      finish();
      e.data.ok
        ? resolve(e.data)
        : reject(new WorkspaceError("archive", e.data.error));
    };
    worker.onerror = () => {
      finish();
      reject(
        new WorkspaceError(
          "archive",
          "The archive worker could not finish. Current work is unchanged.",
        ),
      );
    };
    worker.postMessage(data);
  });
}
export async function downloadArchive(lesson: Lesson): Promise<Uint8Array> {
  return (await run({ action: "encode", lesson })).bytes!;
}
export async function readArchive(
  file: File,
  signal?: AbortSignal,
): Promise<Lesson> {
  if (file.size > MAX_ARCHIVE_BYTES)
    throw new WorkspaceError(
      "limit",
      "The archive exceeds the 250 MB file limit.",
    );
  return (
    await run(
      {
        action: "decode",
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
      signal,
    )
  ).lesson!;
}
