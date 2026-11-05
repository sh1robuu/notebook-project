export const MAX_IMAGE_BYTES = 10_000_000;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_TOTAL_IMAGE_BYTES = 50_000_000;
export const MAX_TOTAL_IMAGE_PIXELS = 32_000_000;
export const MAX_IMAGE_ASSETS = 512;
export type ImageHeader = {
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
};
export function readImageHeader(bytes: Uint8Array): ImageHeader {
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new Error("Image exceeds the 10 MB file limit.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0,
    mime: ImageHeader["mime"];
  if (
    bytes.length >= 33 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n) &&
    v.getUint32(8) === 13 &&
    String.fromCharCode(...bytes.slice(12, 16)) === "IHDR"
  ) {
    mime = "image/png";
    width = v.getUint32(16);
    height = v.getUint32(20);
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    mime = "image/jpeg";
    let at = 2;
    while (at < bytes.length) {
      if (bytes[at++] !== 255) throw new Error("Invalid JPEG marker.");
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (at + 2 > bytes.length) break;
      const length = v.getUint16(at);
      if (length < 2 || at + length > bytes.length)
        throw new Error("Truncated JPEG image.");
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        if (length < 8) throw new Error("Invalid JPEG frame.");
        height = v.getUint16(at + 3);
        width = v.getUint16(at + 5);
        break;
      }
      at += length;
    }
  } else throw new Error("Only PNG and JPEG image content is supported.");
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > MAX_IMAGE_PIXELS
  )
    throw new Error(
      "Image dimensions exceed the 8192 px / 16 megapixel limit.",
    );
  return { mime, width, height };
}
export function dataImage(src: string): ImageHeader & { bytes: Uint8Array } {
  if (src.length > (MAX_IMAGE_BYTES * 4) / 3 + 100)
    throw new Error("Image data exceeds the file limit.");
  const match =
    /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(src);
  if (!match) throw new Error("Only local PNG/JPEG data images are supported.");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("Invalid image encoding.");
  }
  const header = readImageHeader(bytes);
  if (header.mime !== match[1])
    throw new Error("Image content and declared type differ.");
  return { ...header, bytes };
}
export function imageDataUrl(
  bytes: Uint8Array,
  mime: ImageHeader["mime"],
): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 32768)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return `data:${mime};base64,${btoa(chunks.join(""))}`;
}
