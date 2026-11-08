import { parsePptx } from "./parser.ts";

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = async ({
  data,
}: MessageEvent<{ bytes: Uint8Array; name: string }>) => {
  try {
    const result = await parsePptx(data.bytes, data.name, (message) =>
      worker.postMessage({ type: "progress", message }),
    );
    const transfer = [
      ...new Set(
        Object.values(result.sources).map(
          (source) => source.bytes.buffer as ArrayBuffer,
        ),
      ),
    ];
    worker.postMessage({ type: "result", result }, transfer);
  } catch (error) {
    worker.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "PowerPoint inspection failed.",
    });
  }
};
