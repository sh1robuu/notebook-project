import type { TLImageAsset } from "tldraw";
import {
  readImageHeader,
  imageDataUrl,
  MAX_IMAGE_BYTES,
} from "./image-format.ts";
import { digest } from "../workspace/model.ts";
import { lessonSchema } from "../workspace/schema.ts";
export async function prepareImage(file: File): Promise<TLImageAsset> {
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error("Image exceeds the 10 MB file limit.");
  const bytes = new Uint8Array(await file.arrayBuffer()),
    header = readImageHeader(bytes);
  if (file.type && file.type !== header.mime)
    throw new Error("Image content and declared file type differ.");
  let width = header.width,
    height = header.height;
  const bitmap = await createImageBitmap(
    new Blob([bytes.buffer], { type: header.mime }),
  );
  try {
    width = bitmap.width;
    height = bitmap.height;
    if (width * height !== header.width * header.height)
      throw new Error("Decoded image dimensions differ from its header.");
  } finally {
    bitmap.close();
  }
  return lessonSchema.types.asset.create({
    id: `asset:${await digest(bytes)}`,
    type: "image",
    props: {
      src: imageDataUrl(bytes, header.mime),
      name: file.name.slice(0, 120),
      w: width,
      h: height,
      mimeType: header.mime,
      isAnimated: false,
      fileSize: bytes.length,
    },
  } as never) as TLImageAsset;
}
