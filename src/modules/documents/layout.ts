import type { Editor, TLShapeId } from "tldraw";
import { validateDocument, walkBlocks } from "./model.ts";
import type { DocumentBlock, DocumentModel } from "./model.ts";
import type { DocumentSources } from "./sources.ts";

export type MeasuredWordBlock = {
  id: string;
  height: number;
  before?: number;
  after?: number;
};
export type WordAnchor = {
  id: string;
  blockId: string;
  dx: number;
  dy: number;
  width: number;
  height: number;
  previousBlockHeight: number;
};
export type WordPlacement = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type WordLayout = {
  blocks: WordPlacement[];
  annotations: (WordAnchor & { x: number; y: number })[];
  detached: string[];
  width: number;
  height: number;
};
const finite = (value: number, label: string, low: number, high: number) => {
  if (!Number.isFinite(value) || value < low || value > high)
    throw new Error(`Word layout ${label} exceeds its finite limit.`);
};

/** World-unit layout. Bounds account for explanations before any later reveal. */
export function computeWordLayout(
  blocks: MeasuredWordBlock[],
  anchors: WordAnchor[],
  width = 800,
): WordLayout {
  finite(width, "width", 240, 2400);
  if (
    blocks.length > 2000 ||
    new Set(blocks.map((b) => b.id)).size !== blocks.length
  )
    throw new Error("Word layout block limit or duplicate identity.");
  const ids = new Set(blocks.map((b) => b.id));
  const detached = anchors.filter((a) => !ids.has(a.blockId)).map((a) => a.id);
  const result: WordLayout = {
    blocks: [],
    annotations: [],
    detached,
    width: width + 96,
    height: 96,
  };
  let y = 48;
  for (const b of blocks) {
    finite(b.height, "height", 1, 20000);
    const before = b.before ?? 0,
      after = b.after ?? 0;
    finite(before, "spacing", 0, 1200);
    finite(after, "spacing", 0, 1200);
    y += before;
    result.blocks.push({ id: b.id, x: 48, y, width, height: b.height });
    let extent = b.height;
    for (const a of anchors.filter((a) => a.blockId === b.id)) {
      for (const v of [a.dx, a.dy, a.width, a.height, a.previousBlockHeight])
        finite(v, "annotation", -1_000_000, 1_000_000);
      const dy =
        a.dy >= a.previousBlockHeight
          ? a.dy + b.height - a.previousBlockHeight
          : a.dy;
      result.annotations.push({ ...a, dy, x: 48 + a.dx, y: y + dy });
      extent = Math.max(extent, dy + a.height);
    }
    y += extent + 24 + after;
    finite(y, "page height", 0, 99952);
  }
  result.height = Math.max(160, y + 24);
  return result;
}

type AnnotationInput = {
  id: string;
  parentId: string;
  x: number;
  y: number;
  bounds: { x: number; y: number; w: number; h: number };
  meta: Record<string, unknown>;
};
/** Only page-root annotations move: grouped descendants follow their root once. */
export function collectWordAnchors(
  documentId: string,
  pageId: string,
  blocks: WordPlacement[],
  shapes: AnnotationInput[],
  preferredBlockId?: string,
): WordAnchor[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return shapes
    .filter((s) => s.parentId === pageId && !s.meta.wordDetached)
    .flatMap((shape) => {
      const stored = shape.meta.wordAnchor as
        { documentId?: string; blockId?: string } | undefined;
      let block =
        stored?.documentId === documentId && stored.blockId
          ? byId.get(stored.blockId)
          : undefined;
      if (stored?.documentId === documentId && stored.blockId && !block) {
        return [
          {
            id: shape.id,
            blockId: stored.blockId,
            dx: shape.x,
            dy: shape.y,
            width: shape.bounds.w,
            height: shape.bounds.h,
            previousBlockHeight: 0,
          },
        ];
      }
      if (!block && preferredBlockId) block = byId.get(preferredBlockId);
      if (!block)
        block =
          [...blocks].reverse().find((b) => b.y <= shape.bounds.y) ?? blocks[0];
      if (!block) return [];
      return [
        {
          id: shape.id,
          blockId: block.id,
          dx: shape.x - block.x,
          dy: shape.y - block.y,
          width: shape.bounds.w,
          height: Math.max(
            shape.bounds.h,
            shape.bounds.y + shape.bounds.h - shape.y,
          ),
          previousBlockHeight: block.height,
        },
      ];
    });
}

/** Header/footer blocks appear once per semantic section; this is not Word pagination. */
export function orderedTeachingBlocks(model: DocumentModel): DocumentBlock[] {
  if (!model.sections.length) return model.blocks;
  const out: DocumentBlock[] = [],
    emitted = new Set<string>();
  const push = (items: DocumentBlock[]) => {
    for (const b of items)
      if (!emitted.has(b.id)) {
        emitted.add(b.id);
        out.push(b);
      }
  };
  let section = 0;
  push(model.sections[0].header);
  for (const block of model.blocks) {
    push([block]);
    if (model.sections[section]?.afterBlockId === block.id) {
      push(model.sections[section].footer);
      section++;
      if (model.sections[section]) push(model.sections[section].header);
    }
  }
  for (; section < model.sections.length; section++) {
    push(model.sections[section].header);
    push(model.sections[section].footer);
  }
  return out;
}

function abort(signal: AbortSignal) {
  if (signal.aborted)
    throw new DOMException("Word compilation cancelled.", "AbortError");
}
function wait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  abort(signal);
  return new Promise((resolve, reject) => {
    const cancelled = () =>
      reject(new DOMException("Word compilation cancelled.", "AbortError"));
    signal.addEventListener("abort", cancelled, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", cancelled);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", cancelled);
        reject(e);
      },
    );
  });
}

export async function measureWordBlocks(
  model: DocumentModel,
  sources: DocumentSources,
  width: number,
  signal: AbortSignal,
): Promise<MeasuredWordBlock[]> {
  abort(signal);
  if (
    walkBlocks(model).some(
      (block) =>
        block.kind === "paragraph" &&
        block.inlines.some(
          (inline) =>
            inline.kind === "equation" && inline.status === "editable",
        ),
    )
  )
    await wait(
      import("./math-loader.ts").then((module) => module.loadWordMath()),
      signal,
    );
  const [{ createElement }, { renderToStaticMarkup }, { DocumentBlockView }] =
    await Promise.all([
      import("react"),
      import("react-dom/server"),
      import("./render.tsx"),
    ]);
  abort(signal);
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  Object.assign(host.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: width + "px",
    fontFamily: "Arial, sans-serif",
    fontSize: "24px",
    lineHeight: "1.4",
    visibility: "hidden",
    pointerEvents: "none",
  });
  document.body.append(host);
  try {
    await wait(document.fonts.ready, signal);
    const result: MeasuredWordBlock[] = [];
    const blocks = orderedTeachingBlocks(model);
    for (let i = 0; i < blocks.length; i++) {
      abort(signal);
      const b = blocks[i];
      // Markup is produced solely by the typed semantic React renderer, never imported HTML.
      host.innerHTML = renderToStaticMarkup(
        createElement(DocumentBlockView, {
          block: b,
          document: model,
          sources,
        }),
      );
      host.getBoundingClientRect();
      await wait(document.fonts.ready, signal);
      await wait(
        Promise.all(
          [...host.querySelectorAll("img")].map((image) => image.decode()),
        ),
        signal,
      );
      const height = Math.ceil(
        host.firstElementChild?.getBoundingClientRect().height ?? 0,
      );
      if (height < 1)
        throw new Error(`Word block ${b.id} could not be measured.`);
      result.push({
        id: b.id,
        height,
        before: b.format.before,
        after: b.format.after,
      });
      if (i % 8 === 7)
        await wait(
          new Promise<void>((resolve) => setTimeout(resolve, 0)),
          signal,
        );
    }
    return result;
  } finally {
    host.replaceChildren();
    host.remove();
  }
}

/** Validate/measure before one native history transaction; never changes immutable sources. */
export async function compileDocument(
  editor: Editor,
  input: DocumentModel,
  sources: DocumentSources,
  options: {
    mode: "append" | "recompile";
    allowDetach: boolean;
    width?: number;
  },
  signal: AbortSignal,
): Promise<{ pageId: string; detachedAnnotations: number }> {
  const model = structuredClone(validateDocument(input, sources));
  if (!model.blocks.length)
    throw new Error("Add document blocks before compilation.");
  if (editor.getIsReadonly()) throw new Error("This surface is read-only.");
  if (options.mode === "append" && editor.getPages().length >= 200)
    throw new Error(
      "The lesson already contains 200 pages. Remove a page before compiling another.",
    );
  const page = editor.getCurrentPage(),
    beforeModel = page.meta.word as DocumentModel | undefined;
  if (options.mode === "recompile" && beforeModel?.id !== model.id)
    throw new Error("Recompile needs the matching compiled teaching page.");
  const captured = editor.store.serialize("document"),
    pageId = page.id;
  const width = options.width ?? 800;
  finite(width, "width", 240, 2400);
  const measured = await measureWordBlocks(model, sources, width, signal);
  abort(signal);
  if (
    editor.getCurrentPageId() !== pageId ||
    JSON.stringify(editor.store.serialize("document")) !==
      JSON.stringify(captured)
  )
    throw new Error(
      "The lesson changed during compilation. Review and compile again.",
    );
  const existing =
    options.mode === "recompile"
      ? editor.getCurrentPageShapes().filter((s) => s.type === "word-block")
      : [];
  if (
    editor.store.query.ids("shape").get().size -
      existing.length +
      measured.length >
    20000
  )
    throw new Error(
      "Compilation exceeds the 20,000 object lesson limit. Keep the draft and reduce content.",
    );
  const oldBlocks: WordPlacement[] = existing.map((s) => ({
    id: String((s.props as unknown as { blockId: string }).blockId),
    x: s.x,
    y: s.y,
    width: Number((s.props as unknown as { w: number }).w),
    height: Number((s.props as unknown as { h: number }).h),
  }));
  const roots =
    options.mode === "recompile"
      ? editor
          .getCurrentPageShapes()
          .filter((s) => s.type !== "word-block")
          .map((s) => {
            const bounds = editor.getShapePageBounds(s);
            return {
              id: s.id,
              parentId: s.parentId,
              x: s.x,
              y: s.y,
              bounds: bounds ?? { x: s.x, y: s.y, w: 0, h: 0 },
              meta: s.meta as Record<string, unknown>,
            };
          })
      : [];
  const anchors = collectWordAnchors(model.id, pageId, oldBlocks, roots);
  const layout = computeWordLayout(measured, anchors, width);
  if (layout.detached.length && !options.allowDetach)
    throw new Error(
      `${layout.detached.length} annotations belong to removed blocks. Confirm retaining them as detached annotations before recompiling.`,
    );
  const { createShapeId, PageRecordType } = await import("tldraw");
  abort(signal);
  const nextPageId =
    options.mode === "append" ? PageRecordType.createId() : pageId;
  const byBlock = new Map(
    existing.map((s) => [
      String((s.props as unknown as { blockId: string }).blockId),
      s,
    ]),
  );
  const shapes = layout.blocks.map((b) => ({
    id: byBlock.get(b.id)?.id ?? createShapeId(),
    type: "word-block" as const,
    parentId: nextPageId,
    x: b.x,
    y: b.y,
    isLocked: true,
    props: { documentId: model.id, blockId: b.id, w: b.width, h: b.height },
  }));
  const anchorOwners = new Map(
    anchors.map((anchor) => [anchor.id, anchor.blockId]),
  );
  const owner = (id: TLShapeId) => {
    let shape = editor.getShape(id);
    for (
      let depth = 0;
      shape && shape.parentId !== pageId && depth < 32;
      depth++
    )
      shape = editor.getShape(shape.parentId as TLShapeId);
    return shape ? anchorOwners.get(shape.id) : undefined;
  };
  const crossing = roots.some((s) =>
    editor.getBindingsInvolvingShape(s.id as TLShapeId).some((binding) => {
      const from = owner(binding.fromId),
        to = owner(binding.toId);
      return !from || !to || from !== to;
    }),
  );
  if (crossing)
    throw new Error(
      "Detach arrow bindings to document content before reflow; the prior lesson is unchanged.",
    );
  editor.markHistoryStoppingPoint(
    options.mode === "append" ? "Compile Word lesson" : "Recompile Word lesson",
  );
  editor.run(
    () => {
      if (options.mode === "append")
        editor.createPage({
          id: nextPageId,
          name: model.title,
          meta: {
            paper: {
              kind: "blank",
              color: "white",
              width: layout.width,
              height: layout.height,
            },
            word: model as never,
          },
        });
      else
        editor.updatePage({
          id: nextPageId,
          meta: {
            ...page.meta,
            paper: {
              kind: "blank",
              color: "white",
              width: layout.width,
              height: layout.height,
            },
            word: model as never,
          },
        });
      editor.setCurrentPage(nextPageId);
      const keep = new Set(shapes.map((s) => s.id));
      editor.deleteShapes(
        existing.filter((s) => !keep.has(s.id)).map((s) => s.id),
      );
      editor.createShapes(shapes.filter((s) => !editor.getShape(s.id)));
      editor.updateShapes(shapes.filter((s) => !!editor.getShape(s.id)));
      editor.updateShapes(
        layout.annotations.map((a) => {
          const original = editor.getShape(a.id as TLShapeId)!;
          return {
            id: original.id,
            type: original.type,
            x: a.x,
            y: a.y,
            meta: {
              ...original.meta,
              wordAnchor: {
                documentId: model.id,
                blockId: a.blockId,
                dx: a.dx,
                dy: a.dy,
              },
            },
          };
        }),
      );
      editor.store.put(
        layout.detached.map((id) => {
          const original = editor.getShape(id as TLShapeId)!;
          const meta = { ...original.meta };
          delete meta.wordAnchor;
          return {
            ...original,
            meta: { ...meta, wordDetached: true },
          };
        }),
      );
    },
    { ignoreShapeLock: true },
  );
  const first = shapes[0];
  if (first)
    editor.setCamera({
      x: 24 - first.x,
      y: 24 - first.y,
      z: Math.min(1, (editor.getViewportScreenBounds().w - 48) / width),
    });
  return { pageId: nextPageId, detachedAnnotations: layout.detached.length };
}
