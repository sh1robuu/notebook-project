import { zipSync } from "fflate";
import { BoundedZipError, readBoundedZip } from "../media/bounded-zip.ts";
import { APP_VERSION, ARCHIVE_MAX_VERSION } from "../../config/version.ts";
import { product } from "../../config/product.ts";
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
import {
  hydrateInteractiveSources,
  referencedInteractiveSources,
  verifyInteractiveSources,
} from "../interactive/sources.ts";
import { verifyInteractiveMaterials } from "../interactive/archive-validation.ts";
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_MANIFEST_BYTES = 512_000;
const MAX_ARCHIVE_ENTRIES = 2048;
const MAX_COMPRESSION_RATIO = 1100;
export type ArchiveInfo = {
  formatVersion: number;
  applicationVersion: string | null;
  createdAt: string | null;
  sourceLessonId: string;
  mainPages: number;
  mainObjects: number;
  scratchpadObjects: number;
  sourceCount: number;
  sourceBytes: number;
  warnings: string[];
};
export type ArchiveCandidate = { lesson: Lesson; info: ArchiveInfo };
// PDF.js's Node worker installs self=globalThis. Require an actual window or
// worker capability before enforcing browser-only decoded-pixel validation.
const browserRealm = () =>
  typeof window !== "undefined" ||
  (typeof self !== "undefined" && "importScripts" in self);

export async function encodeArchive(input: Lesson): Promise<Uint8Array> {
  const lesson = validateLesson(input);
  lesson.interactiveSources = referencedInteractiveSources(
    [lesson.document, lesson.scratchpad.document],
    lesson.interactiveSources ?? {},
  );
  const hasInteractives = Object.keys(lesson.interactiveSources).length > 0;
  const payload = encoder.encode(JSON.stringify(serializedLesson(lesson)));
  await verifySources(lesson.pdfSources);
  await verifyDocumentSources(lesson.wordSources);
  await verifyPptxSources(lesson.pptxSources);
  await verifyInteractiveSources(lesson.interactiveSources);
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
  for (const source of Object.values(lesson.interactiveSources))
    entries[`interactive/${source.sha256}.bin`] = source.bytes;
  const expandedBytes = Object.values(entries).reduce(
    (n, b) => n + b.length,
    0,
  );
  if (
    Object.keys(entries).length + 1 > MAX_ARCHIVE_ENTRIES ||
    expandedBytes > MAX_ARCHIVE_BYTES
  )
    throw new WorkspaceError(
      "limit",
      "The lesson exceeds the 250 MB archive limit.",
    );
  const checksums: Record<string, { bytes: number; sha256: string }> = {};
  for (const [name, bytes] of Object.entries(entries))
    checksums[name] = { bytes: bytes.length, sha256: await digest(bytes) };
  const manifest = encoder.encode(
    JSON.stringify({
      format: "teachboard",
      version: hasInteractives ? 5 : lesson.version === 6 ? 4 : 3,
      application: product.name,
      applicationVersion: APP_VERSION,
      sdkVersion: lesson.sdkVersion,
      sourceLessonId: lesson.id,
      createdAt: new Date().toISOString(),
      files: checksums,
    }),
  );
  if (manifest.length > MAX_MANIFEST_BYTES)
    throw new WorkspaceError(
      "limit",
      "The archive manifest exceeds its size limit.",
    );
  if (expandedBytes + manifest.length > MAX_ARCHIVE_BYTES)
    throw new WorkspaceError(
      "limit",
      "The lesson exceeds the 250 MB archive limit.",
    );
  const archive = zipSync(
    { "manifest.json": manifest, ...entries },
    { level: 1, mtime: new Date(1980, 0, 1) },
  );
  if (archive.length > MAX_ARCHIVE_BYTES)
    throw new WorkspaceError(
      "limit",
      "The archive exceeds the 250 MB file limit.",
    );
  return archive;
}
export async function inspectArchive(
  bytes: Uint8Array,
): Promise<ArchiveCandidate> {
  if (bytes.length > MAX_ARCHIVE_BYTES)
    throw new WorkspaceError(
      "limit",
      "The archive exceeds the 250 MB file limit.",
    );
  let files: Record<string, Uint8Array>;
  const seen = new Set<string>();
  try {
    const unpacked = readBoundedZip(bytes, {
      label: "Lesson archive",
      maxPackageBytes: MAX_ARCHIVE_BYTES,
      maxExpandedBytes: MAX_ARCHIVE_BYTES,
      maxEntries: MAX_ARCHIVE_ENTRIES,
      maxPartBytes: MAX_ARCHIVE_BYTES,
      maxCompressionRatio: MAX_COMPRESSION_RATIO,
      validateEntry(file) {
        if (
          file.folder ||
          (!["manifest.json", "lesson.json"].includes(file.path) &&
            !/^sources\/[a-f0-9]{64}\.pdf$/.test(file.path) &&
            !/^word\/[a-f0-9]{64}\.bin$/.test(file.path) &&
            !/^pptx\/[a-f0-9]{64}\.pptx$/.test(file.path) &&
            !/^pptx-images\/[a-f0-9]{64}\.bin$/.test(file.path) &&
            !/^interactive\/[a-f0-9]{64}\.bin$/.test(file.path))
        )
          throw new WorkspaceError(
            "entry",
            "Unexpected, duplicate or unsafe archive entry.",
          );
        seen.add(file.path);
        if (
          file.path === "manifest.json" &&
          file.expandedBytes > MAX_MANIFEST_BYTES
        )
          throw new WorkspaceError(
            "limit",
            "Archive entry size exceeds the allowed limit.",
          );
      },
    });
    files = Object.fromEntries(unpacked.files);
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    if (error instanceof BoundedZipError)
      throw new WorkspaceError(error.code, error.message);
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
    typeof manifest.version !== "number" ||
    !Number.isInteger(manifest.version) ||
    manifest.version < 1 ||
    manifest.version > ARCHIVE_MAX_VERSION
  )
    throw new WorkspaceError(
      "version",
      "Unsupported lesson archive format or version.",
    );
  if (
    (manifest.application !== undefined &&
      manifest.application !== product.name) ||
    (manifest.applicationVersion !== undefined &&
      (typeof manifest.applicationVersion !== "string" ||
        !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(
          manifest.applicationVersion,
        ) ||
        manifest.applicationVersion.length > 80)) ||
    (manifest.createdAt !== undefined &&
      (typeof manifest.createdAt !== "string" ||
        !Number.isFinite(Date.parse(manifest.createdAt))))
  )
    throw new WorkspaceError(
      "version",
      "Invalid archive application metadata.",
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
      !Object.hasOwn(files, name) ||
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
  const interactiveBytes = Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name.startsWith("interactive/"))
      .map(([name, data]) => [name.slice(0, -4).replace("/", ":"), data]),
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
      interactiveSources: hydrateInteractiveSources(
        lesson.interactiveSources,
        interactiveBytes,
      ),
    };
  const validated = validateLesson(hydrateSources(lesson, sourceBytes));
  if (
    (manifest.sourceLessonId !== undefined &&
      manifest.sourceLessonId !== validated.id) ||
    (manifest.sdkVersion !== undefined &&
      manifest.sdkVersion !== validated.sdkVersion)
  )
    throw new WorkspaceError(
      "integrity",
      "Archive compatibility metadata differs from its lesson.",
    );
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
    Number(manifest.version) >= 4 !== (validated.version === 6) ||
    Object.keys(validated.pptxSources).length !== Object.keys(pptxBytes).length
  )
    throw new WorkspaceError(
      "integrity",
      "Unexpected PowerPoint sources or version in archive.",
    );
  await verifyPptxSources(validated.pptxSources);
  const interactiveSources = validated.interactiveSources ?? {};
  const sourceCount = Object.keys(interactiveSources).length;
  if (
    (manifest.version === 5) !== sourceCount > 0 ||
    sourceCount !== Object.keys(interactiveBytes).length ||
    sourceCount !==
      Object.keys(
        referencedInteractiveSources(
          [validated.document, validated.scratchpad.document],
          interactiveSources,
        ),
      ).length
  )
    throw new WorkspaceError(
      "integrity",
      "Unexpected interactive sources or version in archive.",
    );
  await verifyInteractiveSources(interactiveSources);
  verifyInteractiveMaterials(
    [validated.document, validated.scratchpad.document],
    interactiveSources,
  );
  for (const source of [
    ...Object.values(validated.wordSources),
    ...Object.values(validated.pptxSources),
    ...Object.values(interactiveSources).flatMap((source) =>
      source.kind === "preview"
        ? [{ ...source, mime: readImageHeader(source.bytes).mime }]
        : [],
    ),
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
  const mainRecords = Object.values(validated.document.store);
  const scratchRecords = Object.values(validated.scratchpad.document.store);
  const sources = [
    ...Object.values(validated.pdfSources),
    ...Object.values(validated.wordSources),
    ...Object.values(validated.pptxSources),
    ...Object.values(validated.interactiveSources ?? {}),
  ];
  const warnings: string[] = [];
  if (!manifest.applicationVersion)
    warnings.push(
      "Tệp cũ chưa ghi phiên bản ứng dụng. Dữ liệu đã được kiểm tra bằng định dạng hiện tại.",
    );
  else if (manifest.applicationVersion !== APP_VERSION)
    warnings.push(
      "Tệp được tạo bằng phiên bản ứng dụng khác. Chỉ nội dung tương thích đã kiểm tra mới được mở.",
    );
  const materials = [...mainRecords, ...scratchRecords].filter(
    (record) => record.typeName === "shape" && record.type === "interactive",
  );
  if (
    materials.some(
      (record) =>
        record.typeName === "shape" &&
        record.type === "interactive" &&
        record.props.material.kind === "geogebra",
    )
  )
    warnings.push(
      "GeoGebra giữ tệp GGB gốc. Chạy bản nhúng và khôi phục thao tác GeoGebra chưa được hỗ trợ.",
    );
  if (
    materials.some(
      (record) =>
        record.typeName === "shape" &&
        record.type === "interactive" &&
        record.props.material.kind === "html",
    )
  )
    warnings.push(
      "Mô phỏng HTML mở theo phạm vi hỗ trợ của ứng dụng. Mã JavaScript trong tệp được giữ lại nhưng không chạy.",
    );
  return {
    lesson: validated,
    info: {
      formatVersion: Number(manifest.version),
      applicationVersion:
        typeof manifest.applicationVersion === "string"
          ? manifest.applicationVersion
          : null,
      createdAt:
        typeof manifest.createdAt === "string" ? manifest.createdAt : null,
      sourceLessonId: validated.id,
      mainPages: mainRecords.filter((record) => record.typeName === "page")
        .length,
      mainObjects: mainRecords.filter((record) => record.typeName === "shape")
        .length,
      scratchpadObjects: scratchRecords.filter(
        (record) => record.typeName === "shape",
      ).length,
      sourceCount: sources.length,
      sourceBytes: sources.reduce((total, source) => total + source.size, 0),
      warnings,
    },
  };
}

export async function decodeArchive(bytes: Uint8Array): Promise<Lesson> {
  return (await inspectArchive(bytes)).lesson;
}
