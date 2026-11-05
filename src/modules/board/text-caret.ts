import type { Editor } from "tldraw";
/** Tell the SDK when keyboard navigation has deliberately placed the real caret.
 * Its initial 100 ms focus recovery otherwise resets a newly edited label to end.
 * The public place-caret event preserves that intent without replacing native text.
 */
export function installTextCaret(element: HTMLElement, editor: Editor) {
  const abort = new AbortController();
  element.addEventListener(
    "keyup",
    (event) => {
      if (
        ![
          "Home",
          "End",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(event.key) ||
        event.isComposing
      )
        return;
      const target =
        event.target instanceof Element
          ? event.target.closest('[contenteditable="true"]')
          : null;
      const id = editor.getEditingShapeId(),
        selection = element.ownerDocument.getSelection();
      if (
        !id ||
        !editor.getRichTextEditor() ||
        !target ||
        !selection?.rangeCount ||
        !target.contains(selection.anchorNode)
      )
        return;
      const bounds = selection.getRangeAt(0).getBoundingClientRect();
      editor.emit("place-caret", {
        shapeId: id,
        point: { x: bounds.x, y: bounds.y },
      });
    },
    { signal: abort.signal },
  );
  return () => abort.abort();
}
