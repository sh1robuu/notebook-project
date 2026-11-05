import { atom, react } from "@tldraw/state";
import type { Editor, TLShape, TLShapeId } from "tldraw";
import type { DocumentModel } from "./model.ts";
import { collectWordAnchors, orderedTeachingBlocks } from "./layout.ts";
import type { WordPlacement } from "./layout.ts";

export type RevealCore = {
  enabled: boolean;
  currentBlockId: string | null;
  phase: "prepared" | "revealing" | "finished" | "editing";
};
export type TeachingState = RevealCore & {
  visibleIds: string[];
  total: number;
  pageId: string;
  documentId: string | null;
};
export type RevealAction =
  "start" | "stop" | "resume" | "next" | "previous" | "all";
/** Deterministic cursor keyed by block identity, independent of authored source. */
export function reduceReveal(
  state: RevealCore,
  ids: string[],
  action: RevealAction,
): RevealCore {
  if (action === "start")
    return { enabled: true, currentBlockId: null, phase: "prepared" };
  if (action === "stop") return { ...state, enabled: false, phase: "editing" };
  if (!ids.length)
    return { enabled: true, currentBlockId: null, phase: "prepared" };
  if (action === "all")
    return { enabled: true, currentBlockId: ids.at(-1)!, phase: "finished" };
  let index = state.currentBlockId ? ids.indexOf(state.currentBlockId) : -1;
  if (action === "resume")
    return {
      enabled: true,
      currentBlockId: index < 0 ? null : ids[index],
      phase:
        index < 0
          ? "prepared"
          : index === ids.length - 1
            ? "finished"
            : "revealing",
    };
  index = Math.max(
    -1,
    Math.min(ids.length - 1, index + (action === "previous" ? -1 : 1)),
  );
  return {
    enabled: true,
    currentBlockId: index < 0 ? null : ids[index],
    phase:
      index < 0
        ? "prepared"
        : index === ids.length - 1
          ? "finished"
          : "revealing",
  };
}

const controllers = new WeakMap<Editor, WordTeachingController>();
export function getWordTeaching(editor: Editor): WordTeachingController {
  let controller = controllers.get(editor);
  if (!controller) {
    controller = new WordTeachingController(editor);
    controllers.set(editor, controller);
  }
  return controller;
}
/** Live-editor projection only. Detached export editors deliberately render every block. */
export function wordVisibility(
  shape: TLShape,
  editor: Editor,
): "hidden" | "inherit" {
  const controller = controllers.get(editor);
  if (!controller) return "inherit";
  const state = controller.visibility.get();
  if (!state.enabled || !state.documentId) return "inherit";
  if (shape.type === "word-block") {
    const props = shape.props as unknown as {
      documentId: string;
      blockId: string;
    };
    return props.documentId === state.documentId &&
      !state.visibleIds.includes(props.blockId)
      ? "hidden"
      : "inherit";
  }
  const anchor = shape.meta.wordAnchor as
    { documentId?: string; blockId?: string } | undefined;
  return anchor?.documentId === state.documentId &&
    anchor.blockId &&
    !state.visibleIds.includes(anchor.blockId)
    ? "hidden"
    : "inherit";
}

export class WordTeachingController {
  readonly visibility = atom<TeachingState>("Word teaching visibility", {
    enabled: false,
    currentBlockId: null,
    phase: "editing",
    visibleIds: [],
    total: 0,
    pageId: "",
    documentId: null,
  });
  #listeners = new Set<() => void>();
  #dispose: () => void;
  #abort = new AbortController();
  #model: DocumentModel | undefined;
  #page = "";
  #anchoring = false;
  #shapeDisposers: (() => void)[] = [];
  readonly editor: Editor;
  constructor(editor: Editor) {
    this.editor = editor;
    if (
      typeof (editor as unknown as { isReplayingHistory?: unknown })
        .isReplayingHistory !== "function"
    )
      throw new Error(
        "This editor version cannot safely preserve Word annotation history. Keep the source draft and update the verified editor adapter.",
      );
    // Current-page session changes need the same synchronous reactive tracking as
    // page metadata; a frame-throttled store listener can publish the prior page.
    this.#dispose = react("Word teaching page", () => this.#sync());
    this.#shapeDisposers.push(
      editor.sideEffects.registerBeforeCreateHandler("shape", (shape) =>
        this.#anchorRecord(shape),
      ),
      editor.sideEffects.registerBeforeChangeHandler(
        "shape",
        (_before, after) => this.#anchorRecord(after),
      ),
    );
    this.#sync();
  }
  #anchorRecord(shape: TLShape): TLShape {
    // Pinned SDK 5.6 exposes this replay flag at runtime but omits its internal
    // type. No record repair runs during history: replay restores exact diffs.
    const replay = this.editor as unknown as {
      isReplayingHistory?: () => boolean;
    };
    if (
      this.#anchoring ||
      replay.isReplayingHistory?.() ||
      shape.type === "word-block"
    )
      return shape;
    const page = this.editor.getPage(shape.parentId as never);
    if (!page || page.typeName !== "page") {
      if (shape.meta.wordAnchor === undefined) return shape;
      const meta = { ...shape.meta };
      delete meta.wordAnchor;
      return { ...shape, meta };
    }
    const model = page.meta.word as DocumentModel | undefined;
    if (!model || shape.meta.wordDetached) return shape;
    const blocks: WordPlacement[] = [...this.editor.getPageShapeIds(page.id)]
      .map((id) => this.editor.getShape(id)!)
      .filter((s) => s.type === "word-block")
      .map((s) => ({
        id: String((s.props as unknown as { blockId: string }).blockId),
        x: s.x,
        y: s.y,
        width: Number((s.props as unknown as { w: number }).w),
        height: Number((s.props as unknown as { h: number }).h),
      }))
      .sort((a, b) => a.y - b.y);
    const state = this.visibility.get();
    const anchor = collectWordAnchors(
      model.id,
      page.id,
      blocks,
      [
        {
          id: shape.id,
          parentId: shape.parentId,
          x: shape.x,
          y: shape.y,
          bounds: { x: shape.x, y: shape.y, w: 0, h: 0 },
          meta: shape.meta as Record<string, unknown>,
        },
      ],
      state.enabled && state.pageId === page.id
        ? (state.currentBlockId ?? undefined)
        : undefined,
    )[0];
    if (!anchor) return shape;
    const next = {
      documentId: model.id,
      blockId: anchor.blockId,
      dx: anchor.dx,
      dy: anchor.dy,
    };
    if (JSON.stringify(shape.meta.wordAnchor) === JSON.stringify(next))
      return shape;
    return { ...shape, meta: { ...shape.meta, wordAnchor: next } };
  }
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  getSnapshot = () => this.visibility.get();
  model() {
    return this.editor.getCurrentPage().meta.word as DocumentModel | undefined;
  }
  #sync() {
    const page = this.editor.getCurrentPage(),
      model = page.meta.word as DocumentModel | undefined;
    if (this.#page === page.id && this.#model === model) return;
    const previous = this.visibility.get(),
      changedPage = this.#page !== page.id || this.#model?.id !== model?.id;
    this.#page = page.id;
    this.#model = model;
    this.#publish(
      changedPage
        ? { enabled: false, currentBlockId: null, phase: "editing" }
        : previous,
    );
  }
  #publish(core: RevealCore) {
    const model = this.model(),
      ids = model ? orderedTeachingBlocks(model).map((b) => b.id) : [];
    const index = core.currentBlockId ? ids.indexOf(core.currentBlockId) : -1;
    if (core.currentBlockId && index < 0)
      core = {
        ...core,
        currentBlockId: null,
        phase: core.enabled ? "prepared" : "editing",
      };
    const visibleIds = core.enabled ? ids.slice(0, index + 1) : ids;
    this.visibility.set({
      ...core,
      visibleIds,
      total: ids.length,
      pageId: this.editor.getCurrentPageId(),
      documentId: model?.id ?? null,
    });
    for (const listener of this.#listeners) listener();
  }
  #act(action: RevealAction) {
    this.#sync();
    const model = this.model();
    if (!model) return;
    const ids = orderedTeachingBlocks(model).map((b) => b.id);
    this.#publish(reduceReveal(this.visibility.get(), ids, action));
    if (action !== "stop" && action !== "start") this.focusCurrent();
  }
  start = () => this.#act("start");
  stop = () => this.#act("stop");
  resume = () => this.#act("resume");
  next = () => this.#act("next");
  previous = () => this.#act("previous");
  revealAll = () => this.#act("all");
  selectBlock = (id: string) => {
    const model = this.model();
    if (!model || !orderedTeachingBlocks(model).some((b) => b.id === id))
      return;
    const old = this.visibility.get();
    this.#publish({
      ...old,
      currentBlockId: id,
      phase: old.enabled ? "revealing" : "editing",
    });
    this.focusCurrent();
  };
  jumpSection = (index: number) => {
    const model = this.model();
    if (!model || !model.sections[index]) return;
    const section = model.sections[index],
      previous = index > 0 ? model.sections[index - 1].afterBlockId : undefined;
    const block =
      model.blocks.find((b) => b.sectionId === section.id) ??
      (previous
        ? model.blocks[model.blocks.findIndex((b) => b.id === previous) + 1]
        : model.blocks[0]);
    if (block) this.selectBlock(block.id);
  };
  focusCurrent() {
    const id = this.visibility.get().currentBlockId;
    const shape = this.editor
      .getCurrentPageShapes()
      .find(
        (s) =>
          s.type === "word-block" &&
          (s.props as unknown as { blockId: string }).blockId === id,
      );
    if (!shape) return;
    const width = Number((shape.props as unknown as { w: number }).w),
      z = Math.max(
        0.25,
        Math.min(1, (this.editor.getViewportScreenBounds().w - 64) / width),
      );
    this.editor.setCamera({ x: 32 / z - shape.x, y: 32 / z - shape.y, z });
  }
  /** Capture root-local identity after input; offsets are also reconciled before reflow. */
  anchorAnnotations() {
    if (this.#anchoring || this.editor.getIsReadonly()) return;
    const model = this.model();
    if (!model) return;
    const pageId = this.editor.getCurrentPageId(),
      all = this.editor.getCurrentPageShapes();
    const blocks: WordPlacement[] = all
      .filter((s) => s.type === "word-block")
      .map((s) => ({
        id: String((s.props as unknown as { blockId: string }).blockId),
        x: s.x,
        y: s.y,
        width: Number((s.props as unknown as { w: number }).w),
        height: Number((s.props as unknown as { h: number }).h),
      }))
      .sort((a, b) => a.y - b.y);
    const candidates = all
      .filter((s) => s.type !== "word-block" && !s.meta.wordDetached)
      .map((s) => ({
        id: s.id,
        parentId: s.parentId,
        x: s.x,
        y: s.y,
        bounds: this.editor.getShapePageBounds(s) ?? {
          x: s.x,
          y: s.y,
          w: 0,
          h: 0,
        },
        meta: s.meta as Record<string, unknown>,
      }));
    const revealing = this.visibility.get();
    const anchors = collectWordAnchors(
      model.id,
      pageId,
      blocks,
      candidates,
      revealing.enabled ? (revealing.currentBlockId ?? undefined) : undefined,
    );
    const changes = anchors.flatMap((a) => {
      const shape = this.editor.getShape(a.id as TLShapeId)!;
      const next = {
        documentId: model.id,
        blockId: a.blockId,
        dx: a.dx,
        dy: a.dy,
      };
      return JSON.stringify(shape.meta.wordAnchor) === JSON.stringify(next)
        ? []
        : [
            {
              id: shape.id,
              type: shape.type,
              meta: { ...shape.meta, wordAnchor: next },
            },
          ];
    });
    const children = all
      .filter(
        (shape) =>
          shape.parentId !== pageId && shape.meta.wordAnchor !== undefined,
      )
      .map((shape) => {
        const meta = { ...shape.meta };
        delete meta.wordAnchor;
        return { ...shape, meta };
      });
    if (!changes.length && !children.length) return;
    this.#anchoring = true;
    try {
      this.editor.run(
        () => {
          if (children.length) this.editor.store.put(children);
          this.editor.updateShapes(changes);
        },
        {
          history: "ignore",
        },
      );
    } finally {
      this.#anchoring = false;
    }
  }
  dispose() {
    this.#dispose();
    for (const dispose of this.#shapeDisposers) dispose();
    this.#abort.abort();
    this.#listeners.clear();
    controllers.delete(this.editor);
  }
}
