import { createHash } from "node:crypto";
import sharp from "sharp";
import { RoomError } from "../rooms/model.ts";

export const mediaLimits = {
  uploadBytes: 10_000_000,
  inputPixels: 16_000_000,
  inputDimension: 8192,
  imageDimension: 2048,
  thumbnailDimension: 320,
  imageBytes: 2_000_000,
  thumbnailBytes: 100_000,
  processSeconds: 6,
} as const;

export const imageTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMime = (typeof imageTypes)[number];
export const storedMime = "image/jpeg";

sharp.cache(false);
sharp.concurrency(1);

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function signature(bytes: Buffer): ImageMime | undefined {
  if (bytes.length < 16) return undefined;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (bytes.subarray(0, 8).equals(pngSignature)) return "image/png";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
}

function invalidImage() {
  return new RoomError(
    422,
    "invalid_image",
    "Choose a supported, intact JPEG, PNG or WebP image within the size and dimension limits.",
  );
}

export async function normalizeMedia(input: Buffer, declaredMime: ImageMime) {
  if (
    input.length > mediaLimits.uploadBytes ||
    signature(input) !== declaredMime
  )
    throw invalidImage();

  try {
    const decoded = sharp(input, {
      limitInputPixels: mediaLimits.inputPixels,
      failOn: "warning",
    }).timeout({ seconds: mediaLimits.processSeconds });
    const metadata = await decoded.metadata();
    if (
      metadata.format !== declaredMime.slice(6) ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages ?? 1) !== 1 ||
      Math.max(metadata.width, metadata.height) > mediaLimits.inputDimension
    )
      throw invalidImage();

    const { data, info } = await decoded
      .autoOrient()
      .resize({
        width: mediaLimits.imageDimension,
        height: mediaLimits.imageDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#fff" })
      .jpeg({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const image =
      data.length <= mediaLimits.imageBytes
        ? data
        : await sharp(data, {
            limitInputPixels: mediaLimits.imageDimension ** 2,
            failOn: "warning",
          })
            .timeout({ seconds: mediaLimits.processSeconds })
            .jpeg({ quality: 64 })
            .toBuffer();
    if (image.length > mediaLimits.imageBytes) throw invalidImage();
    const thumbnail = await sharp(image, {
      limitInputPixels: mediaLimits.imageDimension ** 2,
      failOn: "warning",
    })
      .timeout({ seconds: mediaLimits.processSeconds })
      .resize({
        width: mediaLimits.thumbnailDimension,
        height: mediaLimits.thumbnailDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 72 })
      .toBuffer();
    if (thumbnail.length > mediaLimits.thumbnailBytes) throw invalidImage();
    return {
      image,
      thumbnail,
      width: info.width,
      height: info.height,
      sha256: createHash("sha256").update(image).digest("hex"),
    };
  } catch {
    throw invalidImage();
  }
}
