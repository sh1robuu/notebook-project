import type { TLImageAsset } from "tldraw";
import type { BoardEngine } from "./engine.ts";
import type {
  LocalWorkspace,
  CommitReceipt,
} from "../workspace/local-workspace.ts";
import { SaveCoordinator } from "../workspace/save-coordinator.ts";
import {
  hydrateSurface,
  validateLesson,
  MAX_SHAPES,
} from "../workspace/model.ts";
import type { Lesson } from "../workspace/model.ts";
import { PdfRuntime } from "../pdf/runtime.ts";
import { SlidePlayback } from "../pptx/playback.ts";
import { bindMathCapacity } from "./capacity.ts";
import {
  mathFigureSampleCount,
  mathFigureSourceSize,
  MAX_LESSON_MATH_SAMPLES,
  MAX_LESSON_MATH_SOURCE_CHARS,
} from "../math/descriptor.ts";
import type { MathFigure } from "../math/descriptor.ts";
import { validateDocument } from "../documents/model.ts";
import type { DocumentModel } from "../documents/model.ts";
import { verifyDocumentSources } from "../documents/sources.ts";
import type { DocumentSources } from "../documents/sources.ts";
import type {
  SurfaceId,
  LessonView,
  Camera,
} from "../workspace/lesson-view.ts";
export type SessionState = {
  title: string;
  active: SurfaceId;
  view: LessonView;
  hasPrevious: boolean;
  presentation: boolean;
  reading: boolean;
  laser: SurfaceId | null;
  extension: boolean;
  message: string;
  version: number;
  editorEpoch: number;
};
type SaveValue = Pick<
  Lesson,
  | "document"
  | "scratchpad"
  | "view"
  | "pageId"
  | "title"
  | "wordDraft"
  | "wordSources"
>;
/** One persistence lifetime for two authoritative native drawing stores. */
export class LessonSession {
  readonly workspace: LocalWorkspace;
  pdf = new PdfRuntime();
  readonly slides = new SlidePlayback();
  readonly engines = new Map<SurfaceId, BoardEngine>();
  readonly saving: SaveCoordinator<SaveValue>;
  lastCommit: CommitReceipt | undefined;
  #view: LessonView;
  #listeners = new Set<() => void>();
  #shortcuts: (() => void) | undefined;
  #suspended = false;
  #closed = false;
  #generation = 0;
  #ownershipDispose: () => void;
  #retired = new Set<string>();
  #wordDraft: DocumentModel | null;
  wordSources: DocumentSources;
  state: SessionState;
  constructor(workspace: LocalWorkspace) {
    this.workspace = workspace;
    this.#wordDraft = workspace.lesson.wordDraft;
    this.wordSources = workspace.lesson.wordSources;
    this.#view = structuredClone(workspace.lesson.view);
    this.state = {
      title: workspace.lesson.title,
      active: "main",
      view: this.#view,
      hasPrevious: workspace.hasPrevious,
      presentation: false,
      reading: false,
      laser: null,
      extension: false,
      message: "",
      version: 0,
      editorEpoch: 0,
    };
    this.saving = new SaveCoordinator({
      read: () => this.#capture(),
      canSave: () => [...this.engines.values()].every((e) => !e.isPointing()),
      write: async (value) => {
        try {
          this.lastCommit = await workspace.save(
            value,
            workspace.lesson.revision,
          );
        } catch (error) {
          if (workspace.readOnly)
            for (const e of this.engines.values()) e.syncReadOnly();
          throw error;
        }
      },
    });
    this.#ownershipDispose = workspace.subscribeOwnership(() => {
      for (const engine of this.engines.values()) {
        engine.cancel();
        engine.syncReadOnly();
      }
      this.#publish();
    });
  }
  subscribe = (fn: () => void) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  #publish(value: Partial<SessionState> = {}) {
    this.state = { ...this.state, ...value, version: this.state.version + 1 };
    for (const fn of this.#listeners) fn();
  }
  notify(message: string) {
    this.#publish({ message });
  }
  getWordDraft() {
    return this.#wordDraft;
  }
  async saveWordDraft(
    draft: DocumentModel | null,
    incoming: DocumentSources = {},
  ) {
    if (this.workspace.readOnly)
      throw new Error("This workspace is read-only.");
    const scope = this.scope();
    await verifyDocumentSources(incoming);
    if (scope !== this.scope())
      throw new Error("The lesson changed. Draft was not applied.");
    const sources = { ...this.wordSources, ...incoming };
    const checked = draft === null ? null : validateDocument(draft, sources);
    validateLesson({
      ...this.getLesson(),
      wordDraft: checked,
      wordSources: sources,
    });
    const previousDraft = this.#wordDraft,
      previousSources = this.wordSources;
    this.#wordDraft = checked;
    this.wordSources = sources;
    this.#publish();
    this.saving.request();
    try {
      await this.saving.flush();
      if (this.saving.status.phase !== "saved")
        throw new Error(
          "The source draft could not be saved. The compiled lesson is unchanged; retry or download your work.",
        );
    } catch (error) {
      if (scope === this.scope() && this.#wordDraft === checked) {
        this.#wordDraft = previousDraft;
        this.wordSources = previousSources;
        this.#publish();
        this.saving.request();
        try {
          await this.saving.flush();
        } catch {
          /* Preserve the durable save error for recovery. */
        }
      }
      throw error;
    }
  }
  scope() {
    return this.workspace.lesson.id + ":" + this.#generation;
  }
  document(surface: SurfaceId) {
    return hydrateSurface(this.workspace.lesson, surface);
  }
  camera(surface: SurfaceId, pageId: string): Camera | undefined {
    return surface === "scratchpad"
      ? this.#view.scratchCamera
      : this.#view.mainCameras[pageId];
  }
  setCamera(
    surface: SurfaceId,
    pageId: string,
    camera: Camera,
    epoch = this.state.editorEpoch,
  ) {
    if (this.#suspended || this.#closed || epoch !== this.state.editorEpoch)
      return;
    const before = this.camera(surface, pageId);
    if (
      before &&
      before.x === camera.x &&
      before.y === camera.y &&
      before.z === camera.z
    )
      return;
    this.#view =
      surface === "scratchpad"
        ? { ...this.#view, scratchCamera: { ...camera } }
        : {
            ...this.#view,
            mainCameras: { ...this.#view.mainCameras, [pageId]: { ...camera } },
          };
    if (!this.workspace.readOnly) this.saving.request();
  }
  updateView(update: Partial<Pick<LessonView, "layout" | "hidden">>) {
    this.#view = { ...this.#view, ...update };
    this.#publish({ view: this.#view });
    if (!this.workspace.readOnly) this.saving.request();
  }
  setTitle(title: string) {
    if (this.workspace.readOnly || this.state.presentation) return;
    this.#publish({ title: title.slice(0, 120) });
    for (const e of this.engines.values()) e.syncLessonState();
    this.saving.request();
  }
  register(surface: SurfaceId, engine: BoardEngine) {
    if (this.#closed || engine.editorEpoch !== this.state.editorEpoch)
      return () => {};
    for (const other of this.engines.values())
      engine.receiveAssets(
        other.pages.editor
          .getAssets()
          .filter((a): a is TLImageAsset => a.type === "image"),
      );
    this.engines.set(surface, engine);
    const disposeMathBudget = bindMathCapacity(engine.pages.editor, () =>
      this.#withinMathCapacity(),
    );
    if (this.state.active === surface) this.#installShortcuts();
    this.#publish();
    return () => {
      disposeMathBudget();
      if (this.engines.get(surface) === engine) {
        this.engines.delete(surface);
        if (this.state.active === surface) this.#installShortcuts();
      }
    };
  }
  #withinMathCapacity() {
    let samples = 0;
    let chars = 0;
    const check = (figure: MathFigure) => {
      samples += mathFigureSampleCount(figure);
      chars += mathFigureSourceSize(figure);
      return (
        samples <= MAX_LESSON_MATH_SAMPLES &&
        chars <= MAX_LESSON_MATH_SOURCE_CHARS
      );
    };
    for (const surface of ["main", "scratchpad"] as const) {
      const editor = this.engines.get(surface)?.pages.editor;
      if (editor) {
        const ids = editor.store.query
          .ids("shape", () => ({ type: { eq: "math-figure" } }))
          .get();
        for (const id of ids) {
          const shape = editor.getShape(id);
          if (shape?.type === "math-figure" && !check(shape.props.figure))
            return false;
        }
      } else {
        const lesson = this.workspace.lesson;
        const snapshot =
          surface === "main" ? lesson.document : lesson.scratchpad.document;
        for (const record of Object.values(snapshot.store)) {
          if (
            record.typeName === "shape" &&
            record.type === "math-figure" &&
            !check(record.props.figure)
          )
            return false;
        }
      }
    }
    return true;
  }
  remainingShapes() {
    return (
      MAX_SHAPES -
      (["main", "scratchpad"] as const).reduce((total, surface) => {
        const engine = this.engines.get(surface);
        return (
          total +
          (engine
            ? engine.pages.editor.store.query.ids("shape").get().size
            : Object.values(this.document(surface).store).filter(
                (r) => r.typeName === "shape",
              ).length)
        );
      }, 0)
    );
  }
  history(surface: SurfaceId, direction: "undo" | "redo") {
    if (this.workspace.readOnly || this.state.presentation) return;
    const editor = this.engines.get(surface)?.pages.editor;
    if (!editor) return;
    let beforeValid = true;
    try {
      this.getLesson();
    } catch {
      beforeValid = false;
    }
    // History replay can resurrect sources/points after work on the other surface.
    // Suspend mirroring until the composed result passes every archive budget.
    this.#suspended = true;
    try {
      editor[direction]();
      if (beforeValid)
        try {
          this.getLesson();
        } catch (error) {
          editor[direction === "undo" ? "redo" : "undo"]();
          this.notify(
            `${direction === "undo" ? "Undo" : "Redo"} was cancelled: ${error instanceof Error ? error.message : "lesson limit exceeded"}`,
          );
          return;
        }
    } finally {
      this.#suspended = false;
    }
    this.changed(
      surface,
      editor.getAssets().filter((a): a is TLImageAsset => a.type === "image"),
    );
  }
  activate(surface: SurfaceId) {
    if (this.state.active === surface && this.engines.has(surface)) return;
    const previous = this.engines.get(this.state.active);
    const laser = this.state.laser !== null;
    previous?.cancel();
    this.armExtension(false);
    this.#publish({ active: surface });
    this.#installShortcuts();
    if (laser) this.engines.get(surface)?.startLaser();
  }
  #installShortcuts() {
    this.#shortcuts?.();
    this.#shortcuts = this.engines.get(this.state.active)?.commands.install();
  }
  changed(
    source: SurfaceId,
    assets: TLImageAsset[] = [],
    epoch = this.state.editorEpoch,
  ) {
    if (
      this.#suspended ||
      this.workspace.readOnly ||
      this.#closed ||
      epoch !== this.state.editorEpoch
    )
      return;
    if (assets.length) {
      for (const [surface, other] of this.engines)
        if (surface !== source) other.receiveAssets(assets);
    }
    this.saving.request();
  }
  retireSources(ids: Iterable<string>) {
    let changed = false;
    for (const id of ids)
      if (!this.#retired.has(id)) {
        this.#retired.add(id);
        changed = true;
      }
    if (changed && !this.workspace.readOnly) this.saving.request();
  }
  armExtension(extension: boolean) {
    if (extension && (this.workspace.readOnly || this.state.presentation))
      return;
    if (this.state.extension !== extension) this.#publish({ extension });
  }
  setLaser(laser: SurfaceId | null) {
    this.armExtension(false);
    if (this.state.laser !== laser) this.#publish({ laser });
  }
  #capture(): SaveValue {
    const original = this.workspace.lesson,
      main = this.engines.get("main"),
      scratch = this.engines.get("scratchpad");
    const document = main?.captureDocument() ?? original.document,
      scratchDoc = scratch?.captureDocument() ?? original.scratchpad.document;
    const assets = new Map<string, TLImageAsset>();
    for (const doc of [document, scratchDoc])
      for (const record of Object.values(doc.store))
        if (record.typeName === "asset" && record.type === "image") {
          const existing = assets.get(record.id);
          if (existing && existing.props.src !== record.props.src)
            throw new Error(
              "Conflicting shared image identity. Work has been kept.",
            );
          assets.set(record.id, record);
        }
    const used = new Set<string>();
    for (const doc of [document, scratchDoc])
      for (const r of Object.values(doc.store))
        if (r.typeName === "shape" && r.type === "image" && r.props.assetId)
          used.add(r.props.assetId);
    const mainStore = { ...document.store };
    for (const [id, r] of Object.entries(mainStore))
      if (r.typeName === "asset")
        delete mainStore[id as keyof typeof mainStore];
    for (const [id, asset] of assets)
      if (!this.#retired.has(id) || used.has(id)) mainStore[asset.id] = asset;
    const scratchStore = Object.fromEntries(
      Object.entries(scratchDoc.store).filter(
        ([, r]) => r.typeName !== "asset",
      ),
    );
    const pages = new Set(
      Object.values(mainStore)
        .filter((r) => r.typeName === "page")
        .map((r) => String(r.id)),
    );
    const view = {
      ...this.#view,
      mainCameras: Object.fromEntries(
        Object.entries(this.#view.mainCameras).filter(([id]) => pages.has(id)),
      ),
    };
    return {
      document: { ...document, store: mainStore },
      scratchpad: {
        pageId: scratch?.currentPageId() ?? original.scratchpad.pageId,
        document: { ...scratchDoc, store: scratchStore },
      },
      pageId: main?.currentPageId() ?? original.pageId,
      title: this.state.title,
      view,
      wordDraft: this.#wordDraft,
      wordSources: this.wordSources,
    };
  }
  getLesson(): Lesson {
    return validateLesson({ ...this.workspace.lesson, ...this.#capture() });
  }
  setPresentation(presentation: boolean) {
    if (this.state.presentation === presentation) return;
    this.armExtension(false);
    for (const e of this.engines.values()) e.cancel();
    this.#publish({ presentation });
    for (const e of this.engines.values()) e.syncReadOnly();
  }
  setReading(reading: boolean) {
    if (this.state.reading === reading) return;
    if (reading) {
      this.activate("main");
      this.engines.get("main")?.pages.editor.selectNone();
    }
    this.engines.get("main")?.cancel();
    this.#publish({ reading });
    this.engines.get("main")?.syncReadOnly();
  }
  async restore(candidate: Lesson) {
    const checked = validateLesson(candidate);
    this.#generation++;
    for (const e of this.engines.values()) e.cancel();
    await this.saving.flush();
    if (this.saving.status.phase !== "saved")
      throw new Error("Finish or cancel active input before opening a lesson.");
    this.#apply(await this.workspace.restore(checked));
  }
  previousLesson() {
    return this.workspace.previousLesson();
  }
  async restorePrevious() {
    this.#generation++;
    for (const e of this.engines.values()) e.cancel();
    await this.saving.flush();
    if (this.saving.status.phase !== "saved")
      throw new Error("Finish or cancel active input first.");
    this.#apply(await this.workspace.activatePrevious());
  }
  #apply(lesson: Lesson) {
    this.#suspended = true;
    try {
      this.#wordDraft = lesson.wordDraft;
      this.wordSources = lesson.wordSources;
      this.#view = structuredClone(lesson.view);
      this.#retired.clear();
      this.pdf.close();
      this.pdf = new PdfRuntime();
      this.slides.clear();
      // Native Store.history retains up to 1000 reactive record diffs even after
      // clearHistory(). A different lesson needs fresh stores, not cross-lesson
      // retained graphs. Page/layout changes keep their existing editors.
      this.#shortcuts?.();
      this.#shortcuts = undefined;
      this.engines.clear();
      this.#publish({
        title: lesson.title,
        view: this.#view,
        hasPrevious: this.workspace.hasPrevious,
        active: "main",
        presentation: false,
        reading: false,
        laser: null,
        extension: false,
        editorEpoch: this.state.editorEpoch + 1,
      });
      this.saving.reset();
      this.#installShortcuts();
    } finally {
      this.#suspended = false;
    }
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#ownershipDispose();
    this.pdf.close();
    this.slides.clear();
    this.#shortcuts?.();
    this.saving.close();
    this.#listeners.clear();
  }
}
