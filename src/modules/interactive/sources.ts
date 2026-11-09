import type { TLStoreSnapshot } from "tldraw";
import { documentDigest } from "../documents/sources.ts";
import { readInteractivePreview } from "./preview.ts";
import { object, WorkspaceError } from "../workspace/contracts.ts";

export type InteractiveSourceKind = "html" | "geogebra" | "preview";
export type InteractiveSource = {
  version: 1;
  id: string;
  sha256: string;
  kind: InteractiveSourceKind;
  size: number;
  bytes: Uint8Array;
};
export type InteractiveSources = Record<string, InteractiveSource>;
export const interactiveSourceId = /^interactive:[a-f0-9]{64}$/;
export const MAX_INTERACTIVE_SOURCE_BYTES = 41_000_000;
const MAX_SOURCE_COUNT = 128;
const MAX_POOL_BYTES = 100_000_000;
const MAX_PREVIEW_BYTES = 512_000;
const MAX_PREVIEW_PIXELS = 2_000_000;

export function validateInteractiveSources(input: unknown): InteractiveSources {
  if (input === undefined) return {};
  if (!object(input) || Object.keys(input).length > MAX_SOURCE_COUNT)
    throw new WorkspaceError("source", "Invalid interactive source pool.");
  let total = 0;
  const result: InteractiveSources = {};
  for (const [id, source] of Object.entries(input)) {
    if (
      !interactiveSourceId.test(id) ||
      !object(source) ||
      Object.keys(source).length !== 6 ||
      source.version !== 1 ||
      source.id !== id ||
      source.sha256 !== id.slice("interactive:".length) ||
      (source.kind !== "html" &&
        source.kind !== "geogebra" &&
        source.kind !== "preview") ||
      !(source.bytes instanceof Uint8Array) ||
      source.size !== source.bytes.length ||
      source.bytes.length < 1 ||
      source.bytes.length >
        (source.kind === "preview"
          ? MAX_PREVIEW_BYTES
          : MAX_INTERACTIVE_SOURCE_BYTES)
    )
      throw new WorkspaceError("source", "Invalid interactive source.");
    if (source.kind === "preview") {
      const image = readInteractivePreview(source.bytes);
      if (image.width * image.height > MAX_PREVIEW_PIXELS)
        throw new WorkspaceError("limit", "Interactive preview is too large.");
    }
    total += source.bytes.length;
    if (total > MAX_POOL_BYTES)
      throw new WorkspaceError("limit", "Interactive sources exceed 100 MB.");
    result[id] = source as InteractiveSource;
  }
  return result;
}

export async function makeInteractiveSource(
  kind: InteractiveSourceKind,
  input: Uint8Array,
): Promise<InteractiveSource> {
  if (!input.length || input.length > MAX_INTERACTIVE_SOURCE_BYTES)
    throw new WorkspaceError(
      "limit",
      "Interactive source is too large or empty.",
    );
  const bytes = input.slice();
  const sha256 = await documentDigest(bytes);
  const id = `interactive:${sha256}`;
  const source: InteractiveSource = {
    version: 1,
    kind,
    id,
    sha256,
    size: bytes.length,
    bytes,
  };
  return validateInteractiveSources({ [id]: source })[id];
}

export async function verifyInteractiveSources(sources: InteractiveSources) {
  for (const source of Object.values(sources))
    if ((await documentDigest(source.bytes)) !== source.sha256)
      throw new WorkspaceError(
        "integrity",
        "Interactive source checksum differs. Current work is unchanged.",
      );
}

export function hydrateInteractiveSources(
  metadata: unknown,
  bytes: Record<string, Uint8Array>,
): unknown {
  if (!object(metadata)) return metadata;
  return Object.fromEntries(
    Object.entries(metadata).map(([id, meta]) => [
      id,
      { ...(object(meta) ? meta : {}), bytes: bytes[id] },
    ]),
  );
}

/** Used by lesson validation and archive export across both native surfaces. */
export function referencedInteractiveSources(
  drawings: readonly TLStoreSnapshot[],
  sources: InteractiveSources,
): InteractiveSources {
  const used: InteractiveSources = {};
  for (const drawing of drawings)
    for (const shape of Object.values(drawing.store)) {
      if (shape.typeName !== "shape" || shape.type !== "interactive") continue;
      const { sourceId, snapshotId, kind } = shape.props.material;
      const source = sources[sourceId];
      const preview = snapshotId ? sources[snapshotId] : undefined;
      if (source?.kind !== kind || (snapshotId && preview?.kind !== "preview"))
        throw new WorkspaceError(
          "source",
          "Missing or incompatible interactive source.",
        );
      used[source.id] = source;
      if (preview) used[preview.id] = preview;
    }
  return used;
}
