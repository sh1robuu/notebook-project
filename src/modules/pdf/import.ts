import { PageRecordType, getIndexAbove } from "tldraw";
import type { TLPage, IndexKey, TLRecord } from "tldraw";
import type { Lesson } from "../workspace/model.ts";
import { validateLesson } from "../workspace/model.ts";
import { MAX_PAGES, WorkspaceError } from "../workspace/contracts.ts";
import type { PdfSource } from "./sources.ts";
import { validatePaper } from "../workspace/lesson-view.ts";
/** Build from the latest captured lesson at commit, never from the staging-time copy. */
export function importedLesson(
  lesson: Lesson,
  source: PdfSource,
  mode: "append" | "replace",
  viewport: { w: number; h: number },
): Lesson {
  const previous = Object.values(lesson.document.store)
    .filter((r): r is TLPage => r.typeName === "page")
    .sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  if (
    source.pages.length + (mode === "append" ? previous.length : 0) >
    MAX_PAGES
  )
    throw new WorkspaceError(
      "limit",
      "This import would exceed 200 main pages.",
    );
  const store =
    mode === "append"
      ? { ...lesson.document.store }
      : (Object.fromEntries(
          Object.entries(lesson.document.store).filter(([, r]) =>
            ["document", "asset", "user"].includes(r.typeName),
          ),
        ) as Lesson["document"]["store"]);
  let index = (mode === "append" ? previous.at(-1)?.index : undefined) as
    IndexKey | undefined;
  const cameras = mode === "append" ? { ...lesson.view.mainCameras } : {};
  let first = "";
  source.pages.forEach((info, pageIndex) => {
    index = getIndexAbove(index);
    const p = PageRecordType.create({
      id: PageRecordType.createId(),
      name: source.name.replace(/\.pdf$/i, "") + " · " + (pageIndex + 1),
      index,
      meta: {
        paper: {
          kind: "pdf",
          color: "white",
          width: info.width,
          height: info.height,
          sourceId: source.id,
          pageIndex,
        },
      },
    });
    store[p.id] = p as TLRecord;
    if (!first) first = p.id;
    const z = Math.max(
      0.25,
      Math.min(
        1,
        (viewport.w - 64) / info.width,
        (viewport.h - 64) / info.height,
      ),
    );
    cameras[p.id] = { x: 32 / z, y: 32 / z, z };
  });
  // This atomic import starts fresh native histories. Old unreachable sources
  // remain recoverable in Previous lesson, rather than leaking into this archive.
  const usedImages = new Set<string>();
  for (const record of [
    ...Object.values(store),
    ...Object.values(lesson.scratchpad.document.store),
  ])
    if (
      record.typeName === "shape" &&
      record.type === "image" &&
      record.props.assetId
    )
      usedImages.add(record.props.assetId);
  for (const record of Object.values(store))
    if (record.typeName === "asset" && !usedImages.has(record.id))
      delete store[record.id];
  const candidates = { ...lesson.pdfSources, [source.id]: source },
    usedSources = new Set<string>();
  for (const record of Object.values(store))
    if (record.typeName === "page") {
      const paper = validatePaper(record.meta.paper);
      if (paper.kind === "pdf") usedSources.add(paper.sourceId!);
    }
  return validateLesson({
    ...lesson,
    document: { ...lesson.document, store },
    pageId: first,
    pdfSources: Object.fromEntries(
      Object.entries(candidates).filter(([id]) => usedSources.has(id)),
    ),
    view: { ...lesson.view, mainCameras: cameras },
  });
}
