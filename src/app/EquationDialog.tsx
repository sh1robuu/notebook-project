import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useId,
} from "react";
import type { BoardEngine } from "../modules/board/engine.ts";
export function EquationDialog({ engine }: { engine: BoardEngine }) {
  const id = useId();
  const c = engine.editing,
    state = useSyncExternalStore(c.subscribe, c.getSnapshot),
    dialog = useRef<HTMLDialogElement>(null),
    [source, setSource] = useState("");
  useEffect(() => {
    if (state.equation) {
      setSource(state.equation.source);
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [state.equation]);
  return (
    <dialog
      ref={dialog}
      className="context-panel context-panel-edge equation-panel"
      aria-labelledby={id + "-title"}
      onCancel={(e) => {
        e.preventDefault();
        c.closeEquation();
      }}
    >
      <header className="context-panel-heading">
        <h2 id={id + "-title"}>Editable equation</h2>
      </header>
      <label htmlFor={id + "-source"}>LaTeX source</label>
      <textarea
        id={id + "-source"}
        aria-label="LaTeX source"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        maxLength={4000}
        rows={5}
        spellCheck={false}
        autoFocus
      />
      <p>
        Source stays editable. Unsupported LaTeX is kept with a visible
        rendering error. Local KaTeX supports its documented subset.
      </p>
      {state.message ? <p role="status">{state.message}</p> : null}
      <div className="dialog-actions">
        <button onClick={() => c.closeEquation()}>Cancel</button>
        <button className="primary" onClick={() => c.saveEquation(source)}>
          Save equation
        </button>
      </div>
    </dialog>
  );
}
