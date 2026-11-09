import { Box, PageRecordType, getIndexBetween } from "tldraw";
import type { Editor, TLPageId } from "tldraw";
import type { BoardEngine } from "./engine.ts";
import { MAX_PAGES, validateLesson } from "../workspace/model.ts";
import { defaultPaper, validatePaper } from "../workspace/lesson-view.ts";
import type { Paper } from "../workspace/lesson-view.ts";
import { devicePreferences } from "../workspace/preferences.ts";
export const paperColors = {
  white: "#ffffff",
  dark: "#20272d",
  green: "#174e40",
};
/** Native pages remain the only page and undo model. */
export class PageController {
  constructor(
    readonly editor: Editor,
    readonly engine: BoardEngine,
  ) {}
  get writable() {
    return (
      !this.engine.session.workspace.readOnly &&
      !this.editor.getIsReadonly() &&
      this.engine.surface === "main"
    );
  }
  navigate(id: TLPageId) {
    this.engine.cancel();
    this.engine.session.activate("main");
    if (!this.engine.session.workspace.readOnly) this.engine.saving.request();
    this.editor.setCurrentPage(id);
  }
  step(delta: number) {
    const pages = this.editor.getPages(),
      i = pages.findIndex((p) => p.id === this.editor.getCurrentPageId());
    if (pages[i + delta]) this.navigate(pages[i + delta].id);
  }
  add() {
    if (!this.writable || this.editor.getPages().length >= MAX_PAGES) return;
    this.engine.session.activate("main");
    this.engine.cancel();
    const id = PageRecordType.createId();
    this.editor.markHistoryStoppingPoint("Add page");
    this.editor.run(() => {
      this.editor.createPage({ id, meta: { paper: {
        ...defaultPaper(),
        color: devicePreferences.getSnapshot().value.paperColor,
      } } });
      this.editor.setCurrentPage(id);
    });
  }
  duplicate() {
    if (!this.writable || this.editor.getPages().length >= MAX_PAGES) return;
    this.engine.session.activate("main");
    this.engine.cancel();
    const original = this.editor.getCurrentPage(),
      id = PageRecordType.createId();
    // Validate the complete prospective lesson, including the other surface's budget.
    const lesson = this.engine.getLesson(),
      store = { ...lesson.document.store };
    const ids = this.editor.getPageShapeIds(original.id),
      mapping = new Map<string, string>();
    for (const key of ids) mapping.set(key, "shape:" + crypto.randomUUID());
    const pageIndex = this.editor
      .getPages()
      .findIndex((p) => p.id === original.id);
    store[id] = {
      ...original,
      id,
      index: getIndexBetween(
        original.index,
        this.editor.getPages()[pageIndex + 1]?.index,
      ),
    };
    for (const r of Object.values(lesson.document.store)) {
      if (r.typeName === "shape" && ids.has(r.id)) {
        const next = {
          ...r,
          id: mapping.get(r.id)!,
          parentId: r.parentId === original.id ? id : mapping.get(r.parentId)!,
        };
        store[next.id as keyof typeof store] = next as never;
      } else if (
        r.typeName === "binding" &&
        ids.has(r.fromId) &&
        ids.has(r.toId)
      ) {
        const next = {
          ...r,
          id: "binding:" + crypto.randomUUID(),
          fromId: mapping.get(r.fromId)!,
          toId: mapping.get(r.toId)!,
        };
        store[next.id as keyof typeof store] = next as never;
      }
    }
    try {
      validateLesson({ ...lesson, document: { ...lesson.document, store } });
    } catch (error) {
      this.engine.session.notify(
        error instanceof Error ? error.message : "Page cannot be duplicated.",
      );
      return;
    }
    this.editor.markHistoryStoppingPoint("Duplicate page");
    this.editor.run(() => {
      this.editor.duplicatePage(original, id);
      this.editor.updatePage({ id, meta: structuredClone(original.meta) });
    });
  }
  move(delta: number) {
    if (!this.writable) return;
    this.engine.session.activate("main");
    const pages = this.editor.getPages(),
      p = this.editor.getCurrentPage(),
      i = pages.findIndex((v) => v.id === p.id),
      next = i + delta;
    if (next < 0 || next >= pages.length) return;
    this.engine.cancel();
    const others = pages.filter((v) => v.id !== p.id);
    this.editor.markHistoryStoppingPoint("Reorder page");
    this.editor.updatePage({
      id: p.id,
      index: getIndexBetween(others[next - 1]?.index, others[next]?.index),
    });
  }
  remove(id: TLPageId) {
    if (
      !this.writable ||
      this.editor.getPages().length === 1 ||
      !this.editor.getPage(id)
    )
      return;
    this.engine.session.activate("main");
    this.engine.cancel();
    this.engine.session.retireSources(this.editor.getAssets().map((a) => a.id));
    this.editor.markHistoryStoppingPoint("Delete page");
    this.editor.deletePage(id);
  }
  paper(update: Partial<Paper>) {
    if (!this.writable) return;
    if (validatePaper(this.editor.getCurrentPage().meta.paper).kind !== "blank")
      return;
    this.engine.session.activate("main");
    const p = this.editor.getCurrentPage(),
      paper = validatePaper({ ...validatePaper(p.meta.paper), ...update });
    this.engine.cancel();
    this.editor.markHistoryStoppingPoint("Paper properties");
    this.editor.updatePage({ id: p.id, meta: { ...p.meta, paper } });
  }
}

/** Bounded LRU; previews are requested only by visible page rows after input settles. */
export class PagePreviews {
  #cache = new Map<string, { version: number; url: string }>();
  #versions = new Map<string, number>();
  #listeners = new Set<() => void>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #queue = Promise.resolve();
  #closed = false;
  #epoch = 0;
  readonly dispose: () => void;
  generated = 0;
  failures = 0;
  constructor(
    readonly editor: Editor,
    readonly background?: (
      paper: Paper,
      signal?: AbortSignal,
    ) => Promise<string | undefined>,
  ) {
    this.dispose = editor.store.listen(
      (entry) => {
        const changed = [
          ...Object.values(entry.changes.added),
          ...Object.values(entry.changes.removed),
          ...Object.values(entry.changes.updated).flat(),
        ];
        const pages = new Set<string>();
        for (const r of changed) {
          if (r.typeName === "page") pages.add(r.id);
          if (r.typeName === "shape") {
            let p = r.parentId;
            let n = 0;
            while (!String(p).startsWith("page:") && n++ < 40) {
              const parent = editor.getShape(p as never);
              if (!parent) break;
              p = parent.parentId;
            }
            if (String(p).startsWith("page:")) pages.add(p);
          }
          if (r.typeName === "asset")
            for (const p of editor.getPages()) pages.add(p.id);
        }
        for (const id of pages)
          this.#versions.set(id, (this.#versions.get(id) ?? 0) + 1);
        if (pages.size) {
          clearTimeout(this.#timer);
          this.#timer = setTimeout(() => this.#announce(), 800);
        }
      },
      { scope: "document" },
    );
  }
  #announce() {
    if (this.editor.inputs.getIsPointing()) {
      this.#timer = setTimeout(() => this.#announce(), 300);
      return;
    }
    this.#epoch++;
    for (const fn of this.#listeners) fn();
  }
  subscribe = (fn: () => void) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };
  getSnapshot = () => this.#epoch;
  get count() {
    return this.#cache.size;
  }
  async get(id: TLPageId, signal?: AbortSignal): Promise<string | undefined> {
    const version = this.#versions.get(id) ?? 0,
      cached = this.#cache.get(id);
    if (cached?.version === version) {
      this.#cache.delete(id);
      this.#cache.set(id, cached);
      return cached.url;
    }
    let output: string | undefined;
    this.#queue = this.#queue.then(async () => {
      if (
        this.#closed ||
        signal?.aborted ||
        !this.editor.getPage(id) ||
        this.editor.inputs.getIsPointing()
      )
        return;
      // A row may request twice while an export is pending.
      const hit = this.#cache.get(id);
      if (hit?.version === version) {
        output = hit.url;
        return;
      }
      try {
        const paper = validatePaper(this.editor.getPage(id)!.meta.paper),
          ids = [...this.editor.getPageShapeIds(id)];
        const bounds = new Box(0, 0, paper.width, paper.height);
        for (const shape of ids) {
          const b = this.editor.getShapePageBounds(shape);
          if (b) bounds.union(b);
        }
        const result = ids.length
          ? await this.editor.getSvgString(ids, {
              bounds,
              padding: 0,
              background: false,
              scale: Math.min(1, 240 / bounds.w),
            })
          : undefined;
        if (
          this.#closed ||
          signal?.aborted ||
          (this.#versions.get(id) ?? 0) !== version
        )
          return;
        // Native SVG exports retain world coordinates in their viewBox.
        const doc = new DOMParser().parseFromString(
          result?.svg ??
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bounds.w} ${bounds.h}"/>`,
          "image/svg+xml",
        );
        const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
        for (const [k, v] of Object.entries({
          x: 0,
          y: 0,
          width: paper.width,
          height: paper.height,
          fill: paperColors[paper.color],
        }))
          rect.setAttribute(k, String(v));
        doc.documentElement.prepend(rect);
        if (paper.kind !== "blank" && this.background) {
          const href = await this.background(paper, signal);
          if (this.#closed || signal?.aborted) return;
          if (!href) throw new Error("Page preview background unavailable.");
          const image = doc.createElementNS(
            "http://www.w3.org/2000/svg",
            "image",
          );
          for (const [k, v] of Object.entries({
            x: 0,
            y: 0,
            width: paper.width,
            height: paper.height,
            href,
          }))
            image.setAttribute(k, String(v));
          rect.after(image);
        }
        const url = URL.createObjectURL(
          new Blob([new XMLSerializer().serializeToString(doc)], {
            type: "image/svg+xml",
          }),
        );
        if (hit) URL.revokeObjectURL(hit.url);
        this.#cache.delete(id);
        this.#cache.set(id, { version, url });
        this.generated++;
        while (this.#cache.size > 12) {
          const first = this.#cache.keys().next().value!;
          URL.revokeObjectURL(this.#cache.get(first)!.url);
          this.#cache.delete(first);
        }
        output = url;
      } catch {
        this.failures++;
      }
    });
    await this.#queue;
    return output;
  }
  close() {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.dispose();
    for (const item of this.#cache.values()) URL.revokeObjectURL(item.url);
    this.#cache.clear();
    this.#listeners.clear();
  }
}
