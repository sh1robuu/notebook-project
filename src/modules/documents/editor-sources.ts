import type { Editor } from "tldraw";
import type { DocumentSources } from "./sources.ts";
const sources = new WeakMap<Editor, () => DocumentSources>();
/** SDK SVG export creates a new React root; bind source ownership to the
 * editor lifetime so bytes are available there without duplicating them.
 */
export function bindWordSources(editor: Editor, read: () => DocumentSources) {
  sources.set(editor, read);
  return () => {
    if (sources.get(editor) === read) sources.delete(editor);
  };
}
export function editorWordSources(
  editor: Editor,
  fallback: DocumentSources,
): DocumentSources {
  return sources.get(editor)?.() ?? fallback;
}
