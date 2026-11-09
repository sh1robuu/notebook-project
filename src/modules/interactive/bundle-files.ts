import { zipSync } from "fflate";
import { readBoundedZip, safeZipPath } from "../media/bounded-zip.ts";

export type InteractiveInputFile = { path: string; bytes: Uint8Array };
export const MAX_PACKAGE_BYTES = 32_000_000;
export const MAX_EXPANDED_BYTES = 40_000_000;
export const MAX_PACKAGE_ENTRIES = 2_000;
const MAX_PART_BYTES = 16_000_000;
export const safePackagePath = safeZipPath;
export const unpackInteractiveZip = readBoundedZip;
const limit = () =>
  new Error("HTML package exceeds its file, size or expansion limit.");

export function packOriginalFiles(files: readonly InteractiveInputFile[]) {
  if (!files.length || files.length > MAX_PACKAGE_ENTRIES) throw limit();
  let total = 0;
  const seen = new Set<string>();
  const ordered = [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  for (const { path, bytes } of ordered) {
    const normalized = safePackagePath(path).toLowerCase();
    if (seen.has(normalized)) throw new Error("Duplicate HTML package path.");
    seen.add(normalized);
    total += bytes.length;
    if (bytes.length > MAX_PART_BYTES || total > MAX_PACKAGE_BYTES)
      throw limit();
  }
  const zip = zipSync(
    Object.fromEntries(ordered.map(({ path, bytes }) => [path, bytes])),
    {
      level: 0,
      mtime: new Date(2000, 0, 1),
    },
  );
  if (zip.length > MAX_PACKAGE_BYTES) throw limit();
  return zip;
}

export function unpackHtmlZip(bytes: Uint8Array) {
  return unpackInteractiveZip(bytes, {
    label: "HTML package",
    maxPackageBytes: MAX_PACKAGE_BYTES,
    maxExpandedBytes: MAX_EXPANDED_BYTES,
    maxEntries: MAX_PACKAGE_ENTRIES,
    maxPartBytes: MAX_PART_BYTES,
  });
}
