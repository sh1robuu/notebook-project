import { parseDocx } from "./docx.ts";
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (
  event: MessageEvent<{ bytes: Uint8Array; name: string }>,
) => {
  try {
    const result = await parseDocx(
      event.data.bytes,
      event.data.name,
      (message) => scope.postMessage({ type: "progress", message }),
    );
    scope.postMessage({ type: "result", result });
  } catch (error) {
    scope.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "DOCX import failed. Existing work is unchanged.",
    });
  }
};
