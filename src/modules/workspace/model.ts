import type { TLStoreSnapshot } from "tldraw";
import { DocumentRecordType, PageRecordType } from "@tldraw/tlschema";
import { lessonSchema } from "./schema.ts";
import { validateDrawing } from "./drawing-validation.ts";
import type { DrawingBudget } from "./drawing-validation.ts";
import { object, WorkspaceError, SDK_VERSION } from "./contracts.ts";
import { defaultView, validateView } from "./lesson-view.ts";
import type { LessonView, SurfaceId } from "./lesson-view.ts";
import { validateSources } from "../pdf/sources.ts";
import type { PdfSources } from "../pdf/sources.ts";
import { validatePaper } from "./lesson-view.ts";
import { validateDocument } from "../documents/model.ts";
import type { DocumentModel } from "../documents/model.ts";
import { validateDocumentSources } from "../documents/sources.ts";
import type { DocumentSources } from "../documents/sources.ts";
import { readImageHeader } from "../media/image-format.ts";
import { validatePptxDecks, validatePptxSources } from "../pptx/sources.ts";
import type { PptxDecks } from "../pptx/sources.ts";
import type { PptxSources } from "../pptx/model.ts";
import {
  referencedInteractiveSources,
  validateInteractiveSources,
} from "../interactive/sources.ts";
import type { InteractiveSources } from "../interactive/sources.ts";
export {
  SDK_VERSION,
  MAX_ARCHIVE_BYTES,
  MAX_SHAPES,
  MAX_PAGES,
  MAX_WORLD_COORDINATE,
  WorkspaceError,
  object,
} from "./contracts.ts";
export type Lesson = {
  version: 5 | 6;
  sdkVersion: string;
  id: string;
  title: string;
  surfaceId: "main";
  pageId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  document: TLStoreSnapshot;
  scratchpad: { pageId: string; document: TLStoreSnapshot };
  view: LessonView;
  pdfSources: PdfSources;
  wordSources: DocumentSources;
  wordDraft: DocumentModel | null;
  pptxDecks: PptxDecks;
  pptxSources: PptxSources;
  interactiveSources?: InteractiveSources;
};
export function blankDrawing(pageId = "page:page"): TLStoreSnapshot {
  const d = DocumentRecordType.create({
      id: DocumentRecordType.createId("document"),
    }),
    p = PageRecordType.create({
      id: pageId as never,
      name: "Page 1",
      index: "a1" as never,
    });
  return { schema: lessonSchema.serialize(), store: { [d.id]: d, [p.id]: p } };
}
export function validateLesson(value: unknown): Lesson {
  if (!object(value) || ![1, 2, 3, 4, 5, 6].includes(value.version as number))
    throw new WorkspaceError(
      "version",
      "This lesson uses an unsupported format version.",
    );
  if (value.sdkVersion !== SDK_VERSION)
    throw new WorkspaceError(
      "version",
      "This lesson needs a different editor version. Keep the original file.",
    );
  if (value.surfaceId !== "main")
    throw new WorkspaceError("surface", "Unsupported lesson surface identity.");
  if (typeof value.id !== "string" || value.id.length > 100 || !value.id)
    throw new WorkspaceError("invalid", "Invalid lesson identity.");
  if (typeof value.title !== "string" || value.title.length > 120)
    throw new WorkspaceError(
      "invalid",
      "Lesson title must be 120 characters or fewer.",
    );
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0)
    throw new WorkspaceError("invalid", "Invalid lesson revision.");
  for (const key of ["createdAt", "updatedAt"])
    if (
      typeof value[key] !== "string" ||
      !Number.isFinite(Date.parse(value[key] as string))
    )
      throw new WorkspaceError("invalid", "Invalid lesson date.");

  const budget: DrawingBudget = {
    shapes: 0,
    pathChars: 0,
    points: 0,
    expandedPoints: 0,
  };
  const main = validateDrawing(
    {
      document: value.document as TLStoreSnapshot,
      pageId: String(value.pageId),
    },
    { multiplePages: Number(value.version) >= 3, budget },
  );
  let scratchInput: unknown = value.scratchpad;
  if (Number(value.version) < 3) {
    if (
      object(scratchInput) &&
      object(scratchInput.document) &&
      object(scratchInput.document.store) &&
      Object.values(scratchInput.document.store).some(
        (r) =>
          object(r) &&
          ["shape", "binding", "asset"].includes(String(r.typeName)),
      )
    )
      throw new WorkspaceError(
        "version",
        "A legacy version label contains newer scratchpad content. Keep the original lesson.",
      );
    let pageId = "page:scratchpad",
      i = 0;
    while (main.pageIds.has(pageId)) pageId = "page:scratchpad-" + ++i;
    scratchInput = { pageId, document: blankDrawing(pageId) };
  }
  if (
    !object(scratchInput) ||
    typeof scratchInput.pageId !== "string" ||
    !object(scratchInput.document) ||
    !object(scratchInput.document.store) ||
    main.pageIds.has(scratchInput.pageId)
  )
    throw new WorkspaceError(
      "surface",
      "Invalid independent scratchpad surface.",
    );
  const scratchDoc = scratchInput.document as unknown as TLStoreSnapshot;
  if (Object.values(scratchDoc.store).some((r) => r.typeName === "asset"))
    throw new WorkspaceError(
      "asset",
      "Scratchpad source assets must use the shared lesson pool.",
    );
  const assets = Object.fromEntries(
    Object.entries(main.document.store).filter(
      ([, r]) => r.typeName === "asset",
    ),
  );
  const scratch = validateDrawing(
    {
      document: { ...scratchDoc, store: { ...scratchDoc.store, ...assets } },
      pageId: scratchInput.pageId,
    },
    { budget, assetsValidated: true },
  );
  const ids = new Set(
    Object.values(main.document.store)
      .filter((r) => r.typeName === "shape" || r.typeName === "binding")
      .map((r) => String(r.id)),
  );
  if (
    Object.values(scratch.document.store).some(
      (r) =>
        (r.typeName === "shape" || r.typeName === "binding") && ids.has(r.id),
    )
  )
    throw new WorkspaceError(
      "identity",
      "Duplicate object identity across independent surfaces.",
    );
  const scratchStore = Object.fromEntries(
    Object.entries(scratch.document.store).filter(
      ([, r]) => r.typeName !== "asset",
    ),
  );
  const view =
    Number(value.version) >= 3
      ? validateView(value.view, main.pageIds)
      : defaultView();
  const pdfSources = validateSources(value.pdfSources);
  const wordSources = validateDocumentSources(
    Number(value.version) >= 5 ? (value.wordSources ?? {}) : {},
  );
  const wordDraft =
    Number(value.version) >= 5 && value.wordDraft != null
      ? validateDocument(value.wordDraft, wordSources)
      : null;
  if (
    value.version !== 6 &&
    [value.pptxDecks, value.pptxSources].some(
      (pool) =>
        pool !== undefined && (!object(pool) || Object.keys(pool).length),
    )
  )
    throw new WorkspaceError(
      "version",
      "A legacy lesson contains newer PowerPoint content.",
    );
  const pptxSources = validatePptxSources(value.pptxSources);
  const pptxDecks = validatePptxDecks(value.pptxDecks, pptxSources);
  const interactiveSources = validateInteractiveSources(
    value.interactiveSources,
  );
  referencedInteractiveSources(
    [main.document, scratch.document],
    interactiveSources,
  );
  if (value.version !== 6 && Object.keys(interactiveSources).length)
    throw new WorkspaceError(
      "version",
      "A legacy lesson contains newer interactive materials.",
    );
  let imageBytes = 0,
    imagePixels = 0,
    imageCount = 0;
  for (const source of Object.values(wordSources))
    if (source.mime === "image/png" || source.mime === "image/jpeg") {
      const header = readImageHeader(source.bytes);
      imageBytes += source.size;
      imagePixels += header.width * header.height;
      imageCount++;
    }
  for (const asset of Object.values(main.document.store))
    if (asset.typeName === "asset" && asset.type === "image") {
      // Drawing validation already checked the complete base64 source and dimensions.
      const payload = asset.props.src!.slice(asset.props.src!.indexOf(",") + 1);
      imageBytes +=
        payload.length * 0.75 -
        (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
      imagePixels += asset.props.w * asset.props.h;
      imageCount++;
    }
  if (imageBytes > 50_000_000 || imagePixels > 32_000_000 || imageCount > 512)
    throw new WorkspaceError(
      "limit",
      "Native and Word images exceed the shared 50 MB /32 megapixel /512-image budget.",
    );
  if (
    [
      ...Object.values(pdfSources),
      ...Object.values(wordSources),
      ...Object.values(pptxSources),
      ...Object.values(interactiveSources),
    ].reduce((sum, source) => sum + source.size, 0) > 250_000_000
  )
    throw new WorkspaceError(
      "limit",
      "Original document sources exceed the 250 MB lesson limit.",
    );
  const wordModels = new Map<string, DocumentModel>();
  if (
    Object.values(scratchStore).some(
      (record) =>
        (record.typeName === "page" && record.meta.word !== undefined) ||
        (record.typeName === "shape" &&
          (record.type === "word-block" ||
            record.meta.wordAnchor !== undefined)),
    )
  )
    throw new WorkspaceError(
      "surface",
      "Structured Word content belongs to the main surface. Scratchpad work is kept independent.",
    );
  for (const r of Object.values(main.document.store))
    if (r.typeName === "page") {
      if (r.meta.word !== undefined) {
        if (Number(value.version) < 5)
          throw new WorkspaceError(
            "version",
            "A legacy lesson contains newer Word content.",
          );
        const model = validateDocument(r.meta.word, wordSources);
        wordModels.set(r.id, model);
        const allowed = [
          ...model.blocks,
          ...model.sections.flatMap((section) => [
            ...section.header,
            ...section.footer,
          ]),
        ];
        const refs = Object.values(main.document.store).filter(
          (shape) =>
            shape.typeName === "shape" &&
            shape.type === "word-block" &&
            shape.parentId === r.id,
        );
        if (
          refs.length !== allowed.length ||
          new Set(
            refs.map((shape) =>
              shape.typeName === "shape" && shape.type === "word-block"
                ? shape.props.blockId
                : "",
            ),
          ).size !== refs.length
        )
          throw new WorkspaceError(
            "source",
            "Structured Word blocks and their native references differ.",
          );
        for (const shape of refs)
          if (
            shape.typeName === "shape" &&
            shape.type === "word-block" &&
            (shape.props.documentId !== model.id ||
              !allowed.some((block) => block.id === shape.props.blockId))
          )
            throw new WorkspaceError(
              "source",
              "A Word block references another semantic document.",
            );
      }
      const paper = validatePaper(r.meta.paper);
      if (paper.kind === "pdf") {
        if (Number(value.version) < 4)
          throw new WorkspaceError(
            "version",
            "A legacy lesson contains a newer PDF background.",
          );
        const info = pdfSources[paper.sourceId!]?.pages[paper.pageIndex!];
        if (!info || info.width !== paper.width || info.height !== paper.height)
          throw new WorkspaceError(
            "source",
            "A page references a missing or incompatible PDF source.",
          );
      }
      if (paper.kind === "pptx") {
        if (value.version !== 6)
          throw new WorkspaceError(
            "version",
            "A legacy lesson contains a newer PowerPoint slide.",
          );
        const deck = pptxDecks[paper.sourceId!];
        if (
          !deck ||
          deck.width !== paper.width ||
          deck.height !== paper.height ||
          !deck.slides.some((slide) => slide.id === paper.slideId) ||
          r.meta.word !== undefined
        )
          throw new WorkspaceError(
            "source",
            "A page references a missing or incompatible PowerPoint slide.",
          );
      }
    }
  for (const shape of Object.values(main.document.store)) {
    if (shape.typeName !== "shape") continue;
    const page =
      main.document.store[shape.parentId as keyof typeof main.document.store];
    if (
      shape.type === "word-block" &&
      (page?.typeName !== "page" || !page.meta.word)
    )
      throw new WorkspaceError(
        "source",
        "A Word block has no semantic document.",
      );
    const anchor = shape.meta.wordAnchor;
    if (anchor !== undefined) {
      if (
        !object(anchor) ||
        typeof anchor.documentId !== "string" ||
        typeof anchor.blockId !== "string" ||
        ![anchor.dx, anchor.dy].every(
          (number) =>
            typeof number === "number" &&
            Number.isFinite(number) &&
            Math.abs(number) <= 1_000_000,
        )
      )
        throw new WorkspaceError("source", "Invalid Word annotation anchor.");
      // Only page-root anchors move; descendants inherit their group's transform.
      const word = wordModels.get(shape.parentId);
      const allowed = word
        ? [
            ...word.blocks,
            ...word.sections.flatMap((section) => [
              ...section.header,
              ...section.footer,
            ]),
          ]
        : [];
      if (
        !word ||
        word.id !== anchor.documentId ||
        !allowed.some((block) => block.id === anchor.blockId)
      )
        throw new WorkspaceError(
          "source",
          "A Word annotation anchor has no matching page/block.",
        );
    }
  }
  if (
    Object.values(scratchStore).some(
      (r) =>
        r.typeName === "page" && validatePaper(r.meta.paper).kind !== "blank",
    )
  )
    throw new WorkspaceError(
      "surface",
      "Scratchpad cannot contain an imported document background.",
    );
  return {
    ...value,
    version: value.version === 6 ? 6 : 5,
    document: main.document,
    scratchpad: {
      pageId: scratchInput.pageId,
      document: { ...scratch.document, store: scratchStore },
    },
    view,
    pdfSources,
    wordSources,
    wordDraft,
    pptxDecks,
    pptxSources,
    interactiveSources,
  } as Lesson;
}
export function hydrateSurface(
  lesson: Lesson,
  surface: SurfaceId,
): TLStoreSnapshot {
  if (surface === "main") return lesson.document;
  const assets = Object.fromEntries(
    Object.entries(lesson.document.store).filter(
      ([, r]) => r.typeName === "asset",
    ),
  );
  return {
    ...lesson.scratchpad.document,
    store: { ...lesson.scratchpad.document.store, ...assets },
  };
}
export function makeLesson(
  document: TLStoreSnapshot,
  title = "Untitled lesson",
): Lesson {
  const page = Object.values(document.store).find((r) => r.typeName === "page");
  const now = new Date().toISOString();
  return validateLesson({
    version: 2,
    sdkVersion: SDK_VERSION,
    id: crypto.randomUUID(),
    title,
    surfaceId: "main",
    pageId: page?.id,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    document,
  });
}
export async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
