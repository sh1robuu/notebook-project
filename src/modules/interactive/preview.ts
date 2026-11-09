import { readImageHeader } from "../media/image-format.ts";

/** One static-image contract for imported, teacher-selected and restored posters. */
export function readInteractivePreview(bytes: Uint8Array) {
  if (bytes.length > 512_000) throw new Error("Preview image exceeds 512 KB.");
  const header = readImageHeader(bytes);
  if (header.width * header.height > 2_000_000)
    throw new Error("Preview image exceeds 2 megapixels.");
  if (header.mime === "image/png") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let at = 8; at + 12 <= bytes.length;) {
      const length = view.getUint32(at);
      if (length > bytes.length - at - 12)
        throw new Error("Preview PNG chunk is truncated.");
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      if (type === "acTL" || type === "fcTL" || type === "fdAT")
        throw new Error("Preview PNG must be a static image.");
      if (type === "IEND") break;
      at += length + 12;
    }
  }
  return header;
}
