import type { Editor, TLImageAsset } from "tldraw";
import {
  MAX_IMAGE_ASSETS,
  MAX_TOTAL_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_PIXELS,
} from "./image-format.ts";
export function checkAssetBudget(editor: Editor, incoming: TLImageAsset[]) {
  const assets = new Map(
    editor.store
      .allRecords()
      .filter(
        (r): r is TLImageAsset => r.typeName === "asset" && r.type === "image",
      )
      .map((a) => [a.id, a]),
  );
  for (const a of incoming) {
    const existing = assets.get(a.id);
    if (existing && existing.props.src !== a.props.src)
      throw new Error(
        "Conflicting image asset identity. Different original bytes were kept separate; this insertion was cancelled.",
      );
    assets.set(a.id, a);
  }
  let bytes = 0,
    pixels = 0;
  for (const a of assets.values()) {
    // fileSize is optional untrusted metadata. Sources have already passed the
    // local base64 contract; compute actual byte length without allocating pixels.
    const src = a.props.src!;
    const padding = src.endsWith("==") ? 2 : src.endsWith("=") ? 1 : 0;
    bytes += ((src.length - src.indexOf(",") - 1) * 3) / 4 - padding;
    pixels += a.props.w * a.props.h;
  }
  if (
    assets.size > MAX_IMAGE_ASSETS ||
    bytes > MAX_TOTAL_IMAGE_BYTES ||
    pixels > MAX_TOTAL_IMAGE_PIXELS
  )
    throw new Error(
      "Local image assets exceed 50 MB, 32 megapixels or 512 distinct sources.",
    );
}
