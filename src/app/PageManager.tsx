import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { useValue } from "tldraw";
import type { TLPageId } from "tldraw";
import type { BoardEngine } from "../modules/board/engine.ts";
import { MAX_PAGES } from "../modules/workspace/contracts.ts";
import { validatePaper } from "../modules/workspace/lesson-view.ts";
import type { Paper } from "../modules/workspace/lesson-view.ts";
import { Icon } from "./Icon.tsx";
import "./page-manager.css";

const dockedQuery = "(min-width: 1025px)";
const rowHeight = 110;
const subscribeEmpty = () => () => {};
const empty = () => undefined;
const isDocked = () => window.matchMedia(dockedQuery).matches;
function subscribeDocked(listener: () => void) {
  const query = window.matchMedia(dockedQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

type PageUI = {
  engine: BoardEngine;
  open: boolean;
  docked: boolean;
  available: boolean;
  setOpen: (open: boolean) => void;
  confirmDelete: (id: TLPageId) => void;
  requestSettings: () => void;
  settingsRequest: number;
};
const PageContext = createContext<PageUI | undefined>(undefined);

export function PageManager({
  engine,
  children,
}: {
  engine?: BoardEngine;
  children: ReactNode;
}) {
  const session = engine?.session;
  const state = useSyncExternalStore(
    session?.subscribe ?? subscribeEmpty,
    session?.getSnapshot ?? empty,
  );
  const docked = useSyncExternalStore(subscribeDocked, isDocked, () => false);
  const [railPreference, setRailPreference] = useState<boolean | null>(null);
  const [deleting, setDeleting] = useState<TLPageId | null>(null);
  const [settingsRequest, setSettingsRequest] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const available =
    !!state &&
    !state.view.hidden.pages &&
    !state.presentation &&
    state.laser === null;
  const open = available && (railPreference ?? docked);
  const requestSettings = useCallback(
    () => setSettingsRequest((value) => value + 1),
    [],
  );
  const context = useMemo(
    () =>
      engine
        ? {
            engine,
            open,
            docked,
            available,
            setOpen: setRailPreference,
            confirmDelete: setDeleting,
            requestSettings,
            settingsRequest,
          }
        : undefined,
    [engine, open, docked, available, requestSettings, settingsRequest],
  );
  useEffect(() => {
    if (deleting) dialog.current?.showModal();
    else dialog.current?.close();
  }, [deleting]);
  useEffect(() => {
    if (
      !engine ||
      !window.matchMedia("(min-width: 1600px) and (pointer: fine)").matches
    )
      return;
    const { lesson, readOnly } = engine.session.workspace;
    if (
      readOnly ||
      lesson.revision !== 0 ||
      lesson.view.layout.open ||
      lesson.view.mainCameras[lesson.pageId]
    )
      return;
    const editor = engine.pages.editor;
    if (validatePaper(editor.getCurrentPage().meta.paper).pattern !== "ruled")
      return;
    // Wait for the board and rail to receive their real dimensions. A restored
    // camera or any user input wins over the initial display preference.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const camera = editor.getCamera();
        if (
          engine.currentPageId() === lesson.pageId &&
          !engine.isPointing() &&
          !editor.getCurrentPageShapeIds().size &&
          camera.x === 0 &&
          camera.y === 0 &&
          camera.z === 1
        )
          engine.pages.fitWidth();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [engine]);
  return (
    <PageContext.Provider value={context}>
      {children}
      <dialog
        ref={dialog}
        aria-labelledby="delete-page-title"
        onCancel={() => setDeleting(null)}
      >
        <h2 id="delete-page-title">Delete this page?</h2>
        <p>
          Objects on this page will be removed. Scratchpad content stays. You
          can undo this while the lesson is open.
        </p>
        <div className="dialog-actions">
          <button onClick={() => setDeleting(null)}>Cancel</button>
          <button
            className="danger"
            onClick={() => {
              if (deleting) engine?.pages.remove(deleting);
              setDeleting(null);
            }}
          >
            Confirm delete page
          </button>
        </div>
      </dialog>
    </PageContext.Provider>
  );
}

function usePages(engine: BoardEngine) {
  const editor = engine.pages.editor;
  const pages = useValue("lesson pages", () => editor.getPages(), [editor]);
  const current = useValue("selected page", () => editor.getCurrentPage(), [
    editor,
  ]);
  const readonly = useValue("page writable", () => editor.getIsReadonly(), [
    editor,
  ]);
  return {
    pages,
    current,
    index: pages.findIndex((page) => page.id === current.id),
    readonly,
  };
}

export function PageRailToggle() {
  const ui = useContext(PageContext);
  if (!ui?.available) return null;
  const name = ui.open ? "Hide page list" : "Show page list";
  return (
    <button
      type="button"
      className="page-icon-control page-rail-toggle"
      title={name}
      aria-label={name}
      aria-expanded={ui.open}
      aria-controls={ui.open ? "page-thumbnail-rail" : undefined}
      data-board-controls
      onClick={() => ui.setOpen(!ui.open)}
    >
      <Icon name={ui.open ? "panelLeftClose" : "panelLeftOpen"} />
    </button>
  );
}

export function PageThumbnailRail() {
  const ui = useContext(PageContext);
  return ui?.open ? <ThumbnailRail ui={ui} /> : null;
}

function ThumbnailRail({ ui }: { ui: PageUI }) {
  const { engine, docked, confirmDelete, requestSettings, setOpen } = ui;
  const { pages, current, index, readonly } = usePages(engine);
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 0 });
  useEffect(() => {
    const node = scroller.current!;
    const observer = new ResizeObserver(() => {
      setView({ top: node.scrollTop, height: node.clientHeight });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = scroller.current!;
    const start = index * rowHeight;
    if (start < node.scrollTop) node.scrollTop = start;
    else if (start + rowHeight > node.scrollTop + node.clientHeight)
      node.scrollTop = start + rowHeight - node.clientHeight;
  }, [current.id, index]);
  const first = Math.max(0, Math.floor(view.top / rowHeight));
  const last = Math.min(
    pages.length,
    first + Math.max(2, Math.ceil(view.height / rowHeight) + 1),
  );
  return (
    <aside
      className="page-rail"
      id="page-thumbnail-rail"
      aria-label="Page thumbnails"
      data-board-controls
      onKeyDown={(event) => {
        if (event.key !== "Escape" || docked) return;
        event.preventDefault();
        setOpen(false);
        document.querySelector<HTMLButtonElement>(".page-rail-toggle")?.focus();
      }}
    >
      <div className="page-rail-heading">
        <span>
          Pages <small>{pages.length}</small>
        </span>
        <AddPage
          engine={engine}
          disabled={readonly || pages.length >= MAX_PAGES}
        />
      </div>
      <div
        ref={scroller}
        className="page-list"
        role="list"
        aria-label="Page previews"
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          setView((previous) => ({ ...previous, top }));
        }}
      >
        <div
          className="page-preview-track"
          style={{ height: pages.length * rowHeight }}
        >
          {pages.slice(first, last).map((page, offset) => {
            const number = first + offset + 1;
            return (
              <div
                className="page-preview-row"
                role="listitem"
                aria-posinset={number}
                aria-setsize={pages.length}
                key={page.id}
                style={{ top: (number - 1) * rowHeight, height: rowHeight }}
              >
                <button
                  type="button"
                  className="page-preview-button"
                  title={page.name}
                  aria-label={`Page ${number}: ${page.name}`}
                  aria-current={page.id === current.id ? "page" : undefined}
                  onClick={(event) => {
                    engine.pages.navigate(page.id);
                    if (!docked) {
                      setOpen(false);
                      if (event.detail === 0)
                        document
                          .querySelector<HTMLButtonElement>(".page-rail-toggle")
                          ?.focus();
                    }
                  }}
                  onContextMenu={(event) => {
                    if (readonly) return;
                    event.preventDefault();
                    if (page.id !== current.id) engine.pages.navigate(page.id);
                    if (!docked) setOpen(false);
                    requestSettings();
                  }}
                >
                  <Preview engine={engine} id={page.id} number={number} />
                  <span>{number}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {!readonly ? (
        <div
          className="page-rail-actions"
          role="group"
          aria-label="Selected page actions"
        >
          <PageButton
            name="Move selected page up"
            icon="up"
            disabled={index === 0}
            onClick={() => engine.pages.move(-1)}
          />
          <PageButton
            name="Move selected page down"
            icon="down"
            disabled={index === pages.length - 1}
            onClick={() => engine.pages.move(1)}
          />
          <PageButton
            name="Remove selected page"
            icon="trash"
            disabled={pages.length === 1}
            onClick={() => confirmDelete(current.id)}
          />
        </div>
      ) : null}
    </aside>
  );
}

export function PageNavigation() {
  const ui = useContext(PageContext);
  return ui ? <Navigation ui={ui} /> : null;
}

function Navigation({ ui }: { ui: PageUI }) {
  const { engine, available, open } = ui;
  const { pages, current, index, readonly } = usePages(engine);
  return (
    <nav
      className="page-navigation"
      aria-label="Lesson pages"
      data-board-controls
    >
      <PageButton
        name="Previous page"
        icon="previousBuild"
        disabled={index === 0}
        onClick={() => engine.pages.step(-1)}
      />
      <span data-testid="page-position" aria-live="polite">
        Page {index + 1} of {pages.length}
      </span>
      <PageButton
        name="Next page"
        icon="nextBuild"
        disabled={index === pages.length - 1}
        onClick={() => engine.pages.step(1)}
      />
      <select
        className="page-jump"
        title="Jump to page"
        aria-label="Jump to page"
        value={current.id}
        onChange={(event) =>
          engine.pages.navigate(event.target.value as TLPageId)
        }
      >
        {pages.map((page, pageIndex) => (
          <option key={page.id} value={page.id}>
            {pageIndex + 1} · {page.name}
          </option>
        ))}
      </select>
      {available ? (
        <>
          {!open ? (
            <AddPage
              engine={engine}
              disabled={readonly || pages.length >= MAX_PAGES}
            />
          ) : null}
          <PageSettings ui={ui} />
        </>
      ) : null}
    </nav>
  );
}

function PageButton({
  name,
  icon,
  disabled,
  onClick,
}: {
  name: string;
  icon: Parameters<typeof Icon>[0]["name"];
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="page-icon-control"
      title={name}
      aria-label={name}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

function AddPage({
  engine,
  disabled,
}: {
  engine: BoardEngine;
  disabled: boolean;
}) {
  return (
    <PageButton
      name="Add page"
      icon="pagePlus"
      disabled={disabled}
      onClick={() => engine.pages.add()}
    />
  );
}

function PageSettings({ ui }: { ui: PageUI }) {
  const { engine, settingsRequest, confirmDelete } = ui;
  const { pages, current, index, readonly } = usePages(engine);
  const paper = validatePaper(current.meta.paper);
  const session = engine.session;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const lastRequest = useRef(settingsRequest);
  useEffect(() => {
    if (settingsRequest === lastRequest.current) return;
    lastRequest.current = settingsRequest;
    if (details.current) details.current.open = true;
    summary.current?.focus();
  }, [settingsRequest]);
  const paperDisabled = readonly || paper.kind !== "blank";
  return (
    <details className="page-options" ref={details} data-tool-disclosure>
      <summary
        className="page-icon-control"
        role="button"
        title="Page settings"
        aria-label="Page settings"
        ref={summary}
      >
        <Icon name="more" />
      </summary>
      <div className="page-settings">
        <strong>Page {index + 1}</strong>
        <div className="page-settings-actions">
          <button
            type="button"
            onClick={() => {
              engine.cancel();
              engine.pages.fitWidth();
            }}
          >
            Fit page width
          </button>
          <button
            type="button"
            disabled={readonly || pages.length >= MAX_PAGES}
            onClick={() => engine.pages.duplicate()}
          >
            Duplicate page
          </button>
          <button
            type="button"
            disabled={readonly || index === 0}
            onClick={() => engine.pages.move(-1)}
          >
            Move page earlier
          </button>
          <button
            type="button"
            disabled={readonly || index === pages.length - 1}
            onClick={() => engine.pages.move(1)}
          >
            Move page later
          </button>
          <button
            type="button"
            disabled={readonly || pages.length === 1}
            onClick={() => confirmDelete(current.id)}
          >
            Delete page
          </button>
        </div>
        <label>
          Paper style
          <select
            aria-label="Paper style"
            disabled={paperDisabled}
            value={paper.pattern ?? "blank"}
            onChange={(event) => {
              const pattern = event.target.value as
                "blank" | NonNullable<Paper["pattern"]>;
              engine.pages.paper({
                pattern: pattern === "blank" ? undefined : pattern,
                titleGuide: pattern === "ruled" && !!paper.titleGuide,
              });
            }}
          >
            <option value="blank">Blank</option>
            <option value="ruled">Ruled notebook</option>
            <option value="grid">Grid</option>
            <option value="dotted">Dotted</option>
          </select>
        </label>
        {paper.pattern === "ruled" ? (
          <label>
            Title guide
            <input
              type="checkbox"
              checked={!!paper.titleGuide}
              disabled={paperDisabled}
              onChange={(event) =>
                engine.pages.paper({ titleGuide: event.target.checked })
              }
            />
          </label>
        ) : null}
        <label>
          Paper color
          <select
            aria-label="Paper color"
            disabled={paperDisabled}
            value={paper.color}
            onChange={(event) =>
              engine.pages.paper({
                color: event.target.value as Paper["color"],
              })
            }
          >
            <option value="white">White</option>
            <option value="dark">Dark</option>
            <option value="green">Green</option>
          </select>
        </label>
        <label>
          Paper size
          <select
            aria-label="Paper size"
            disabled={paperDisabled}
            value={
              paper.kind !== "blank"
                ? paper.kind
                : Math.min(paper.width, paper.height) === 794
                  ? "a4"
                  : "board"
            }
            onChange={(event) =>
              engine.pages.paper(
                event.target.value === "a4"
                  ? { width: 1123, height: 794 }
                  : { width: 1280, height: 960 },
              )
            }
          >
            {paper.kind !== "blank" ? (
              <option value={paper.kind}>
                {paper.kind === "pdf" ? "PDF" : "Slide"} ·{" "}
                {Math.round(paper.width)} × {Math.round(paper.height)}
              </option>
            ) : null}
            <option value="board">Board · 1280 × 960</option>
            <option value="a4">A4 · 1123 × 794</option>
          </select>
        </label>
        <label>
          Paper orientation
          <select
            aria-label="Paper orientation"
            disabled={paperDisabled}
            value={paper.width >= paper.height ? "landscape" : "portrait"}
            onChange={(event) => {
              if (
                (event.target.value === "landscape") !==
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
        {paper.kind === "blank" ? (
          <p>
            Paper guides stay with the lesson. PDF and PNG exports use the paper
            color without guides.
          </p>
        ) : null}
        <button
          type="button"
          disabled={
            paperDisabled ||
            index !== pages.length - 1 ||
            pages.length >= MAX_PAGES
          }
          aria-pressed={state.extension}
          onClick={() => {
            session.activate("main");
            session.armExtension(!state.extension);
            if (details.current) details.current.open = false;
            summary.current?.focus();
          }}
        >
          {state.extension ? "Cancel page extension" : "Arm page extension"}
        </button>
        <p>
          Arm the extension and swipe up on the last page to add a blank page.
        </p>
      </div>
    </details>
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
  );
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const abort = new AbortController();
    void engine.previews.get(id, abort.signal).then((value) => {
      if (!abort.signal.aborted && value) setUrl(value);
    });
    return () => abort.abort();
  }, [engine, id, version]);
  return (
    <span className="page-preview-frame">
      {url ? (
        <img
          alt={`Preview of page ${number}`}
          src={url}
          width={112}
          height={83}
          draggable={false}
        />
      ) : (
        <span className="page-preview-pending" aria-hidden="true">
          Preview…
        </span>
      )}
    </span>
  );
}
