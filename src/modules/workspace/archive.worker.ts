import { inspectArchive, encodeArchive } from "./archive-core.ts";
import type { Lesson } from "./model.ts";
import { WorkspaceError } from "./model.ts";
self.onmessage = async ({
  data,
}: {
  data: { action: "encode" | "decode"; lesson?: Lesson; file?: File };
}) => {
  try {
    if (data.action === "encode") {
      const bytes = await encodeArchive(data.lesson!);
      self.postMessage({ ok: true, bytes }, [bytes.buffer]);
    } else if (data.action === "decode" && data.file instanceof File) {
      const result = await inspectArchive(
        new Uint8Array(await data.file.arrayBuffer()),
      );
      const sourceBuffers = new Set<ArrayBuffer>();
      for (const pool of [
        result.lesson.pdfSources,
        result.lesson.wordSources,
        result.lesson.pptxSources,
        result.lesson.interactiveSources ?? {},
      ])
        for (const source of Object.values(pool))
          if (source.bytes.buffer instanceof ArrayBuffer)
            sourceBuffers.add(source.bytes.buffer);
      self.postMessage({ ok: true, ...result }, [...sourceBuffers]);
    } else throw new Error("Unsupported archive operation.");
  } catch (error) {
    self.postMessage({
      ok: false,
      code: error instanceof WorkspaceError ? error.code : "archive",
      error: error instanceof Error ? error.message : "Lesson archive failed.",
    });
  }
};
