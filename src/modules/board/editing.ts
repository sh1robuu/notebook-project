import {
  DefaultColorStyle,
  DefaultSizeStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultTextAlignStyle,
  GeoShapeGeoStyle,
  DefaultDashStyle,
  createShapeId,
  react,
  getPointsFromDrawSegments,
  toRichText,
} from "tldraw";
import type {
  Editor,
  TLShape,
  TLShapeId,
  TLImageAsset,
  TLDefaultColorStyle,
  TLDefaultSizeStyle,
  TLDefaultFontStyle,
  TLDefaultFillStyle,
  TLGeoShape,
} from "tldraw";
import { recognizeLine } from "./recognition.ts";
import { prepareImage } from "../media/images.ts";
import { MAX_TOTAL_IMAGE_BYTES } from "../media/image-format.ts";
import { checkAssetBudget } from "../media/asset-budget.ts";
import { canCreateShapes, withinCapacity } from "./capacity.ts";
import type { MathFigure, MathFigureProps } from "../math/descriptor.ts";

type MathTool = "graph" | "variation" | "calculator";
export type MathPanelRequest = {
  kind: MathTool;
  scope: string;
  shape?: { id: TLShapeId; props: MathFigureProps };
};
export type EditingState = {
  selected: readonly TLShape[];
  objects: number;
  ink: number;
  isTextEditing: boolean;
  equation: { id: TLShapeId | null; source: string } | null;
  mathPanel: MathPanelRequest | null;
  message: string;
  busy: boolean;
  snap: boolean;
  version: number;
};
export class EditingController {
  private readonly editor: Editor;
  #begin: () => void;
  #scope: () => string;
  #listeners = new Set<() => void>();
  #dispose: (() => void)[] = [];
  state: EditingState = {
    selected: [],
    objects: 0,
    ink: 0,
    isTextEditing: false,
    equation: null,
    mathPanel: null,
    message: "",
    busy: false,
    snap: false,
    version: 0,
  };
  constructor(editor: Editor, begin: () => void, scope: () => string) {
    this.editor = editor;
    this.#begin = begin;
    this.#scope = scope;
    editor.setStyleForNextShapes(DefaultFontStyle, "sans");
    const draw = editor.store.query.ids("shape", () => ({
        type: { eq: "draw" },
      })),
      highlight = editor.store.query.ids("shape", () => ({
        type: { eq: "highlight" },
      }));
    this.#dispose.push(
      react("editing controls", () => {
        const selected = editor.getSelectedShapes(),
          pageIds = editor.getCurrentPageShapeIds();
        let ink = 0;
        for (const id of draw.get()) if (pageIds.has(id)) ink++;
        for (const id of highlight.get()) if (pageIds.has(id)) ink++;
        const objects = pageIds.size - ink;
        const editing = editor.getEditingShape();
        const isTextEditing =
          editing?.type === "text" || !!editor.getRichTextEditor();
        const snap = editor.user.getIsSnapMode();
        const previous = this.state;
        if (
          selected.length !== previous.selected.length ||
          selected.some((shape, index) => shape !== previous.selected[index]) ||
          objects !== previous.objects ||
          ink !== previous.ink ||
          isTextEditing !== previous.isTextEditing ||
          snap !== previous.snap
        ) {
          this.#publish({
            selected,
            objects,
            ink,
            isTextEditing,
            snap,
            version: this.state.version + 1,
          });
        }
      }),
    );
    const onEquation = (e: Event) => {
      const shape = editor.getShape((e as CustomEvent).detail);
      if (shape?.type === "equation") this.editEquation(shape.id);
    };
    const onMathFigure = (event: Event) =>
      this.editMathFigure((event as CustomEvent<TLShapeId>).detail);
    const container = editor.getContainer();
    container.addEventListener("lessonboard:equation", onEquation);
    container.addEventListener("lessonboard:math-figure", onMathFigure);
    this.#dispose.push(() =>
      editor
        .getContainer()
        .removeEventListener("lessonboard:equation", onEquation),
    );
    this.#dispose.push(() =>
      container.removeEventListener("lessonboard:math-figure", onMathFigure),
    );
  }
  subscribe = (fn: () => void) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  focus() {
    this.editor.focus();
  }
  onContextMenu(open: (point: { x: number; y: number }) => void) {
    const host = this.editor.getContainer();
    const handle = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('input,textarea,[contenteditable="true"]')
      )
        return;
      event.preventDefault();
      const hit = this.editor.getShapeAtPoint(
        this.editor.screenToPage({ x: event.clientX, y: event.clientY }),
        { hitInside: true },
      );
      if (hit && !this.editor.getSelectedShapeIds().includes(hit.id))
        this.editor.select(hit.id);
      open({ x: event.clientX, y: event.clientY });
    };
    host.addEventListener("contextmenu", handle);
    return () => host.removeEventListener("contextmenu", handle);
  }
  #publish(next: Partial<EditingState>) {
    this.state = { ...this.state, ...next };
    for (const fn of this.#listeners) fn();
  }
  notify(message: string) {
    this.#publish({ message });
  }
  command(name: string, fn: () => void): boolean {
    if (this.editor.getIsReadonly()) return false;
    this.editor.complete();
    this.#begin();
    const mark = this.editor.markHistoryStoppingPoint(name);
    try {
      this.editor.run(fn);
      if (!withinCapacity(this.editor))
        throw new Error(
          "Lesson capacity reached. The operation was cancelled without changing work.",
        );
      this.editor.squashToMark(mark);
      return true;
    } catch (error) {
      this.editor.bailToMark(mark);
      this.notify(
        error instanceof Error ? error.message : "The operation failed.",
      );
      return false;
    }
  }
  selectAll() {
    this.editor.setCurrentTool("select");
    this.editor.selectAll();
  }
  deselect() {
    this.editor.complete();
    this.editor.setEditingShape(null);
    this.editor.selectNone();
  }
  delete() {
    this.command("delete objects", () =>
      this.editor.deleteShapes(this.editor.getSelectedShapeIds()),
    );
  }
  duplicate() {
    this.command("duplicate objects", () =>
      this.editor.duplicateShapes(this.editor.getSelectedShapeIds(), {
        x: 24,
        y: 24,
      }),
    );
  }
  group() {
    this.command("group objects", () =>
      this.editor.groupShapes(this.editor.getSelectedShapeIds()),
    );
  }
  ungroup() {
    this.command("ungroup objects", () =>
      this.editor.ungroupShapes(this.editor.getSelectedShapeIds()),
    );
  }
  arrange(front: boolean) {
    this.command("stack order", () =>
      front
        ? this.editor.bringToFront(this.editor.getSelectedShapeIds())
        : this.editor.sendToBack(this.editor.getSelectedShapeIds()),
    );
  }
  align(operation: "left" | "top" | "center-horizontal" | "center-vertical") {
    this.command("align objects", () =>
      this.editor.alignShapes(this.editor.getSelectedShapeIds(), operation),
    );
  }
  setSnap(snap: boolean) {
    this.editor.user.updateUserPreferences({ isSnapMode: snap });
  }
  geo(geo: TLGeoShape["props"]["geo"]) {
    this.editor.setStyleForNextShapes(GeoShapeGeoStyle, geo);
    this.editor.setStyleForNextShapes(DefaultDashStyle, "solid");
    this.editor.setCurrentTool("geo");
  }
  setColor(color: TLDefaultColorStyle) {
    this.command("object color", () =>
      this.editor.setStyleForSelectedShapes(DefaultColorStyle, color),
    );
  }
  setSize(size: TLDefaultSizeStyle) {
    this.command("object width", () =>
      this.editor.setStyleForSelectedShapes(DefaultSizeStyle, size),
    );
  }
  setFill(fill: TLDefaultFillStyle) {
    this.command("object fill", () =>
      this.editor.setStyleForSelectedShapes(DefaultFillStyle, fill),
    );
  }
  setFillColor(color: string) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    this.command("fill color", () =>
      this.editor.updateShapes(
        this.editor
          .getSelectedShapes()
          .filter((s) => s.type === "geo")
          .map((s) => ({
            id: s.id,
            type: s.type,
            meta: { ...s.meta, fillColor: color },
            props: { fill: "solid" },
          })),
      ),
    );
  }
  setOpacity(opacity: number) {
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return;
    this.command("object opacity", () =>
      this.editor.setOpacityForSelectedShapes(opacity),
    );
  }
  setFont(font: TLDefaultFontStyle) {
    this.editor.setStyleForNextShapes(DefaultFontStyle, font);
    this.command("font family", () =>
      this.editor.setStyleForSelectedShapes(DefaultFontStyle, font),
    );
  }
  setTextAlign(align: "start" | "middle" | "end") {
    this.command("text alignment", () =>
      this.editor.setStyleForSelectedShapes(DefaultTextAlignStyle, align),
    );
  }
  format(mark: "bold" | "italic" | "underline" | "highlight") {
    const rte = this.editor.getRichTextEditor();
    if (rte) {
      rte
        .chain()
        .focus()
        .toggleMark(
          mark,
          mark === "highlight" ? { color: "#fff2a8" } : undefined,
        )
        .run();
      return;
    }
    this.command("text formatting", () => {
      for (const shape of this.editor.getSelectedShapes())
        if (shape.type === "text") {
          const rich = structuredClone(shape.props.richText);
          let all = true;
          const visit = (node: any, fn: (n: any) => void) => {
            if (node.type === "text") fn(node);
            node.content?.forEach((n: any) => visit(n, fn));
          };
          visit(rich, (n) => {
            if (!n.marks?.some((m: any) => m.type === mark)) all = false;
          });
          visit(rich, (n) => {
            n.marks = (n.marks ?? []).filter((m: any) => m.type !== mark);
            if (!all)
              n.marks.push({
                type: mark,
                ...(mark === "highlight"
                  ? { attrs: { color: "#fff2a8" } }
                  : {}),
              });
          });
          this.editor.updateShape({
            id: shape.id,
            type: "text",
            props: { richText: rich },
          });
        }
    });
  }
  setFontSize(px: number) {
    if (!Number.isFinite(px) || px < 8 || px > 256) return;
    this.command("text size", () => {
      for (const s of this.editor.getSelectedShapes())
        if (s.type === "text") {
          const sizes = { s: 18, m: 24, l: 36, xl: 44 };
          this.editor.updateShape({
            id: s.id,
            type: s.type,
            props: { scale: px / sizes[s.props.size] },
          });
        }
    });
  }
  geometry(
    key: "x" | "y" | "w" | "h" | "rotation",
    value: number,
    lockAspect = true,
  ) {
    if (
      !Number.isFinite(value) ||
      Math.abs(value) > 100000 ||
      ((key === "w" || key === "h") && value < 1)
    )
      return;
    this.command("object geometry", () => {
      const shapes = this.editor.getSelectedShapes(),
        bounds = this.editor.getSelectionPageBounds();
      if (!bounds || !shapes.length) return;
      if (key === "x" || key === "y") {
        this.editor.nudgeShapes(shapes, {
          x: key === "x" ? value - bounds.x : 0,
          y: key === "y" ? value - bounds.y : 0,
        });
        return;
      }
      if (key === "rotation") {
        const current = shapes.length === 1 ? shapes[0].rotation : 0;
        this.editor.rotateShapesBy(shapes, (value * Math.PI) / 180 - current);
        return;
      }
      if (shapes.length === 1 && shapes[0].type === "text" && key === "w") {
        const s = shapes[0];
        this.editor.updateShape({
          id: s.id,
          type: s.type,
          props: { w: value / s.props.scale, autoSize: false },
        });
        return;
      }
      let sx = key === "w" ? value / Math.max(bounds.w, 1) : 1,
        sy = key === "h" ? value / Math.max(bounds.h, 1) : 1;
      if (lockAspect && shapes.some((s) => s.type === "image"))
        sx = sy = key === "w" ? sx : sy;
      for (const s of shapes)
        this.editor.resizeShape(
          s,
          { x: sx, y: sy },
          { scaleOrigin: bounds.point, scaleAxisRotation: 0 },
        );
    });
  }
  bounds() {
    return this.editor.getSelectionPageBounds();
  }
  textDone() {
    const id = this.editor.getEditingShapeId();
    this.editor.complete();
    this.editor.setEditingShape(null);
    if (id) this.editor.select(id);
  }
  newEquation() {
    if (!this.editor.getIsReadonly()) {
      this.editor.complete();
      this.#publish({ equation: { id: null, source: "x^2" } });
    }
  }
  editEquation(id?: TLShapeId) {
    if (this.editor.getIsReadonly()) return;
    const shape = this.editor.getShape(
      id ?? this.editor.getOnlySelectedShapeId()!,
    );
    if (shape?.type === "equation")
      this.#publish({ equation: { id: shape.id, source: shape.props.source } });
  }
  closeEquation() {
    this.#publish({ equation: null });
  }
  saveEquation(source: string) {
    if (source.length > 4000) {
      this.notify("Equation source exceeds 4,000 characters.");
      return;
    }
    const editing = this.state.equation;
    if (!editing) return;
    this.#publish({ equation: { ...editing, source } });
    if (!editing.id && !canCreateShapes(this.editor, [createShapeId()])) {
      this.notify(
        "The page object limit has been reached. Equation source is kept.",
      );
      return;
    }
    const success = this.command("equation source", () => {
      if (editing.id)
        this.editor.updateShape({
          id: editing.id,
          type: "equation",
          props: { source },
        });
      else {
        const id = createShapeId(),
          p = this.editor.getViewportPageBounds().center;
        this.editor.createShape({
          id,
          type: "equation",
          x: p.x - 180,
          y: p.y - 60,
          props: { source },
        });
        if (!this.editor.getShape(id))
          throw new Error(
            "The page object limit has been reached. Equation source is kept.",
          );
        this.editor.setCurrentTool("select");
        this.editor.select(id);
      }
    });
    if (success) this.closeEquation();
  }
  openMath(kind: MathTool) {
    if (kind !== "calculator" && this.editor.getIsReadonly()) return;
    this.editor.complete();
    this.#publish({ mathPanel: { kind, scope: this.#scope() }, message: "" });
  }
  editMathFigure(id = this.editor.getOnlySelectedShapeId()) {
    if (
      !id ||
      this.editor.getIsReadonly() ||
      !this.editor.getCurrentPageShapeIds().has(id)
    )
      return;
    const shape = this.editor.getShape(id);
    if (shape?.type !== "math-figure" || shape.isLocked) return;
    this.#publish({
      mathPanel: {
        kind: shape.props.figure.kind,
        scope: this.#scope(),
        shape: { id, props: shape.props },
      },
      message: "",
    });
  }
  closeMath() {
    this.#publish({ mathPanel: null });
  }
  saveMath(figure: MathFigure, dimensions: { w: number; h: number }) {
    const request = this.state.mathPanel;
    if (
      !request ||
      request.scope !== this.#scope() ||
      request.kind !== figure.kind ||
      this.editor.getIsReadonly()
    )
      return false;
    const previous = request.shape;
    return this.command("save math figure", () => {
      if (previous) {
        const shape = this.editor.getShape(previous.id);
        if (
          shape?.type !== "math-figure" ||
          shape.isLocked ||
          shape.props !== previous.props ||
          !this.editor.getCurrentPageShapeIds().has(previous.id)
        )
          throw new Error(
            "This figure changed while the panel was open. Reopen it to edit the latest version.",
          );
        this.editor.updateShape({
          id: previous.id,
          type: "math-figure",
          props: { figure },
        });
        return;
      }
      const id = createShapeId();
      if (!canCreateShapes(this.editor, [id]))
        throw new Error("The page object limit has been reached.");
      const center = this.editor.getViewportPageBounds().center;
      this.editor.createShape({
        id,
        type: "math-figure",
        x: center.x - dimensions.w / 2,
        y: center.y - dimensions.h / 2,
        props: { ...dimensions, figure },
      });
      if (!this.editor.getShape(id))
        throw new Error("The figure could not be inserted.");
      this.editor.setCurrentTool("select");
      this.editor.select(id);
    });
  }
  insertCalculation(text: string) {
    const request = this.state.mathPanel;
    if (
      request?.kind !== "calculator" ||
      request.scope !== this.#scope() ||
      this.editor.getIsReadonly()
    )
      return false;
    return this.command("insert calculation", () => {
      const id = createShapeId();
      if (!canCreateShapes(this.editor, [id]))
        throw new Error("The page object limit has been reached.");
      const center = this.editor.getViewportPageBounds().center;
      this.editor.createShape({
        id,
        type: "text",
        x: center.x - 160,
        y: center.y - 40,
        props: {
          richText: toRichText(text),
          w: 320,
          autoSize: false,
          font: "sans",
        },
      });
      if (!this.editor.getShape(id))
        throw new Error("The result could not be inserted.");
      this.editor.setCurrentTool("select");
      this.editor.select(id);
    });
  }
  async importImages(
    files: File[],
    point = this.editor.getViewportPageBounds().center,
  ) {
    if (this.editor.getIsReadonly() || !files.length) return;
    if (files.length > 12) {
      this.notify("Import at most 12 images at once.");
      return;
    }
    if (
      files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_IMAGE_BYTES
    ) {
      this.notify("Image files exceed the 50 MB total limit.");
      return;
    }
    const scope = this.#scope();
    this.#publish({ busy: true, message: "Checking local images…" });
    try {
      const assets: TLImageAsset[] = [];
      for (const file of files) assets.push(await prepareImage(file));
      if (scope !== this.#scope())
        throw new Error("The active lesson changed. Images were not inserted.");
      checkAssetBudget(this.editor, assets);
      if (
        !canCreateShapes(
          this.editor,
          assets.map(() => createShapeId()),
        )
      )
        throw new Error("The page object limit has been reached.");
      const success = this.command("import local images", () => {
        this.editor.createAssets(
          assets.filter((a) => !this.editor.getAsset(a.id)),
        );
        const ids: TLShapeId[] = [];
        assets.forEach((a, i) => {
          const id = createShapeId(),
            scale = Math.min(1, 600 / a.props.w, 500 / a.props.h);
          ids.push(id);
          this.editor.createShape({
            id,
            type: "image",
            x: point.x + i * 24,
            y: point.y + i * 24,
            props: {
              w: a.props.w * scale,
              h: a.props.h * scale,
              assetId: a.id,
              playing: false,
              altText: a.props.name,
            },
          });
          if (!this.editor.getShape(id))
            throw new Error("Image insertion failed. Original work was kept.");
        });
        this.editor.setCurrentTool("select");
        this.editor.select(...ids);
      });
      if (success)
        this.notify(
          "Local images inserted. Original bytes stay on this device.",
        );
    } catch (error) {
      this.notify(
        error instanceof Error ? error.message : "Image import failed.",
      );
    } finally {
      this.#publish({ busy: false });
    }
  }
  straighten() {
    const shape = this.editor.getOnlySelectedShape();
    if (
      shape?.type !== "draw" ||
      shape.parentId !== this.editor.getCurrentPageId()
    ) {
      this.notify("Select one ungrouped ink stroke to straighten.");
      return;
    }
    const matrix = this.editor.getShapePageTransform(shape),
      points = getPointsFromDrawSegments(
        shape.props.segments,
        shape.props.scaleX,
        shape.props.scaleY,
      ).map((p) => matrix.applyToPoint(p));
    const line = recognizeLine(points);
    if (!line) {
      this.notify(
        "This stroke is not a near-straight line. Original ink was kept.",
      );
      return;
    }
    this.command("straighten ink", () => {
      const id = createShapeId();
      this.editor.deleteShapes([shape.id]);
      this.editor.createShape({
        id,
        type: "line",
        x: line.start.x,
        y: line.start.y,
        index: shape.index,
        opacity: shape.opacity,
        meta: shape.meta,
        props: {
          color: shape.props.color,
          size: shape.props.size,
          dash: "solid",
          scale: shape.props.scale,
          points: {
            a1: { id: "a1", index: "a1" as never, x: 0, y: 0 },
            a2: {
              id: "a2",
              index: "a2" as never,
              x: line.end.x - line.start.x,
              y: line.end.y - line.start.y,
            },
          },
        },
      });
      if (!this.editor.getShape(id))
        throw new Error("Line correction failed. Original ink was kept.");
      this.editor.select(id);
    });
  }
  close() {
    for (const dispose of this.#dispose) dispose();
    this.#listeners.clear();
  }
}
