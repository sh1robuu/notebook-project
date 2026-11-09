import {
  inspectHtmlBundle,
  openHtmlBundle,
} from "../modules/interactive/bundle.ts";
import type { OpenedHtmlBundle } from "../modules/interactive/bundle.ts";
import {
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_ENTRIES,
} from "../modules/interactive/bundle-files.ts";
import type {
  InteractiveImportReply,
  InteractiveImportRequest,
} from "../modules/interactive/import-client.ts";
import {
  inspectGeoGebra,
  MAX_GEOGEBRA_BYTES,
} from "../modules/interactive/geogebra.ts";
import { dataImage } from "../modules/media/image-format.ts";

async function verifyPreview(result: OpenedHtmlBundle) {
  if (!result.view.previewDataUrl) return;
  try {
    const image = dataImage(result.view.previewDataUrl);
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(image.bytes)], { type: image.mime }),
    );
    const valid =
      bitmap.width === image.width && bitmap.height === image.height;
    bitmap.close();
    if (!valid) throw new Error("Image dimensions differ.");
  } catch {
    result.view.previewDataUrl = undefined;
    result.summary.hasPreview = false;
    result.summary.diagnostics = [
      ...result.summary.diagnostics.slice(0, 79),
      {
        code: "unsupported",
        message: "The declared static preview could not be decoded.",
      },
    ];
  }
}

const scope = self as DedicatedWorkerGlobalScope;
scope.onmessage = async ({ data }: MessageEvent<InteractiveImportRequest>) => {
  try {
    if (data.kind === "inspect") {
      const files = data.files;
      if (
        !files.length ||
        files.length > MAX_PACKAGE_ENTRIES ||
        files.reduce((total, file) => total + file.size, 0) > MAX_PACKAGE_BYTES
      )
        throw new Error("HTML package exceeds its file or size limit.");
      const input = [];
      for (const file of files)
        input.push({
          path: file.webkitRelativePath || file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      const result = inspectHtmlBundle(input);
      await verifyPreview(result);
      scope.postMessage({ ok: true, result } satisfies InteractiveImportReply, [
        result.bytes.buffer as ArrayBuffer,
      ]);
    } else if (data.kind === "open") {
      const result = openHtmlBundle(data.bytes, data.entry);
      await verifyPreview(result);
      scope.postMessage({ ok: true, result } satisfies InteractiveImportReply);
    } else if (data.kind === "inspect-ggb") {
      if (
        !/\.ggb$/i.test(data.file.name) ||
        !data.file.size ||
        data.file.size > MAX_GEOGEBRA_BYTES
      )
        throw new Error(
          "Chọn một tệp GeoGebra .ggb có kích thước tối đa 8 MB.",
        );
      const bytes = new Uint8Array(await data.file.arrayBuffer());
      const result = { bytes, inspection: inspectGeoGebra(bytes) };
      scope.postMessage({ ok: true, result } satisfies InteractiveImportReply, [
        bytes.buffer,
      ]);
    } else {
      throw new Error("Unknown interactive import operation.");
    }
  } catch (error) {
    scope.postMessage({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Interactive package inspection failed.",
    } satisfies InteractiveImportReply);
  }
};
