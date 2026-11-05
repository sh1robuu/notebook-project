import {
  object,
  WorkspaceError,
  MAX_ARCHIVE_BYTES,
  MAX_PAGES,
} from "../workspace/contracts.ts";
import { digest } from "../workspace/model.ts";
import type { Lesson } from "../workspace/model.ts";
export const MAX_PDF_BYTES = 50_000_000;
export type PdfPageInfo = {
  width: number;
  height: number;
  rotation: number;
  userUnit: number;
  viewBox: number[];
  transform: number[];
  rasterOnly: boolean;
  hasText: boolean;
};
export type PdfSource = {
  sourceVersion: 1;
  id: string;
  sha256: string;
  name: string;
  size: number;
  bytes: Uint8Array;
  encrypted: boolean;
  pages: PdfPageInfo[];
};
export type PdfSources = Record<string, PdfSource>;
const hex = /^[a-f0-9]{64}$/;
export function validateSources(input: unknown): PdfSources {
  if (input === undefined) return {};
  if (!object(input) || Object.keys(input).length > MAX_PAGES)
    throw new WorkspaceError("source", "Invalid PDF source pool.");
  let total = 0;
  const out: PdfSources = {};
  for (const [id, v] of Object.entries(input)) {
    if (!object(v) || v.sourceVersion !== 1)
      throw new WorkspaceError(
        "version",
        "Unsupported PDF source format version.",
      );
    if (
      !object(v) ||
      typeof v.sha256 !== "string" ||
      !hex.test(v.sha256) ||
      id !== "pdf:" + v.sha256 ||
      v.id !== id ||
      typeof v.name !== "string" ||
      v.name.length > 180 ||
      typeof v.encrypted !== "boolean" ||
      !(v.bytes instanceof Uint8Array) ||
      v.bytes.length !== v.size ||
      !Number.isSafeInteger(v.size) ||
      Number(v.size) > MAX_PDF_BYTES ||
      Number(v.size) < 8 ||
      !new TextDecoder().decode(v.bytes.subarray(0, 1024)).includes("%PDF-") ||
      !Array.isArray(v.pages) ||
      v.pages.length < 1 ||
      v.pages.length > MAX_PAGES
    )
      throw new WorkspaceError(
        "source",
        "Invalid, missing or oversized original PDF source.",
      );
    total += Number(v.size);
    if (total > MAX_ARCHIVE_BYTES)
      throw new WorkspaceError(
        "limit",
        "PDF sources exceed the 250 MB lesson/archive budget.",
      );
    for (const p of v.pages) {
      if (
        !object(p) ||
        ![p.width, p.height].every(
          (n) =>
            typeof n === "number" &&
            Number.isFinite(n) &&
            n >= 1 &&
            n <= 100000,
        ) ||
        ![0, 90, 180, 270].includes(Number(p.rotation)) ||
        typeof p.userUnit !== "number" ||
        !Number.isFinite(p.userUnit) ||
        p.userUnit <= 0 ||
        typeof p.rasterOnly !== "boolean" ||
        typeof p.hasText !== "boolean" ||
        !Array.isArray(p.viewBox) ||
        p.viewBox.length !== 4 ||
        !Array.isArray(p.transform) ||
        p.transform.length !== 6 ||
        ![...p.viewBox, ...p.transform].every(
          (n) =>
            typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e8,
        )
      )
        throw new WorkspaceError("source", "Invalid PDF page geometry.");
      if (
        p.viewBox[2] <= p.viewBox[0] ||
        p.viewBox[3] <= p.viewBox[1] ||
        Math.abs(
          p.transform[0] * p.transform[3] - p.transform[1] * p.transform[2],
        ) < 1e-12
      )
        throw new WorkspaceError("source", "Invalid PDF crop or transform.");
    }
    out[id] = v as unknown as PdfSource;
  }
  return out;
}
export async function verifySources(input: unknown): Promise<PdfSources> {
  const sources = validateSources(input);
  for (const source of Object.values(sources))
    if ((await digest(source.bytes)) !== source.sha256)
      throw new WorkspaceError(
        "integrity",
        "Original PDF checksum differs. Current work is unchanged.",
      );
  return sources;
}
/** Metadata only: original bytes live in immutable IDB rows / separate ZIP entries. */
export function serializedLesson(lesson: Lesson) {
  return {
    ...lesson,
    wordSources: Object.fromEntries(
      Object.entries(lesson.wordSources ?? {}).map(
        ([id, { bytes: _, ...meta }]) => [id, meta],
      ),
    ),
    pdfSources: Object.fromEntries(
      Object.entries(lesson.pdfSources).map(([id, { bytes: _, ...meta }]) => [
        id,
        meta,
      ]),
    ),
  };
}
export function hydrateSources(
  value: unknown,
  bytes: Record<string, Uint8Array>,
): unknown {
  if (!object(value))
    throw new WorkspaceError("source", "Invalid lesson metadata.");
  if (![4, 5].includes(Number(value.version))) return value;
  if (!object(value.pdfSources))
    throw new WorkspaceError("source", "Missing PDF source manifest.");
  return {
    ...value,
    pdfSources: Object.fromEntries(
      Object.entries(value.pdfSources).map(([id, meta]) => [
        id,
        { ...(object(meta) ? meta : {}), bytes: bytes[id] },
      ]),
    ),
  };
}
