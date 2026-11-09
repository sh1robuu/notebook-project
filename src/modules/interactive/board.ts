import { createShapeId } from "tldraw";
import type { TLShapeId } from "tldraw";
import type { BoardEngine } from "../board/engine.ts";
import { canCreateShapes } from "../board/capacity.ts";
import { validateInteractiveMaterial } from "./model.ts";
import type { InteractiveMaterial } from "./model.ts";
import type { InteractiveSource } from "./sources.ts";

export function scopedInteractive(
  engine: BoardEngine,
  scope: string,
  id: TLShapeId,
) {
  const editor = engine.pages.editor;
  if (
    engine.scope() !== scope ||
    engine.session.state.active !== engine.surface
  )
    return;
  const shape = editor.getShape(id);
  if (shape?.type === "interactive" && editor.getCurrentPageShapeIds().has(id))
    return shape;
}

export function insertInteractive(
  engine: BoardEngine,
  scope: string,
  material: InteractiveMaterial,
  sources: readonly InteractiveSource[],
) {
  const editor = engine.pages.editor;
  if (
    engine.scope() !== scope ||
    engine.session.state.active !== engine.surface ||
    editor.getIsReadonly()
  )
    return false;
  const id = createShapeId();
  if (!canCreateShapes(editor, [id]))
    throw new Error("Trang đã đạt giới hạn số đối tượng.");
  validateInteractiveMaterial(material);
  return engine.session.withInteractiveSources(sources, () =>
    engine.editing.command("Insert interactive material", () => {
      const center = editor.getViewportPageBounds().center;
      editor.createShape({
        id,
        type: "interactive",
        x: center.x - 240,
        y: center.y - 150,
        props: { w: 480, h: 300, material },
      });
      if (!editor.getShape(id)) throw new Error("Không thể chèn mô phỏng.");
      editor.setCurrentTool("select");
      editor.select(id);
    }),
  );
}

export function changeInteractive(
  engine: BoardEngine,
  scope: string,
  id: TLShapeId,
  expected: InteractiveMaterial,
  next: InteractiveMaterial,
  sources: readonly InteractiveSource[] = [],
) {
  const shape = scopedInteractive(engine, scope, id);
  const editor = engine.pages.editor;
  if (
    !shape ||
    shape.isLocked ||
    shape.props.material !== expected ||
    editor.getIsReadonly()
  )
    return false;
  validateInteractiveMaterial(next);
  if (next.sourceId !== expected.sourceId || next.kind !== expected.kind)
    throw new Error(
      "Interactive source identity cannot be replaced by a runtime edit.",
    );
  const update = () =>
    engine.editing.command("Edit interactive material", () =>
      editor.updateShape({
        id,
        type: "interactive",
        props: { material: next },
      }),
    );
  return sources.length
    ? engine.session.withInteractiveSources(sources, update)
    : update();
}
