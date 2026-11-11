import {
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultSizeStyle,
  loadSnapshot,
  react,
} from "tldraw";
import type {
  Editor,
  TLDefaultColorStyle,
  TLDefaultSizeStyle,
  TLStoreSnapshot,
  TLImageAsset,
  TLPageId,
} from "tldraw";
import { installInputGuard } from "./input-guard.ts";
import type { TouchMode } from "./input-policy.ts";
import { EditingController } from "./editing.ts";
import { ClipboardController } from "./clipboard.ts";
import { CommandRegistry } from "../../app/commands.ts";
import type { LessonSession } from "./lesson-session.ts";
import type { SurfaceId } from "../workspace/lesson-view.ts";
import { makeLesson } from "../workspace/model.ts";
import type { Lesson } from "../workspace/model.ts";
import { PageController, PagePreviews } from "./pages.ts";
import { installExtension } from "./page-extension.ts";
import { installLaser } from "./laser.ts";
import { installTextCaret } from "./text-caret.ts";
import { bindCapacity } from "./capacity.ts";
import { bindWordSources } from "../documents/editor-sources.ts";
import { paintSlide, slideForPaper } from "../pptx/render.ts";
import { bindInteractiveSources } from "../interactive/InteractiveShape.tsx";
import { devicePreferences } from "../workspace/preferences.ts";
import type { WorkspacePreferences } from "../workspace/preferences.ts";
import { activityState } from "../workspace/activity.ts";
export type BoardTool =
  | "draw"
  | "highlight"
  | "eraser"
  | "partial_eraser"
  | "hand"
  | "select"
  | "geo"
  | "line"
  | "arrow"
  | "text"
  | "lesson_laser";
export type BoardState = {
  tool: BoardTool;
  color: TLDefaultColorStyle;
  size: TLDefaultSizeStyle;
  touchMode: TouchMode;
  count: number;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  title: string;
  readOnly: boolean;
  hasPrevious: boolean;
};

export class BoardEngine {
  #editor: Editor;
  readonly session: LessonSession;
  readonly surface: SurfaceId;
  readonly editorEpoch: number;
  #pageEpoch = 0;
  #cameraPage = "";
  #guard: ReturnType<typeof installInputGuard>;
  #dispose: (() => void)[] = [];
  #listeners = new Set<() => void>();
  #ink = {
    color: "black" as TLDefaultColorStyle,
    size: "m" as TLDefaultSizeStyle,
  };
  #highlighter = {
    color: "yellow" as TLDefaultColorStyle,
    size: "l" as TLDefaultSizeStyle,
  };
  #suspended = false;
  #closed = false;
  #laserPrevious: BoardTool = "draw";
  #presentationPrevious: BoardTool = "draw";
  #presenting = false;
  state: BoardState;
  readonly saving: LessonSession["saving"];
  get lastCommit() {
    return this.session.lastCommit;
  }
  readonly editing: EditingController;
  readonly clipboard: ClipboardController;
  readonly commands: CommandRegistry;
  readonly pages: PageController;
  readonly previews: PagePreviews;
  constructor(
    editor: Editor,
    session: LessonSession,
    element: HTMLElement,
    surface: SurfaceId = "main",
  ) {
    const workspace = session.workspace;
    this.session = session;
    this.surface = surface;
    this.editorEpoch = session.state.editorEpoch;
    const preferences = devicePreferences.getSnapshot().value;
    this.#ink = { color: preferences.penColor, size: preferences.penSize };
    this.#highlighter = {
      color: preferences.highlighterColor,
      size: preferences.highlighterSize,
    };
    this.#editor = editor;
    this.#dispose.push(bindWordSources(editor, () => session.wordSources));
    this.#dispose.push(
      bindInteractiveSources(editor, () => session.interactiveSources),
    );
    loadSnapshot(editor.store, { document: session.document(surface) });
    editor.setCurrentPage(
      (surface === "main"
        ? workspace.lesson.pageId
        : workspace.lesson.scratchpad.pageId) as TLPageId,
    );
    editor.clearHistory();
    editor.setCameraOptions({
      zoomSteps: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4],
      wheelBehavior: "pan",
    });
    if (editor.getCurrentPageShapeIds().size) editor.zoomToFit();
    editor.updateInstanceState({
      isReadonly: workspace.readOnly || session.state.presentation,
      isGridMode: false,
    });
    editor.setCurrentTool(workspace.readOnly ? "hand" : "draw");
    this.state = {
      tool: workspace.readOnly ? "hand" : "draw",
      color: preferences.penColor,
      size: preferences.penSize,
      touchMode: preferences.touchMode,
      count: 0,
      canUndo: false,
      canRedo: false,
      zoom: 1,
      title: workspace.lesson.title,
      readOnly: workspace.readOnly,
      hasPrevious: workspace.hasPrevious,
    };
    this.saving = session.saving;
    this.pages = new PageController(editor, this);
    this.#dispose.push(bindCapacity(editor, () => session.remainingShapes()));
    this.previews = new PagePreviews(editor, async (paper, signal) => {
      if (paper.kind === "pptx") {
        const lesson = session.workspace.lesson;
        const scene = slideForPaper(lesson, paper);
        if (!scene) return undefined;
        const canvas = document.createElement("canvas");
        const scale = Math.min(240 / paper.width, 180 / paper.height);
        canvas.width = Math.max(1, Math.round(paper.width * scale));
        canvas.height = Math.max(1, Math.round(paper.height * scale));
        try {
          const ctx = canvas.getContext("2d")!;
          ctx.scale(canvas.width / paper.width, canvas.height / paper.height);
          await paintSlide(
            ctx,
            scene.slide,
            paper.width,
            paper.height,
            lesson.pptxSources,
            new Set(),
            signal ?? AbortSignal.timeout(30000),
          );
          return canvas.toDataURL("image/png");
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      const source = session.workspace.lesson.pdfSources[paper.sourceId ?? ""];
      if (!source) return undefined;
      const image = await session.pdf.paint(
        source,
        paper.pageIndex!,
        Math.min(240 / paper.width, 180 / paper.height),
        signal ?? AbortSignal.timeout(30000),
      );
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      try {
        canvas.getContext("2d")!.drawImage(image, 0, 0);
        return canvas.toDataURL("image/png");
      } finally {
        canvas.width = canvas.height = 0;
      }
    });
    this.#dispose.push(() => this.previews.close());
    this.#dispose.push(installExtension(element, this));
    this.#dispose.push(installLaser(element, this));
    const storedCamera = session.camera(
      surface,
      String(editor.getCurrentPageId()),
    );
    if (storedCamera) editor.setCamera(storedCamera);
    this.#cameraPage = String(editor.getCurrentPageId());
    this.#guard = installInputGuard(
      element,
      editor,
      () => {
        this.saving.flush().catch(() => {});
      },
      () => this.saving.request(),
      (e) => {
        if (session.remainingShapes() > 0 || e.pointerType === "touch")
          return true;
        const tool = editor.getCurrentToolId();
        const creates = [
          "draw",
          "highlight",
          "geo",
          "line",
          "arrow",
          "text",
        ].includes(tool);
        if (creates) {
          session.notify(
            "Lesson capacity reached (20,000 objects across both surfaces). Delete work or open another lesson before adding objects.",
          );
          return false;
        }
        return true;
      },
      () => {
        if (session.remainingShapes() >= 0) return true;
        session.notify(
          "Lesson capacity reached. The complete gesture was cancelled.",
        );
        return false;
      },
    );
    this.editing = new EditingController(
      editor,
      () => this.saving.request(),
      () => this.scope(),
    );
    this.clipboard = new ClipboardController(
      editor,
      this.editing,
      () => this.getClipboardLesson(),
      () => this.scope(),
    );
    this.commands = new CommandRegistry(this);
    this.#dispose.push(this.clipboard.install(element));
    this.#dispose.push(installTextCaret(element, editor));
    this.#dispose.push(
      editor.store.listen(
        (entry) => {
          if (!this.#suspended && !workspace.readOnly) {
            const assets = [
              ...Object.values(entry.changes.added),
              ...Object.values(entry.changes.updated).map((pair) => pair[1]),
            ].filter(
              (r): r is TLImageAsset =>
                r.typeName === "asset" && r.type === "image",
            );
            this.session.changed(this.surface, assets, this.editorEpoch);
          }
        },
        { scope: "document" },
      ),
    );
    this.#dispose.push(
      react("lessonboard controls", () => {
        const tool = editor.getCurrentToolId() as BoardTool;
        this.#publish({
          ...this.state,
          tool,
          count: editor.getCurrentPageShapeIds().size,
          zoom: editor.getZoomLevel(),
          canUndo: editor.getCanUndo(),
          canRedo: editor.getCanRedo(),
        });
      }),
    );
    this.#dispose.push(session.register(surface, this));
    this.#dispose.push(
      react("surface view", () => {
        const page = String(editor.getCurrentPageId());
        let camera = editor.getCamera();
        if (this.#suspended) return;
        if (page !== this.#cameraPage) {
          this.stopLaser();
          this.session.armExtension(false);
          this.#pageEpoch++;
          this.#cameraPage = page;
          if (!workspace.readOnly) this.saving.request();
          const stored = session.camera(surface, page);
          if (stored) {
            editor.setCamera(stored);
            camera = editor.getCamera();
          }
        }
        session.setCamera(
          surface,
          page,
          {
            x: camera.x,
            y: camera.y,
            z: camera.z,
          },
          this.editorEpoch,
        );
      }),
    );
    this.#applyStyle();
    this.#guard.setTouchMode(preferences.touchMode);
  }
  subscribe = (fn: () => void) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  #publish(next: BoardState) {
    if (
      Object.keys(next).every(
        (k) =>
          next[k as keyof BoardState] === this.state[k as keyof BoardState],
      )
    )
      return;
    this.state = next;
    for (const fn of this.#listeners) fn();
  }
  #applyStyle() {
    const style =
      this.state.tool === "highlight" ? this.#highlighter : this.#ink;
    this.#editor.setStyleForNextShapes(DefaultColorStyle, style.color);
    this.#editor.setStyleForNextShapes(DefaultSizeStyle, style.size);
    this.#editor.setStyleForNextShapes(DefaultFillStyle, "none");
    this.#editor.setStyleForNextShapes(DefaultDashStyle, "draw");
    this.#publish({ ...this.state, ...style });
  }
  setTool(tool: BoardTool) {
    if (
      (this.state.readOnly ||
        this.session.state.presentation ||
        (this.surface === "main" && this.session.state.reading)) &&
      !["hand", "lesson_laser"].includes(tool)
    )
      return;
    this.session.armExtension(false);
    if (tool !== "lesson_laser") this.stopLaser();
    this.#guard.cancel();
    this.#editor.setCurrentTool(tool);
    this.#publish({ ...this.state, tool });
    this.#applyStyle();
  }
  setColor(color: TLDefaultColorStyle) {
    if (this.#editor.getSelectedShapeIds().length) this.editing.setColor(color);
    const style =
      this.state.tool === "highlight" ? this.#highlighter : this.#ink;
    style.color = color;
    this.#applyStyle();
  }
  setSize(size: TLDefaultSizeStyle) {
    if (this.#editor.getSelectedShapeIds().length) this.editing.setSize(size);
    const style =
      this.state.tool === "highlight" ? this.#highlighter : this.#ink;
    style.size = size;
    this.#applyStyle();
  }
  setTouchMode(touchMode: TouchMode) {
    this.#guard.setTouchMode(touchMode);
    this.#publish({ ...this.state, touchMode });
  }
  applyDevicePreferences(preferences: WorkspacePreferences) {
    if (this.isPointing()) return false;
    this.#ink = { color: preferences.penColor, size: preferences.penSize };
    this.#highlighter = {
      color: preferences.highlighterColor,
      size: preferences.highlighterSize,
    };
    this.setTouchMode(preferences.touchMode);
    this.#applyStyle();
    return true;
  }
  setTitle(title: string) {
    this.session.setTitle(title);
  }
  syncLessonState() {
    this.#publish({
      ...this.state,
      title: this.session.state.title,
      hasPrevious: this.session.state.hasPrevious,
    });
  }
  syncReadOnly() {
    this.#editor.updateInstanceState({
      isReadonly:
        activityState.getSnapshot().navigationLocked ||
        this.session.workspace.readOnly ||
        this.session.state.presentation ||
        (this.surface === "main" && this.session.state.reading),
    });
    this.#publish({ ...this.state, readOnly: this.session.workspace.readOnly });
    const presenting =
      this.session.state.presentation ||
      (this.surface === "main" && this.session.state.reading);
    if (presenting && !this.#presenting) {
      this.#presentationPrevious = this.state.tool;
      this.setTool("hand");
    }
    if (!presenting && this.#presenting)
      this.setTool(
        this.#presentationPrevious === "lesson_laser"
          ? "hand"
          : this.#presentationPrevious,
      );
    this.#presenting = presenting;
  }
  isPointing() {
    return (
      this.#editor.inputs.getIsPointing() || this.#editor.inputs.getIsPinching()
    );
  }
  currentPageId() {
    return String(this.#editor.getCurrentPageId());
  }
  scope() {
    return (
      this.session.scope() +
      ":" +
      this.surface +
      ":" +
      this.currentPageId() +
      ":" +
      this.#pageEpoch
    );
  }
  captureDocument(): TLStoreSnapshot {
    return this.#editor.store.getStoreSnapshot("document");
  }
  receiveAssets(assets: TLImageAsset[]) {
    const missing = assets.filter((a) => !this.#editor.getAsset(a.id));
    if (missing.length)
      this.#editor.run(() => this.#editor.createAssets(missing), {
        history: "ignore",
      });
  }
  getClipboardLesson(): Lesson {
    const document = this.captureDocument(),
      pageId = this.currentPageId(),
      ids = new Set(
        [...this.#editor.getCurrentPageShapeIds()].filter(
          (id) => this.#editor.getShape(id)?.type !== "interactive",
        ),
      );
    const store = Object.fromEntries(
      Object.entries(document.store).filter(
        ([id, r]) =>
          r.typeName === "document" ||
          r.typeName === "user" ||
          r.typeName === "asset" ||
          (r.typeName === "page" && id === pageId) ||
          (r.typeName === "shape" &&
            r.type !== "word-block" &&
            r.type !== "interactive" &&
            ids.has(r.id)) ||
          (r.typeName === "binding" && ids.has(r.fromId) && ids.has(r.toId)),
      ),
    );
    for (const [id, r] of Object.entries(store))
      if (r.typeName === "page")
        store[id as keyof typeof store] = {
          ...r,
          meta: {
            paper: { kind: "blank", color: "white", width: 1280, height: 960 },
          },
        } as never;
      else if (r.typeName === "shape" && r.meta.wordAnchor) {
        const { wordAnchor: _, ...meta } = r.meta;
        store[id as keyof typeof store] = { ...r, meta } as never;
      }
    return makeLesson({ ...document, store }, this.session.state.title);
  }
  undo() {
    if (
      this.state.readOnly ||
      this.session.state.presentation ||
      !this.#editor.getCanUndo()
    )
      return;
    this.#guard.cancel();
    this.saving.request();
    this.session.history(this.surface, "undo");
  }
  redo() {
    if (
      this.state.readOnly ||
      this.session.state.presentation ||
      !this.#editor.getCanRedo()
    )
      return;
    this.#guard.cancel();
    this.saving.request();
    this.session.history(this.surface, "redo");
  }
  zoom(direction: "in" | "out" | "reset" | "fit") {
    this.#guard.cancel();
    // Responsive chrome can move/resize the board before the SDK's observer
    // runs. Camera commands must use the current surface, including its offset.
    this.#editor.updateViewportScreenBounds(this.#editor.getContainer());
    if (direction === "in") this.#editor.zoomIn();
    else if (direction === "out") this.#editor.zoomOut();
    else if (direction === "fit") this.#editor.zoomToFit();
    else this.#editor.resetZoom();
  }
  getLesson(): Lesson {
    return this.session.getLesson();
  }
  restore(candidate: Lesson, pdfPasswords?: Readonly<Record<string, string>>) {
    return this.session.restore(candidate, pdfPasswords);
  }
  previousLesson() {
    return this.session.previousLesson();
  }
  restorePrevious() {
    return this.session.restorePrevious();
  }
  applyStoredDocument(document: TLStoreSnapshot) {
    this.#suspended = true;
    this.#pageEpoch++;
    try {
      loadSnapshot(this.#editor.store, { document });
      this.#editor.setCurrentPage(
        (this.surface === "main"
          ? this.session.workspace.lesson.pageId
          : this.session.workspace.lesson.scratchpad.pageId) as TLPageId,
      );
      this.#editor.clearHistory();
      this.#cameraPage = this.currentPageId();
      const camera = this.session.camera(this.surface, this.#cameraPage);
      if (camera) this.#editor.setCamera(camera);
      else this.zoom("fit");
      this.syncLessonState();
      this.syncReadOnly();
    } finally {
      this.#suspended = false;
    }
  }
  cancel() {
    this.stopLaser();
    this.session.armExtension(false);
    this.#guard.cancel();
    if (this.editing.state.mathPanel) this.editing.closeMath();
    this.#editor
      .getContainer()
      .dispatchEvent(new Event("lessonboard:interactive-cancel"));
    if (this.#editor.getEditingShapeId()) this.editing.textDone();
  }
  startLaser() {
    if (this.session.state.laser === this.surface) return;
    this.session.engines
      .get(this.session.state.laser ?? this.surface)
      ?.stopLaser();
    this.#guard.cancel();
    this.#laserPrevious = this.state.tool;
    this.session.setLaser(this.surface);
    this.#editor.setCurrentTool("lesson_laser");
    this.#editor.focus();
  }
  stopLaser() {
    if (this.session.state.laser !== this.surface) return;
    this.session.setLaser(null);
    this.#editor.setCurrentTool(
      this.session.state.presentation || this.state.readOnly
        ? "hand"
        : this.#laserPrevious === "lesson_laser"
          ? "draw"
          : this.#laserPrevious,
    );
  }
  escape() {
    if (this.session.state.laser) {
      this.stopLaser();
      return;
    }
    if (this.session.state.presentation) {
      this.session.setPresentation(false);
      return;
    }
    this.cancel();
    this.editing.deselect();
  }
  clearSurface() {
    if (
      this.surface !== "scratchpad" ||
      this.session.workspace.readOnly ||
      this.#editor.getIsReadonly()
    )
      return;
    this.session.activate(this.surface);
    this.cancel();
    this.session.retireSources(this.#editor.getAssets().map((a) => a.id));
    this.#editor.markHistoryStoppingPoint("Clear scratchpad");
    this.#editor.run(
      () =>
        this.#editor.deleteShapes([...this.#editor.getCurrentPageShapeIds()]),
      { ignoreShapeLock: true },
    );
  }
  resetView() {
    this.cancel();
    this.#editor.setCamera({ x: 0, y: 0, z: 1 });
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#pageEpoch++;
    this.editing.close();
    this.#guard.dispose();
    for (const dispose of this.#dispose) dispose();
    this.#listeners.clear();
  }
}
