import { inflateSync } from "fflate";

export class BoundedZipError extends Error {
  readonly code: "archive" | "entry" | "limit" | "integrity";
  constructor(
    code: "archive" | "entry" | "limit" | "integrity",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "BoundedZipError";
  }
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const crcTable = Array.from({ length: 256 }, (_, byte) => {
  for (let i = 0; i < 8; i++) byte = (byte >>> 1) ^ (byte & 1 ? 0xedb88320 : 0);
  return byte;
});

function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ -1) >>> 0;
}

export function safeZipPath(path: string) {
  if (
    !path ||
    path.length > 240 ||
    /[\\:\u0000-\u001f\u007f?#]/.test(path) ||
    path
      .split("/")
      .some(
        (part) =>
          !part || /^(?:\.{1,2}|__proto__|constructor|prototype)$/i.test(part),
      )
  )
    throw new BoundedZipError("entry", "Unsafe ZIP package path.");
  return path;
}

function registerPath(seen: Set<string>, path: string) {
  const key = safeZipPath(path).toLowerCase();
  if (seen.has(key))
    throw new BoundedZipError("entry", "Duplicate ZIP package path.");
  seen.add(key);
}

type ZipPart = {
  path: string;
  folder: boolean;
  crc: number;
  method: number;
  length: number;
  start: number;
  end: number;
  header: number;
};

/**
 * Validate the ZIP directory and every local span before inflating anything.
 * Only ordinary single-disk UTF-8 ZIPs with stored or Deflate entries are accepted.
 */
export function readBoundedZip(
  bytes: Uint8Array,
  limits: {
    label: string;
    maxPackageBytes: number;
    maxExpandedBytes: number;
    maxEntries: number;
    maxPartBytes: number;
    maxCompressionRatio?: number;
    validateEntry?: (entry: {
      path: string;
      folder: boolean;
      compressedBytes: number;
      expandedBytes: number;
    }) => void;
  },
) {
  const corrupt = () =>
    new BoundedZipError(
      "archive",
      "Corrupt or unsupported " + limits.label + " ZIP.",
    );
  const exceeds = () =>
    new BoundedZipError(
      "limit",
      limits.label + " exceeds its file, size or expansion limit.",
    );
  if (bytes.length > limits.maxPackageBytes) throw exceeds();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => view.getUint16(p, true);
  const u32 = (p: number) => view.getUint32(p, true);
  let eocd = bytes.length - 22;
  const earliest = Math.max(0, eocd - 65535);
  while (
    eocd >= earliest &&
    (u32(eocd) !== 0x06054b50 || eocd + 22 + u16(eocd + 20) !== bytes.length)
  )
    eocd--;
  if (eocd < earliest || u16(eocd + 4) || u16(eocd + 6)) throw corrupt();
  const count = u16(eocd + 10);
  if (count > limits.maxEntries) throw exceeds();
  if (!count || count !== u16(eocd + 8)) throw corrupt();
  const central = u32(eocd + 16);
  if (central + u32(eocd + 12) !== eocd) throw corrupt();

  const parts: ZipPart[] = [];
  const seen = new Set<string>();
  let expanded = 0;
  let p = central;
  for (let index = 0; index < count; index++) {
    if (p + 46 > eocd || u32(p) !== 0x02014b50 || u16(p + 34)) throw corrupt();
    const flags = u16(p + 8);
    const method = u16(p + 10);
    const crc = u32(p + 16);
    const compressed = u32(p + 20);
    const length = u32(p + 24);
    const nameLength = u16(p + 28);
    const header = u32(p + 42);
    expanded += length;
    if (
      length > limits.maxPartBytes ||
      expanded > limits.maxExpandedBytes ||
      (limits.maxCompressionRatio &&
        length > 4096 &&
        length > compressed * limits.maxCompressionRatio)
    )
      throw exceeds();
    const next = p + 46 + nameLength + u16(p + 30) + u16(p + 32);
    if (
      next > eocd ||
      !nameLength ||
      nameLength > 960 ||
      flags & ~0x080e ||
      (method !== 0 && method !== 8) ||
      ((u32(p + 38) >>> 16) & 0xf000) === 0xa000 ||
      (method === 0 && compressed !== length) ||
      header + 30 > central ||
      u32(header) !== 0x04034b50 ||
      u16(header + 6) !== flags ||
      u16(header + 8) !== method ||
      u16(header + 26) !== nameLength
    )
      throw corrupt();
    const start = header + 30 + nameLength + u16(header + 28);
    const end = start + compressed;
    const name = bytes.subarray(p + 46, p + 46 + nameLength);
    if (
      end > central ||
      !name.every((byte, i) => byte === bytes[header + 30 + i]) ||
      (!(flags & 8) &&
        (u32(header + 14) !== crc ||
          u32(header + 18) !== compressed ||
          u32(header + 22) !== length))
    )
      throw corrupt();
    const rawPath = UTF8.decode(name);
    const folder = rawPath.endsWith("/");
    const path = folder ? rawPath.slice(0, -1) : rawPath;
    registerPath(seen, path);
    if (folder && length) throw corrupt();
    limits.validateEntry?.({
      path,
      folder,
      compressedBytes: compressed,
      expandedBytes: length,
    });
    parts.push({ path, folder, crc, method, length, start, end, header });
    p = next;
  }
  if (p !== eocd) throw corrupt();
  const spans = [...parts].sort((a, b) => a.header - b.header);
  if (
    spans.some((part, index) => index > 0 && part.header < spans[index - 1].end)
  )
    throw corrupt();

  const files = new Map<string, Uint8Array>();
  for (const part of parts) {
    const compressed = bytes.subarray(part.start, part.end);
    let data: Uint8Array;
    try {
      // One extra byte detects understated expanded lengths without allocating
      // anything based on the actual, possibly hostile, Deflate expansion.
      data =
        part.method === 0
          ? new Uint8Array(compressed)
          : inflateSync(compressed, { out: new Uint8Array(part.length + 1) });
    } catch {
      throw corrupt();
    }
    if (data.length !== part.length || crc32(data) !== part.crc)
      throw new BoundedZipError(
        "integrity",
        limits.label + " ZIP checksum or size differs from its directory.",
      );
    if (!part.folder) files.set(part.path, data);
  }
  return { files, expandedBytes: expanded };
}
