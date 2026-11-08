import {
  MAX_IMAGE_ASSETS,
  MAX_TOTAL_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_PIXELS,
  readImageHeader,
} from "../media/image-format.ts";
import { documentDigest } from "../documents/sources.ts";
import {
  MAX_ARCHIVE_BYTES,
  MAX_PAGES,
  object,
  WorkspaceError,
} from "../workspace/contracts.ts";
import { MAX_PPTX_BYTES, PPTX_MIME, validateSlideDocument } from "./model.ts";
import type { PptxSources, SlideDocument, SlideElement } from "./model.ts";

export type PptxDecks = Record<string, SlideDocument>;
export const pptxSourceId = /^pptx:[a-f0-9]{64}$/;
export const pptxImageId = /^pptx-image:[a-f0-9]{64}$/;

export function validatePptxSources(input: unknown): PptxSources {
  if (input === undefined) return {};
  if (
    !object(input) ||
    Object.keys(input).length > MAX_PAGES + MAX_IMAGE_ASSETS
  )
    throw new WorkspaceError("source", "Invalid PowerPoint source pool.");
  const sources: PptxSources = {};
  let deckCount = 0,
    total = 0,
    imageCount = 0,
    imageBytes = 0,
    imagePixels = 0;
  for (const [id, value] of Object.entries(input)) {
    const original = pptxSourceId.test(id),
      sha256 = id.slice(id.indexOf(":") + 1);
    if (
      (!original && !pptxImageId.test(id)) ||
      !object(value) ||
      value.sourceVersion !== 1 ||
      value.id !== id ||
      value.sha256 !== sha256 ||
      typeof value.name !== "string" ||
      value.name.length > 180 ||
      /[\u0000-\u001f]/.test(value.name) ||
      typeof value.mime !== "string" ||
      !(value.bytes instanceof Uint8Array) ||
      value.size !== value.bytes.length ||
      value.bytes.length < 1 ||
      value.bytes.length > MAX_PPTX_BYTES
    )
      throw new WorkspaceError(
        "source",
        "Missing or invalid PowerPoint source.",
      );
    const bytes = value.bytes;
    total += bytes.length;
    if (original) {
      deckCount++;
      if (
        value.mime !== PPTX_MIME ||
        ![80, 75, 3, 4].every((byte, index) => bytes[index] === byte)
      )
        throw new WorkspaceError(
          "source",
          "Original PowerPoint source is not a PPTX ZIP.",
        );
    } else {
      const header = readImageHeader(bytes);
      if (header.mime !== value.mime)
        throw new WorkspaceError(
          "source",
          "PowerPoint image content and MIME type differ.",
        );
      imageCount++;
      imageBytes += bytes.length;
      imagePixels += header.width * header.height;
    }
    sources[id] = {
      sourceVersion: 1,
      id,
      sha256,
      name: value.name,
      mime: value.mime,
      size: bytes.length,
      bytes,
    };
  }
  if (
    total > MAX_ARCHIVE_BYTES ||
    deckCount > MAX_PAGES ||
    imageCount > MAX_IMAGE_ASSETS ||
    imageBytes > MAX_TOTAL_IMAGE_BYTES ||
    imagePixels > MAX_TOTAL_IMAGE_PIXELS
  )
    throw new WorkspaceError(
      "limit",
      "PowerPoint sources exceed the lesson asset budget.",
    );
  return sources;
}

export async function verifyPptxSources(sources: PptxSources): Promise<void> {
  validatePptxSources(sources);
  for (const source of Object.values(sources))
    if ((await documentDigest(source.bytes)) !== source.sha256)
      throw new WorkspaceError(
        "integrity",
        "PowerPoint source checksum differs. Existing work has been kept.",
      );
}

function visitImages(elements: SlideElement[], ids: Set<string>) {
  for (const element of elements) {
    if (element.kind === "image") ids.add(element.assetId);
    if (element.kind === "group") visitImages(element.children, ids);
  }
}

export function referencedPptxSources(decks: PptxDecks): Set<string> {
  const ids = new Set<string>();
  for (const deck of Object.values(decks)) {
    ids.add(deck.sourceId);
    for (const slide of deck.slides) visitImages(slide.elements, ids);
  }
  return ids;
}

export function validatePptxDecks(
  input: unknown,
  sources: PptxSources,
): PptxDecks {
  if (input === undefined && !Object.keys(sources).length) return {};
  if (!object(input) || Object.keys(input).length > MAX_PAGES)
    throw new WorkspaceError("source", "Invalid PowerPoint slide documents.");
  const decks: PptxDecks = {};
  let slideCount = 0;
  for (const [id, value] of Object.entries(input)) {
    const deck = validateSlideDocument(value, sources);
    if (deck.sourceId !== id || !pptxSourceId.test(id) || !sources[id])
      throw new WorkspaceError(
        "source",
        "PowerPoint slide document is missing its original source.",
      );
    slideCount += deck.slides.length;
    if (slideCount > MAX_PAGES)
      throw new WorkspaceError(
        "limit",
        "PowerPoint documents exceed the 200-source-slide lesson limit.",
      );
    decks[id] = deck;
  }
  const referenced = referencedPptxSources(decks);
  if (
    Object.keys(sources).length !== referenced.size ||
    [...referenced].some((id) => !sources[id])
  )
    throw new WorkspaceError(
      "source",
      "PowerPoint documents and retained assets differ.",
    );
  return decks;
}

export function hydratePptxSources(
  metadata: unknown,
  bytes: Record<string, Uint8Array>,
): unknown {
  if (metadata === undefined) return undefined;
  if (!object(metadata))
    throw new WorkspaceError("source", "Invalid PowerPoint source manifest.");
  return Object.fromEntries(
    Object.entries(metadata).map(([id, value]) => [
      id,
      { ...(object(value) ? value : {}), bytes: bytes[id] },
    ]),
  );
}
