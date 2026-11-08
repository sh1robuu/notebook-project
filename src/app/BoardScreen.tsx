import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Tldraw } from "tldraw";
import { product } from "../config/product.ts";
import type { Editor } from "tldraw";
import "tldraw/tldraw.css";
import type { LocalWorkspace } from "../modules/workspace/local-workspace.ts";
import { BoardEngine } from "../modules/board/engine.ts";
import { PartialEraserTool } from "../modules/board/partial-eraser.ts";
import { Toolbar } from "./Toolbar.tsx";
import { SaveError, SaveStatus } from "./SaveStatus.tsx";
import { LessonFiles } from "./LessonFiles.tsx";
import { Icon } from "./Icon.tsx";
import { EquationDialog } from "./EquationDialog.tsx";
import { ContextMenu } from "./ContextMenu.tsx";
import { LessonSession } from "../modules/board/lesson-session.ts";
import type { SurfaceId } from "../modules/workspace/lesson-view.ts";
import { ScratchpadControls, WorkspaceLayout } from "./ScratchpadPane.tsx";
import { PageManager } from "./PageManager.tsx";
import { PaperBackground } from "./PaperBackground.tsx";
import { LaserTool } from "../modules/board/laser.ts";
import { PresentationControls } from "./PresentationControls.tsx";
import { PdfImport } from "./PdfImport.tsx";
import { PdfSessionContext, PdfControls, PdfReadingLayer } from "./PdfPage.tsx";
import {
  shapeUtils,
  textOptions,
  sdkOptions,
} from "../modules/board/sdk-config.ts";
import { ExportDialog } from "./ExportDialog.tsx";
import { WordTerminal } from "./documents/WordTerminal.tsx";
import { TeachingControls } from "./documents/TeachingControls.tsx";
import { WordSourcesContext } from "../modules/documents/render.tsx";
import { wordVisibility } from "../modules/documents/teaching.ts";
import { PptxImport } from "./pptx/PptxImport.tsx";
import { SlideControls } from "./pptx/SlideControls.tsx";
const canvasComponents = { Background: PaperBackground };
const customTools = [PartialEraserTool, LaserTool];
export function BoardScreen({ workspace }: { workspace: LocalWorkspace }) {
  const [session] = useState(() => new LessonSession(workspace)),
    [engines, setEngines] = useState<Partial<Record<SurfaceId, BoardEngine>>>(
      {},
    );
  const ui = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [scratchEpoch, setScratchEpoch] = useState(
    workspace.lesson.view.layout.open ? 0 : -1,
  );
  useEffect(() => {
    if (ui.view.layout.open) setScratchEpoch(ui.editorEpoch);
  }, [ui.view.layout.open, ui.editorEpoch]);
  const scratchMounted = ui.view.layout.open || scratchEpoch === ui.editorEpoch;
  useEffect(() => () => session.close(), [session]);
  const ready = useCallback(
    (surface: SurfaceId, engine: BoardEngine) => {
      if (engine.editorEpoch === session.state.editorEpoch)
        setEngines((old) => {
          const current: Partial<Record<SurfaceId, BoardEngine>> = {};
          for (const key of ["main", "scratchpad"] as const)
            if (old[key]?.editorEpoch === engine.editorEpoch)
              current[key] = old[key];
          current[surface] = engine;
          return current;
        });
    },
    [session],
  );
  const main =
      engines.main?.editorEpoch === ui.editorEpoch ? engines.main : undefined,
    scratch =
      engines.scratchpad?.editorEpoch === ui.editorEpoch
        ? engines.scratchpad
        : undefined,
    active = ui.active === "main" ? main : scratch,
    header = active ?? main;
  return (
    <div
      className="workspace"
      data-presenting={ui.presentation || ui.laser !== null}
    >
      {header ? (
        <Chrome engine={header} notice={workspace.recoveryNotice} />
      ) : (
        <header className="app-header">
          <h1>{product.name}</h1>
          <p role="status">Opening your board…</p>
        </header>
      )}
      {main ? <ScratchpadControls session={session} /> : null}
      {main ? <PresentationControls session={session} /> : null}
      {main ? (
        <PageManager key={ui.editorEpoch} engine={main}>
          <div className="document-actions">
            <PdfImport engine={main} />
            <WordTerminal engine={main} />
            <PptxImport engine={main} />
            <ExportDialog engine={main} />
            <PdfControls engine={main} />
            <TeachingControls engine={main} />
          </div>
        </PageManager>
      ) : null}
      {main ? <SlideControls engine={main} /> : null}
      <div className="work-area">
        {active && !(ui.reading && ui.active === "main") ? (
          <Toolbar engine={active} />
        ) : (
          <aside className="palette" role="status">
            {ui.reading && active
              ? "Reading PDF text. Use Annotate PDF to return to editing."
              : "Opening surface…"}
          </aside>
        )}
        <WorkspaceLayout session={session}>
          <EditorSurface
            key={"main:" + ui.editorEpoch}
            session={session}
            surface="main"
            ready={ready}
          />
          {scratchMounted ? (
            <EditorSurface
              key={"scratch:" + ui.editorEpoch}
              session={session}
              surface="scratchpad"
              ready={ready}
            />
          ) : null}
        </WorkspaceLayout>
      </div>
    </div>
  );
}
function EditorSurface({
  session,
  surface,
  ready,
}: {
  session: LessonSession;
  surface: SurfaceId;
  ready: (surface: SurfaceId, engine: BoardEngine) => void;
}) {
  const [engine, setEngine] = useState<BoardEngine | null>(null),
    host = useRef<HTMLDivElement>(null),
    cursor = useRef<HTMLDivElement>(null);
  const epoch = useRef(session.state.editorEpoch).current;
  const mount = useCallback(
    (editor: Editor) => {
      const next = new BoardEngine(editor, session, host.current!, surface);
      setEngine(next);
      ready(surface, next);
      return () => next.close();
    },
    [session, surface, ready],
  );
  const Tag = surface === "main" ? "main" : "section";
  return (
    <Tag
      className={`board-sheet ${surface === "scratchpad" ? "scratch-surface" : "main-surface"}`}
      data-testid={surface === "main" ? "main-surface" : "scratch-surface"}
      aria-label={surface === "main" ? "Teaching whiteboard" : "Scratchpad"}
      onPointerDownCapture={(e) => {
        if (epoch !== session.state.editorEpoch) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        session.activate(surface);
      }}
      onFocusCapture={() => {
        if (epoch === session.state.editorEpoch) session.activate(surface);
      }}
    >
      {surface === "scratchpad" ? (
        <div className="scratch-heading">
          <strong>Scratchpad</strong>
          <span>Independent surface</span>
        </div>
      ) : null}
      <div
        ref={host}
        className="board-host"
        data-testid={surface === "main" ? "board" : "scratch-board"}
        onPointerMove={(e) => {
          if (cursor.current) {
            const b = e.currentTarget.getBoundingClientRect();
            cursor.current.style.transform = `translate(${e.clientX - b.left - 12}px,${e.clientY - b.top - 12}px)`;
          }
        }}
      >
        <PdfSessionContext.Provider value={session}>
          <WordSourcesContext.Provider value={session.wordSources}>
            <Tldraw
              hideUi
              components={canvasComponents}
              initialState="draw"
              tools={customTools}
              shapeUtils={shapeUtils}
              textOptions={textOptions}
              options={sdkOptions}
              getShapeVisibility={wordVisibility}
              onMount={mount}
              licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY || undefined}
            />
          </WordSourcesContext.Provider>
        </PdfSessionContext.Provider>
        {engine && surface === "main" ? (
          <PdfReadingLayer engine={engine} />
        ) : null}
        {engine ? <EraserCursor engine={engine} cursor={cursor} /> : null}
      </div>
      {engine ? (
        <>
          <BoardFooter engine={engine} />
          <EquationDialog engine={engine} />
          <ContextMenu engine={engine} />
        </>
      ) : null}
    </Tag>
  );
}
function Chrome({ engine, notice }: { engine: BoardEngine; notice?: string }) {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (engine.saving.status.phase !== "saved" && !engine.state.readOnly) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("beforeunload", unload);
    };
  }, [engine]);
  return (
    <>
      <header className="app-header">
        <div className="brand">
          <img src="/mark.svg" width="30" height="30" alt="" />
          <h1>{product.name}</h1>
        </div>
        <div className="lesson-identity">
          <label className="sr-only" htmlFor="lesson-title">
            Lesson title
          </label>
          <input
            id="lesson-title"
            aria-label="Lesson title"
            value={state.title}
            maxLength={120}
            placeholder="Untitled lesson"
            disabled={state.readOnly}
            onChange={(e) => engine.setTitle(e.target.value)}
          />
          <SaveStatus engine={engine} />
        </div>
        <LessonFiles engine={engine} />
      </header>
      <SaveError engine={engine} />
      {notice ? (
        <div className="recovery-notice" role="status">
          {notice}
        </div>
      ) : null}
    </>
  );
}
function EraserCursor({
  engine,
  cursor,
}: {
  engine: BoardEngine;
  cursor: React.RefObject<HTMLDivElement | null>;
}) {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  return (
    <div
      ref={cursor}
      className="eraser-cursor"
      hidden={state.tool !== "partial_eraser"}
      aria-hidden="true"
    />
  );
}
function BoardFooter({ engine }: { engine: BoardEngine }) {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const editing = useSyncExternalStore(
    engine.editing.subscribe,
    engine.editing.getSnapshot,
  );
  return (
    <footer className="board-footer">
      <div className="board-scope">
        <span>{engine.surface === "main" ? "Main board" : "Scratchpad"}</span>
        <span className="dot-separator">·</span>
        <span data-testid="stroke-count">
          {editing.ink.toLocaleString()}{" "}
          {editing.ink === 1 ? "stroke" : "strokes"}
        </span>
        {editing.objects ? (
          <span data-testid="object-count">
            {editing.objects} {editing.objects === 1 ? "object" : "objects"}
          </span>
        ) : null}
      </div>
      <div className="zoom-controls" role="group" aria-label="Board zoom">
        <button
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => engine.zoom("out")}
          disabled={state.zoom <= 0.25}
        >
          <Icon name="minus" />
        </button>
        <button
          data-testid="zoom-level"
          aria-label="Reset zoom"
          title="Reset zoom to 100%"
          onClick={() => engine.zoom("reset")}
        >
          {Math.round(state.zoom * 100)}%
        </button>
        <button
          aria-label="Zoom in"
          title="Zoom in"
          disabled={state.zoom >= 4}
          onClick={() => engine.zoom("in")}
        >
          <Icon name="plus" />
        </button>
        <button
          aria-label="Fit drawing"
          title="Fit drawing"
          onClick={() => engine.zoom("fit")}
        >
          <Icon name="fit" />
        </button>
      </div>
    </footer>
  );
}
