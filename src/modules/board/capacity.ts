import type { Editor } from "tldraw";
const budgets = new WeakMap<Editor, () => number>();
/** Composes the public native capacity query with the lesson-wide remaining budget. */
export function bindCapacity(editor: Editor, remaining: () => number) {
  budgets.set(editor, remaining);
  return () => {
    budgets.delete(editor);
  };
}
export function remainingCapacity(editor: Editor) {
  return budgets.get(editor)?.() ?? Infinity;
}
export function withinCapacity(editor: Editor) {
  return remainingCapacity(editor) >= 0;
}
export function canCreateShapes(
  editor: Editor,
  shapes: Parameters<Editor["canCreateShapes"]>[0],
) {
  return (
    editor.canCreateShapes(shapes) && shapes.length <= remainingCapacity(editor)
  );
}
