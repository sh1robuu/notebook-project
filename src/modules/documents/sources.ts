import { readImageHeader } from "../media/image-format.ts";
export const MAX_DOCUMENT_SOURCE_BYTES = 50_000_000;
export const MAX_DOCUMENT_POOL_BYTES = 250_000_000;
export type DocumentSource = {
  sourceVersion: 1;
  id: string;
  sha256: string;
  name: string;
  mime: string;
  size: number;
  bytes: Uint8Array;
};
export type DocumentSources = Record<string, DocumentSource>;
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const supportedMimes = new Set([
  DOCX_MIME,
  "image/png",
  "image/jpeg",
  "image/x-emf",
  "image/x-wmf",
  "application/x-ole-storage",
  "application/octet-stream",
  "text/plain",
  "text/html",
  "text/rtf",
]);
export async function documentDigest(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function documentSource(
  bytes: Uint8Array,
  name: string,
  mime: string,
): Promise<DocumentSource> {
  const sha256 = await documentDigest(bytes);
  const result: DocumentSource = {
    sourceVersion: 1,
    id: `word:${sha256}`,
    sha256,
    name: name.slice(0, 180).replace(/[\u0000-\u001f]/g, ""),
    mime,
    size: bytes.length,
    bytes: bytes.slice(),
  };
  validateDocumentSources({ [result.id]: result });
  return result;
}
export function validateDocumentSources(input: unknown): DocumentSources {
  if (input === undefined) return {};
  if (!isObject(input) || Object.keys(input).length > 512)
    throw new Error("Invalid document source pool (maximum 512 sources).");
  let total = 0,
    imageBytes = 0,
    imagePixels = 0;
  const out: DocumentSources = {};
  for (const [id, source] of Object.entries(input)) {
    if (
      !isObject(source) ||
      source.sourceVersion !== 1 ||
      typeof source.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(source.sha256) ||
      id !== `word:${source.sha256}` ||
      source.id !== id ||
      typeof source.name !== "string" ||
      source.name.length > 180 ||
      /[\u0000-\u001f]/.test(source.name) ||
      typeof source.mime !== "string" ||
      !supportedMimes.has(source.mime) ||
      !(source.bytes instanceof Uint8Array) ||
      source.bytes.length !== source.size ||
      !Number.isSafeInteger(source.size) ||
      Number(source.size) < 1 ||
      Number(source.size) > MAX_DOCUMENT_SOURCE_BYTES
    )
      throw new Error(
        "Invalid, missing or oversized immutable document source.",
      );
    total += Number(source.size);
    if (total > MAX_DOCUMENT_POOL_BYTES)
      throw new Error("Document sources exceed the 250 MB source budget.");
    if (source.mime === "image/png" || source.mime === "image/jpeg") {
      const header = readImageHeader(source.bytes);
      if (header.mime !== source.mime)
        throw new Error("Document image bytes and MIME type differ.");
      imageBytes += source.bytes.length;
      imagePixels += header.width * header.height;
      if (imageBytes > 50_000_000 || imagePixels > 32_000_000)
        throw new Error(
          "Document images exceed the 50 MB /32 megapixel aggregate source budget.",
        );
    }
    out[id] = source as DocumentSource;
  }
  return out;
}
export async function verifyDocumentSources(
  sources: DocumentSources,
): Promise<void> {
  validateDocumentSources(sources);
  for (const source of Object.values(sources))
    if ((await documentDigest(source.bytes)) !== source.sha256)
      throw new Error(
        "Original document source checksum differs. Existing work has been kept.",
      );
}
export function stripWordSourceBytes(sources: DocumentSources) {
  return Object.fromEntries(
    Object.entries(sources).map(([id, { bytes: _bytes, ...source }]) => [
      id,
      source,
    ]),
  );
}
export function hydrateWordSourceBytes(
  metadata: unknown,
  bytes: Record<string, Uint8Array>,
): DocumentSources {
  if (metadata === undefined) return {};
  if (!isObject(metadata)) throw new Error("Invalid document source metadata.");
  return validateDocumentSources(
    Object.fromEntries(
      Object.entries(metadata).map(([id, source]) => {
        if (!isObject(source))
          throw new Error("Invalid document source metadata.");
        return [id, { ...source, bytes: bytes[id] }];
      }),
    ),
  );
}
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
