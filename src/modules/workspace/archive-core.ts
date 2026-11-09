import { zipSync, unzipSync } from "fflate";
import {
  digest,
  MAX_ARCHIVE_BYTES,
  object,
  validateLesson,
  WorkspaceError,
} from "./model.ts";
import type { Lesson } from "./model.ts";
import { dataImage } from "../media/image-format.ts";
import { readImageHeader } from "../media/image-format.ts";
import {
  serializedLesson,
  hydrateSources,
  verifySources,
} from "../pdf/sources.ts";
import { verifyDocumentSources } from "../documents/sources.ts";
import { hydratePptxSources, verifyPptxSources } from "../pptx/sources.ts";
import { verifyMathFigures } from "../math/integrity.ts";
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_MANIFEST_BYTES = 512_000;
// PDF.js's Node worker installs self=globalThis. Require an actual window or
// worker capability before enforcing browser-only decoded-pixel validation.
const browserRealm = () =>
  typeof window !== "undefined" ||
  (typeof self !== "undefined" && "importScripts" in self);

export async function encodeArchive(input: Lesson): Promise<Uint8Array> {
  const lesson = validateLesson(input),
    payload = encoder.encode(JSON.stringify(serializedLesson(lesson)));
  await verifySources(lesson.pdfSources);
  await verifyDocumentSources(lesson.wordSources);
  await verifyPptxSources(lesson.pptxSources);
  const entries: Record<string, Uint8Array> = { "lesson.json": payload };
  for (const source of Object.values(lesson.pdfSources))
    entries["sources/" + source.sha256 + ".pdf"] = source.bytes;
  for (const source of Object.values(lesson.wordSources))
    entries["word/" + source.sha256 + ".bin"] = source.bytes;
  for (const source of Object.values(lesson.pptxSources)) {
    const name = source.id.startsWith("pptx:")
      ? `pptx/${source.sha256}.pptx`
      : `pptx-images/${source.sha256}.bin`;
    entries[name] = source.bytes;
  }
  if (
    Object.values(entries).reduce((n, b) => n + b.length, 0) +
      MAX_MANIFEST_BYTES >
    MAX_ARCHIVE_BYTES
  )
    throw new WorkspaceError(
      "limit",
      "The lesson exceeds the 250 MB archive limit.",
    );
  const manifest = encoder.encode(
    JSON.stringify({
      format: "teachboard",
      version: lesson.version === 6 ? 4 : 3,
      files: Object.fromEntries(
        await Promise.all(
          Object.entries(entries).map(async ([name, bytes]) => [
            name,
            { bytes: bytes.length, sha256: await digest(bytes) },
          ]),
        ),
      ),
    }),
  );
  return new Uint8Array(
    zipSync(
      { "manifest.json": manifest, ...entries },
      { level: 1, mtime: new Date(1980, 0, 1) },
    ),
  );
}
export async function decodeArchive(bytes: Uint8Array): Promise<Lesson> {
  if (bytes.length > MAX_ARCHIVE_BYTES)
    throw new WorkspaceError(
      "limit",
      "The archive exceeds the 250 MB file limit.",
    );
  let files: Record<string, Uint8Array>;
  const seen = new Set<string>();
  let total = 0;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        if (
          (!["manifest.json", "lesson.json"].includes(file.name) &&
            !/^sources\/[a-f0-9]{64}\.pdf$/.test(file.name) &&
            !/^word\/[a-f0-9]{64}\.bin$/.test(file.name) &&
            !/^pptx\/[a-f0-9]{64}\.pptx$/.test(file.name) &&
            !/^pptx-images\/[a-f0-9]{64}\.bin$/.test(file.name)) ||
          seen.has(file.name)
        )
          throw new WorkspaceError(
            "entry",
            "Unexpected, duplicate or unsafe archive entry.",
          );
        seen.add(file.name);
        total += file.originalSize;
        if (
          !Number.isSafeInteger(file.originalSize) ||
          file.originalSize < 0 ||
          total > MAX_ARCHIVE_BYTES ||
          (file.name === "manifest.json" &&
            file.originalSize > MAX_MANIFEST_BYTES)
        )
          throw new WorkspaceError(
            "limit",
            "Archive entry size exceeds the allowed limit.",
          );
        return true;
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(
      "archive",
      "This is not a readable lesson ZIP archive.",
    );
  }
  if (!files["manifest.json"] || !files["lesson.json"])
    throw new WorkspaceError(
      "archive",
      "The archive needs manifest.json and lesson.json.",
    );
  let manifest: unknown;
  try {
    manifest = JSON.parse(decoder.decode(files["manifest.json"]));
  } catch {
    throw new WorkspaceError(
      "archive",
      "The archive manifest is not valid UTF-8 JSON.",
    );
  }
  if (
    !object(manifest) ||
    manifest.format !== "teachboard" ||
    ![1, 2, 3, 4].includes(manifest.version as number)
  )
    throw new WorkspaceError(
      "version",
      "Unsupported lesson archive format or version.",
    );
  if (
    !object(manifest.files) ||
    Object.keys(manifest.files).length !== seen.size - 1 ||
    (manifest.version === 1 && seen.size !== 2)
  )
    throw new WorkspaceError(
      "integrity",
      "Archive entries differ from the source manifest.",
    );
  for (const [name, entry] of Object.entries(manifest.files))
    if (
      !files[name] ||
      name === "manifest.json" ||
      !object(entry) ||
      entry.bytes !== files[name].length ||
      entry.sha256 !== (await digest(files[name]))
    )
      throw new WorkspaceError(
        "integrity",
        "Lesson integrity check failed: payload length or SHA-256 checksum differs.",
      );
  let lesson: unknown;
  try {
    lesson = JSON.parse(decoder.decode(files["lesson.json"]));
  } catch {
    throw new WorkspaceError(
      "archive",
      "The lesson payload is not valid UTF-8 JSON.",
    );
  }
  const sourceBytes = Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name.startsWith("sources/"))
      .map(([name, bytes]) => ["pdf:" + name.slice(8, -4), bytes]),
  );
  const wordBytes = Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name.startsWith("word/"))
      .map(([name, data]) => ["word:" + name.slice(5, -4), data]),
  );
  const pptxBytes = Object.fromEntries(
    Object.entries(files).flatMap(([name, data]) => {
      if (name.startsWith("pptx/"))
        return [["pptx:" + name.slice(5, -5), data]];
      if (name.startsWith("pptx-images/"))
        return [["pptx-image:" + name.slice(12, -4), data]];
      return [];
    }),
  );
  if (
    object(lesson) &&
    (lesson.version === 5 || lesson.version === 6) &&
    object(lesson.wordSources)
  ) {
    lesson = {
      ...lesson,
      wordSources: Object.fromEntries(
        Object.entries(lesson.wordSources).map(([id, meta]) => [
          id,
          { ...(object(meta) ? meta : {}), bytes: wordBytes[id] },
        ]),
      ),
    };
  }
  if (object(lesson) && lesson.version === 6)
    lesson = {
      ...lesson,
      pptxSources: hydratePptxSources(lesson.pptxSources, pptxBytes),
    };
  const validated = validateLesson(hydrateSources(lesson, sourceBytes));
  verifyMathFigures(
    [validated.document, validated.scratchpad.document].flatMap((document) =>
      Object.values(document.store).flatMap((record) =>
        record.typeName === "shape" && record.type === "math-figure"
          ? [record.props.figure]
          : [],
      ),
    ),
  );
  if (
    Object.keys(validated.pdfSources).length !== Object.keys(sourceBytes).length
  )
    throw new WorkspaceError("integrity", "Unexpected PDF source in archive.");
  await verifySources(validated.pdfSources);
  if (
    Object.keys(validated.wordSources).length !==
      Object.keys(wordBytes).length ||
    (Number(manifest.version) < 3 && Object.keys(wordBytes).length)
  )
    throw new WorkspaceError("integrity", "Unexpected Word source in archive.");
  await verifyDocumentSources(validated.wordSources);
  if (
    (manifest.version === 4) !== (validated.version === 6) ||
    Object.keys(validated.pptxSources).length !== Object.keys(pptxBytes).length
  )
    throw new WorkspaceError(
      "integrity",
      "Unexpected PowerPoint sources or version in archive.",
    );
  await verifyPptxSources(validated.pptxSources);
  for (const source of [
    ...Object.values(validated.wordSources),
    ...Object.values(validated.pptxSources),
  ]) {
    if (!["image/png", "image/jpeg"].includes(source.mime)) continue;
    if (typeof createImageBitmap === "undefined") {
      if (browserRealm())
        throw new WorkspaceError(
          "unsupported",
          "Document image decoding is unavailable. Keep the original lesson.",
        );
      continue;
    }
    try {
      const header = readImageHeader(source.bytes);
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(source.bytes).buffer], { type: source.mime }),
      );
      try {
        const rotatedPowerPointJpeg =
          source.id.startsWith("pptx-image:") &&
          source.mime === "image/jpeg" &&
          bitmap.width === header.height &&
          bitmap.height === header.width;
        if (
          (bitmap.width !== header.width || bitmap.height !== header.height) &&
          !rotatedPowerPointJpeg
        )
          throw new Error("Document image dimensions differ.");
      } finally {
        bitmap.close();
      }
    } catch {
      throw new WorkspaceError(
        "image",
        "A document image cannot be decoded. The current lesson was kept; retain the original document.",
      );
    }
  }
  // Node tooling checks structure; browser/worker imports also verify decoded pixels
  // before LocalWorkspace can activate or persist the candidate.
  for (const asset of Object.values(validated.document.store)) {
    if (asset.typeName !== "asset" || asset.type !== "image") continue;
    if (typeof createImageBitmap === "undefined") {
      if (browserRealm())
        throw new WorkspaceError(
          "unsupported",
          "Image decoding is unavailable in this browser. Keep the original lesson.",
        );
      continue;
    }
    try {
      const image = dataImage(asset.props.src!);
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(image.bytes).buffer], { type: image.mime }),
      );
      try {
        if (bitmap.width * bitmap.height !== image.width * image.height)
          throw new Error("Image dimensions differ.");
      } finally {
        bitmap.close();
      }
    } catch {
      throw new WorkspaceError(
        "image",
        "An image cannot be decoded. The current lesson was kept; use a complete PNG or JPEG source.",
      );
    }
  }
  return validated;
}
