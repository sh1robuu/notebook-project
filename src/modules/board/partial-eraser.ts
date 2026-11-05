import {
  Box,
  StateNode,
  createShapeId,
  getIndexBetween,
  getPointsFromDrawSegments,
  getDisplayValues,
} from "tldraw";
import type {
  TLDrawShape,
  TLHighlightShape,
  TLPointerEventInfo,
  DrawShapeUtil,
  HighlightShapeUtil,
} from "tldraw";
import { b64Vecs } from "@tldraw/tlschema";
import { splitStroke } from "./geometry.ts";
import type { InkPoint, Point } from "./geometry.ts";
import { canCreateShapes } from "./capacity.ts";
type InkShape = TLDrawShape | TLHighlightShape;

/** Rewrites native SDK ink records inside native SDK history, with no second scene. */
export class PartialEraserTool extends StateNode {
  static override id = "partial_eraser";
  #mark: string | undefined;
  #previous: Point | undefined;
  #padding = 40;
  override onEnter() {
    this.editor.setCursor({ type: "cross", rotation: 0 });
  }
  override onPointerDown(info: TLPointerEventInfo) {
    if (this.editor.getInstanceState().isReadonly || info.button !== 0) return;
    this.#mark = this.editor.markHistoryStoppingPoint("partial erase");
    this.#padding = 0;
    for (const id of this.editor.getCurrentPageShapeIds()) {
      const shape = this.editor.getShape(id);
      if (shape?.type === "draw" || shape?.type === "highlight")
        this.#padding = Math.max(
          this.#padding,
          this.#strokeWidth(shape) *
            shape.props.scale *
            Math.max(
              Math.abs(shape.props.scaleX),
              Math.abs(shape.props.scaleY),
            ),
        );
    }
    this.#previous = this.editor.inputs.getCurrentPagePoint().clone();
    this.#erase(this.#previous);
  }
  override onPointerMove() {
    if (this.#mark) this.#erase(this.editor.inputs.getCurrentPagePoint());
  }
  override onPointerUp() {
    if (this.#mark) {
      this.#erase(this.editor.inputs.getCurrentPagePoint());
      if (this.#mark) this.editor.squashToMark(this.#mark);
    }
    this.#mark = undefined;
    this.#previous = undefined;
  }
  override onCancel() {
    this.#cancel();
  }
  override onInterrupt() {
    this.#cancel();
  }
  override onExit() {
    this.#cancel();
  }
  #cancel() {
    if (this.#mark) this.editor.bailToMark(this.#mark);
    this.#mark = undefined;
    this.#previous = undefined;
  }
  #erase(point: Point) {
    const previous = this.#previous ?? point,
      radius = 12 / this.editor.getZoomLevel();
    const margin = radius + this.#padding;
    const bounds = new Box(
      Math.min(previous.x, point.x) - margin,
      Math.min(previous.y, point.y) - margin,
      Math.abs(point.x - previous.x) + 2 * margin,
      Math.abs(point.y - previous.y) + 2 * margin,
    );
    const ids = this.editor.getShapeIdsInsideBounds(bounds);
    for (const id of ids) {
      const shape = this.editor.getShape(id);
      if (
        !shape ||
        shape.isLocked ||
        (shape.type !== "draw" && shape.type !== "highlight")
      )
        continue;
      this.#cut(shape, previous, point, radius);
      if (!this.#mark) return;
    }
    this.#previous = { ...point };
  }
  #strokeWidth(shape: InkShape) {
    return shape.type === "draw"
      ? getDisplayValues(this.editor.getShapeUtil<DrawShapeUtil>("draw"), shape)
          .strokeWidth
      : getDisplayValues(
          this.editor.getShapeUtil<HighlightShapeUtil>("highlight"),
          shape,
        ).strokeWidth;
  }
  #cut(shape: InkShape, a: Point, b: Point, radius: number) {
    const matrix = this.editor.getShapePageTransform(shape),
      inverse = matrix.clone().invert();
    const sx = shape.props.scaleX,
      sy = shape.props.scaleY;
    // Padding keeps round caps from protruding into the erased centerline gap.
    const width = this.#strokeWidth(shape);
    const points = getPointsFromDrawSegments(
      shape.props.segments,
      shape.props.scaleX,
      shape.props.scaleY,
    ).map((p) => {
      const w = matrix.applyToPoint(p);
      return { x: w.x, y: w.y, z: p.z ?? 0.5 };
    });
    const cut = splitStroke(
      points,
      { a, b },
      radius +
        (width * shape.props.scale * Math.max(Math.abs(sx), Math.abs(sy))) / 2,
    );
    if (!cut.changed) return;
    const fragments: InkPoint[][] = cut.fragments.map((fragment) =>
      fragment.map((p) => {
        const l = inverse.applyToPoint(p);
        return { x: l.x / sx, y: l.y / sy, z: p.z };
      }),
    );
    const siblings = this.editor.getSortedChildIdsForParent(shape.parentId),
      at = siblings.indexOf(shape.id);
    const upper = siblings
      .slice(at + 1)
      .map((id) => this.editor.getShape(id)!.index)
      .find((index) => index > shape.index);
    let previousIndex = shape.index;
    const next = fragments.map((points, i) => ({
      ...shape,
      id: i === 0 ? shape.id : createShapeId(),
      index:
        i === 0
          ? shape.index
          : (previousIndex = getIndexBetween(previousIndex, upper)),
      props: {
        ...shape.props,
        segments: [
          {
            type: "free" as const,
            path: b64Vecs.encodePoints(points, 3),
            dim: 3 as const,
          },
        ],
        ...(shape.type === "draw"
          ? { isClosed: false, fill: "none" as const }
          : {}),
      },
    }));
    if (
      !canCreateShapes(
        this.editor,
        next.slice(1).map((s) => s.id),
      )
    ) {
      this.#cancel();
      return;
    }
    if (!next.length) this.editor.deleteShapes([shape.id]);
    else {
      this.editor.updateShapes([next[0]]);
      if (next.length > 1) this.editor.createShapes(next.slice(1));
    }
  }
}
