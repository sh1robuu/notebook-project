import { decodeArchive, encodeArchive } from "./archive-core.ts";
import type { Lesson } from "./model.ts";
self.onmessage = async ({
  data,
}: {
  data: { action: "encode" | "decode"; lesson?: Lesson; bytes?: Uint8Array };
}) => {
  try {
    if (data.action === "encode") {
      const bytes = await encodeArchive(data.lesson!);
      self.postMessage({ ok: true, bytes }, [bytes.buffer]);
    } else
      self.postMessage({ ok: true, lesson: await decodeArchive(data.bytes!) });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Lesson archive failed.",
    });
  }
};
