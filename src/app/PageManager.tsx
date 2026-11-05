import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useValue } from "tldraw";
import type { TLPageId } from "tldraw";
import type { BoardEngine } from "../modules/board/engine.ts";
import { validatePaper } from "../modules/workspace/lesson-view.ts";
export function PageManager({
  engine,
  children,
}: {
  engine: BoardEngine;
  children?: ReactNode;
}) {
  const e = engine.pages.editor,
    session = engine.session;
  const ui = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const pages = useValue("lesson pages", () => e.getPages(), [e]),
    current = useValue("selected page", () => e.getCurrentPage(), [e]);
  const i = pages.findIndex((p) => p.id === current.id),
    paper = validatePaper(current.meta.paper),
    readonly = useValue("page writable", () => e.getIsReadonly(), [e]);
  const [list, setList] = useState(false),
    [scroll, setScroll] = useState(0),
    [deleting, setDeleting] = useState<TLPageId | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deleting) dialog.current?.showModal();
    else dialog.current?.close();
  }, [deleting]);
  const hidden = ui.view.hidden.pages || ui.presentation || ui.laser !== null;
  return (
    <>
      <nav className="page-navigation" aria-label="Lesson pages">
        <button
          aria-label="Previous page"
          disabled={i === 0}
          onClick={() => engine.pages.step(-1)}
        >
          ←
        </button>
        <span data-testid="page-position" aria-live="polite">
          Page {i + 1} of {pages.length}
        </span>
        <button
          aria-label="Next page"
          disabled={i === pages.length - 1}
          onClick={() => engine.pages.step(1)}
        >
          →
        </button>
        <label>
          Go to{" "}
          <select
            aria-label="Jump to page"
            value={current.id}
            onChange={(ev) =>
              engine.pages.navigate(ev.target.value as TLPageId)
            }
          >
            {pages.map((p, j) => (
              <option key={p.id} value={p.id}>
                {j + 1} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <button aria-expanded={list} onClick={() => setList(!list)}>
          {list ? "Hide page list" : "Show page list"}
        </button>
        {!hidden ? (
          <>
            <button
              disabled={readonly || pages.length >= 200}
              onClick={() => engine.pages.add()}
            >
              Add page
            </button>
            <details className="page-options">
              <summary>Page settings</summary>
              <div className="page-settings">
                <button
                  disabled={readonly || pages.length >= 200}
                  onClick={() => engine.pages.duplicate()}
                >
                  Duplicate page
                </button>
                <button
                  disabled={readonly || i === 0}
                  onClick={() => engine.pages.move(-1)}
                >
                  Move page earlier
                </button>
                <button
                  disabled={readonly || i === pages.length - 1}
                  onClick={() => engine.pages.move(1)}
                >
                  Move page later
                </button>
                <button
                  disabled={readonly || pages.length === 1}
                  onClick={() => setDeleting(current.id)}
                >
                  Delete page
                </button>
                <label>
                  Paper color{" "}
                  <select
                    aria-label="Paper color"
                    disabled={readonly || paper.kind === "pdf"}
                    value={paper.color}
                    onChange={(ev) =>
                      engine.pages.paper({
                        color: ev.target.value as typeof paper.color,
                      })
                    }
                  >
                    <option value="white">White</option>
                    <option value="dark">Dark</option>
                    <option value="green">Green</option>
                  </select>
                </label>
                <label>
                  Paper size{" "}
                  <select
                    aria-label="Paper size"
                    disabled={readonly || paper.kind === "pdf"}
                    value={
                      paper.kind === "pdf"
                        ? "pdf"
                        : Math.min(paper.width, paper.height) === 794
                          ? "a4"
                          : "board"
                    }
                    onChange={(ev) =>
                      engine.pages.paper(
                        ev.target.value === "a4"
                          ? { width: 1123, height: 794 }
                          : { width: 1280, height: 960 },
                      )
                    }
                  >
                    {paper.kind === "pdf" ? (
                      <option value="pdf">
                        PDF · {paper.width} × {paper.height}
                      </option>
                    ) : null}
                    <option value="board">Board · 1280 × 960</option>
                    <option value="a4">A4 · 1123 × 794</option>
                  </select>
                </label>
                <label>
                  Paper orientation{" "}
                  <select
                    aria-label="Paper orientation"
                    disabled={readonly || paper.kind === "pdf"}
                    value={
                      paper.width >= paper.height ? "landscape" : "portrait"
                    }
                    onChange={(ev) => {
                      if (
                        (ev.target.value === "landscape") !==
                        paper.width >= paper.height
                      )
                        engine.pages.paper({
                          width: paper.height,
                          height: paper.width,
                        });
                    }}
                  >
                    <option value="landscape">Landscape</option>
                    <option value="portrait">Portrait</option>
                  </select>
                </label>
                <button
                  disabled={
                    readonly || i !== pages.length - 1 || pages.length >= 200
                  }
                  aria-pressed={ui.extension}
                  onClick={(ev) => {
                    session.activate("main");
                    session.armExtension(!ui.extension);
                    const details = ev.currentTarget.closest("details");
                    if (details) details.open = false;
                  }}
                >
                  {ui.extension
                    ? "Cancel page extension"
                    : "Arm page extension"}
                </button>
                <p>
                  Arm, then swipe upward at least 120 px on the main board. Adds
                  one blank page. Ink stays in place. Undo reverses it.
                </p>
              </div>
            </details>
          </>
        ) : null}
        {children}
      </nav>
      {list ? (
        <div
          className="page-list"
          role="list"
          aria-label="Page previews"
          onScroll={(ev) => setScroll(ev.currentTarget.scrollTop)}
        >
          <div style={{ height: pages.length * 104, position: "relative" }}>
            {pages
              .slice(
                Math.max(0, Math.floor(scroll / 104) - 1),
                Math.floor(scroll / 104) + 6,
              )
              .map((p, j) => {
                const index = Math.max(0, Math.floor(scroll / 104) - 1) + j;
                return (
                  <div
                    role="listitem"
                    key={p.id}
                    style={{
                      position: "absolute",
                      top: index * 104,
                      height: 104,
                      width: "100%",
                    }}
                  >
                    <button
                      aria-current={p.id === current.id ? "page" : undefined}
                      onClick={() => engine.pages.navigate(p.id)}
                    >
                      <Preview engine={engine} id={p.id} number={index + 1} />
                      <span>
                        {index + 1} · {p.name}
                      </span>
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby="delete-page-title"
        onCancel={() => setDeleting(null)}
      >
        <h2 id="delete-page-title">Delete this page?</h2>
        <p>
          Objects on this page will be removed. Scratchpad content stays. Undo
          is available until this lesson closes.
        </p>
        <div className="dialog-actions">
          <button onClick={() => setDeleting(null)}>Cancel</button>
          <button
            className="danger"
            onClick={() => {
              if (deleting) engine.pages.remove(deleting);
              setDeleting(null);
            }}
          >
            Confirm delete page
          </button>
        </div>
      </dialog>
    </>
  );
}
function Preview({
  engine,
  id,
  number,
}: {
  engine: BoardEngine;
  id: TLPageId;
  number: number;
}) {
  const version = useSyncExternalStore(
      engine.previews.subscribe,
      engine.previews.getSnapshot,
    ),
    [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true;
    const abort = new AbortController();
    void engine.previews.get(id, abort.signal).then((value) => {
      if (live) setUrl(value);
    });
    return () => {
      live = false;
      abort.abort();
    };
  }, [engine, id, version]);
  return url ? (
    <img alt={`Preview of page ${number}`} src={url} width={110} height={80} />
  ) : (
    <span className="preview-pending">Preview loading</span>
  );
}
