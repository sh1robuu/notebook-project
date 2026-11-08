import { getIndexAbove, PageRecordType } from "tldraw";
import type { TLPage } from "tldraw";
import type { Lesson } from "../workspace/model.ts";
import { validateLesson } from "../workspace/model.ts";
import { MAX_PAGES, WorkspaceError } from "../workspace/contracts.ts";
import { validatePaper } from "../workspace/lesson-view.ts";
import type { PptxImportResult } from "./model.ts";
import { referencedPptxSources } from "./sources.ts";
import type { PptxDecks } from "./sources.ts";

/** Prepare a complete replacement snapshot; LessonSession owns the durable commit. */
export function importedSlideLesson(
  lesson: Lesson,
  imported: PptxImportResult,
  mode: "append" | "replace",
  viewport: { w: number; h: number },
): Lesson {
  const previous = Object.values(lesson.document.store)
    .filter((record): record is TLPage => record.typeName === "page")
    .sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  const append = mode === "append";
  const pptxDecks: PptxDecks = {};
  if (append)
    for (const page of previous) {
      const paper = validatePaper(page.meta.paper);
      if (paper.kind === "pptx")
        pptxDecks[paper.sourceId!] = lesson.pptxDecks[paper.sourceId!];
    }
  // Reopening the same source in one lesson shares the original and scene,
  // while each appended slide receives its own editable annotation page.
  const alreadyImported = pptxDecks[imported.document.sourceId];
  const deck = alreadyImported ?? imported.document;
  if (deck.slides.length + (append ? previous.length : 0) > MAX_PAGES)
    throw new WorkspaceError(
      "limit",
      "This import would exceed 200 main pages.",
    );
  pptxDecks[deck.sourceId] = deck;
  const candidates = alreadyImported
    ? lesson.pptxSources
    : { ...lesson.pptxSources, ...imported.sources };
  const pptxSources = Object.fromEntries(
    [...referencedPptxSources(pptxDecks)].map((id) => [id, candidates[id]]),
  );
  const scratchImages = new Set(
    Object.values(lesson.scratchpad.document.store).flatMap((record) =>
      record.typeName === "shape" &&
      record.type === "image" &&
      record.props.assetId
        ? [record.props.assetId]
        : [],
    ),
  );
  const store: Lesson["document"]["store"] = append
    ? { ...lesson.document.store }
    : Object.fromEntries(
        Object.entries(lesson.document.store).filter(
          ([, record]) =>
            record.typeName === "document" ||
            record.typeName === "user" ||
            (record.typeName === "asset" && scratchImages.has(record.id)),
        ),
      );
  const cameras = append ? { ...lesson.view.mainCameras } : {};
  const z = Math.max(
    0.25,
    Math.min(
      1,
      (viewport.w - 64) / deck.width,
      (viewport.h - 64) / deck.height,
    ),
  );
  const camera = {
    x: (viewport.w / z - deck.width) / 2,
    y: (viewport.h / z - deck.height) / 2,
    z,
  };
  let index = append ? previous.at(-1)?.index : undefined;
  let first = "";
  for (const [i, slide] of deck.slides.entries()) {
    index = getIndexAbove(index);
    const page = PageRecordType.create({
      id: PageRecordType.createId(),
      name: (
        slide.title || `${deck.name.replace(/\.pptx$/i, "")} · ${i + 1}`
      ).slice(0, 120),
      index,
      meta: {
        paper: {
          kind: "pptx",
          color: "white",
          width: deck.width,
          height: deck.height,
          sourceId: deck.sourceId,
          slideId: slide.id,
        },
      },
    });
    store[page.id] = page;
    cameras[page.id] = camera;
    if (!first) first = page.id;
  }
  return validateLesson({
    ...lesson,
    version: 6,
    document: { ...lesson.document, store },
    pageId: first,
    pdfSources: append ? lesson.pdfSources : {},
    pptxDecks,
    pptxSources,
    view: { ...lesson.view, mainCameras: cameras },
  });
}
