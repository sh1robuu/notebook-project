import type { Editor } from "tldraw";
const budgets = new WeakMap<Editor, () => number>();
const mathBudgets = new WeakMap<Editor, () => boolean>();
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
export function bindMathCapacity(editor: Editor, withinLimit: () => boolean) {
  mathBudgets.set(editor, withinLimit);
  return () => {
    mathBudgets.delete(editor);
  };
}
export function withinCapacity(editor: Editor) {
  return (
    remainingCapacity(editor) >= 0 && (mathBudgets.get(editor)?.() ?? true)
  );
}
export function canCreateShapes(
  editor: Editor,
  shapes: Parameters<Editor["canCreateShapes"]>[0],
) {
  return (
    editor.canCreateShapes(shapes) && shapes.length <= remainingCapacity(editor)
  );
}
