import { MAX_ARCHIVE_BYTES, WorkspaceError } from "./model.ts";
import type { Lesson } from "./model.ts";
import type { ArchiveCandidate, ArchiveInfo } from "./archive-core.ts";
function run(
  data: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{
  bytes?: Uint8Array<ArrayBuffer>;
  lesson?: Lesson;
  info?: ArchiveInfo;
}> {
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
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
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
        : reject(
            new WorkspaceError(
              typeof e.data.code === "string" ? e.data.code : "archive",
              e.data.error,
            ),
          );
    };
    worker.onerror = worker.onmessageerror = () => {
      finish();
      reject(
        new WorkspaceError(
          "archive",
          "The archive worker could not finish. Current work is unchanged.",
        ),
      );
    };
    try {
      worker.postMessage(data);
    } catch {
      finish();
      reject(
        new WorkspaceError(
          "archive",
          "The archive could not be sent for validation. Current work is unchanged.",
        ),
      );
    }
  });
}
export async function downloadArchive(
  lesson: Lesson,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return (await run({ action: "encode", lesson }, signal)).bytes!;
}
export async function readArchiveCandidate(
  file: File,
  signal?: AbortSignal,
): Promise<ArchiveCandidate> {
  if (file.size > MAX_ARCHIVE_BYTES)
    throw new WorkspaceError(
      "limit",
      "The archive exceeds the 250 MB file limit.",
    );
  const result = await run(
    {
      action: "decode",
      file,
    },
    signal,
  );
  return { lesson: result.lesson!, info: result.info! };
}
export async function readArchive(
  file: File,
  signal?: AbortSignal,
): Promise<Lesson> {
  return (await readArchiveCandidate(file, signal)).lesson;
}
