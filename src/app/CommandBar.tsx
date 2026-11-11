import { useEffect, useSyncExternalStore } from "react";
import type { BoardEngine } from "../modules/board/engine.ts";
import { activityState } from "../modules/workspace/activity.ts";
import { classroomEnabled } from "../config/classroom.ts";
import { product } from "../config/product.ts";
import { SaveError, SaveStatus } from "./SaveStatus.tsx";
import { LessonFiles } from "./LessonFiles.tsx";
import { WorkspaceTools } from "./workspace/WorkspaceTools.tsx";
import { PdfImport } from "./PdfImport.tsx";
import { WordTerminal } from "./documents/WordTerminal.tsx";
import { PptxImport } from "./pptx/PptxImport.tsx";
import { ExportDialog } from "./ExportDialog.tsx";
import { PresentationControls } from "./PresentationControls.tsx";
import { PageRailToggle } from "./PageManager.tsx";
import { AdaptiveTools } from "./ToolDisclosures.tsx";
import { Icon } from "./Icon.tsx";

export function CommandBar({
  engine,
  main,
  notice,
}: {
  engine: BoardEngine;
  main: BoardEngine;
  notice?: string;
}) {
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (
        engine.saving.status.phase !== "saved" ||
        engine.isPointing() ||
        engine.editing.state.isTextEditing ||
        activityState.getSnapshot().count
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [engine]);

  return (
    <>
      <header className="command-bar" aria-label="Lesson commands">
        <h1 className="sr-only">{product.name}</h1>
        <div className="command-group command-start">
          <a
            className="notebook-brand"
            href="/"
            aria-label={product.name + " home"}
            title={product.name}
          >
            <img src="/mark.svg" width="23" height="23" alt="" />
          </a>
          <WorkspaceTools engine={engine} />
          <PageRailToggle />
        </div>
        <LessonTitle engine={engine} />
        <HistoryControls engine={engine} />
        <AdaptiveTools
          label="Lesson and view commands"
          className="command-extra"
        >
          <div className="command-group">
            <LessonFiles engine={engine} />
            <details
              data-tool-disclosure
              className="tool-disclosure documents-disclosure"
            >
              <summary
                className="chrome-control"
                role="button"
                aria-label="Documents"
                title="Documents"
              >
                <Icon name="documents" />
                <Icon name="chevron" />
              </summary>
              <div className="tool-flyout document-actions">
                <PdfImport engine={main} />
                <WordTerminal engine={main} />
                <PptxImport engine={main} />
                <ExportDialog engine={main} />
              </div>
            </details>
          </div>
          <PresentationControls session={engine.session} />
        </AdaptiveTools>
        {classroomEnabled ? (
          <a
            className="chrome-control classroom-entry"
            href="/classroom"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GroupHub"
            title="GroupHub · account and rooms (opens in a new tab)"
          >
            <Icon name="people" />
          </a>
        ) : null}
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
function LessonTitle({ engine }: { engine: BoardEngine }) {
  const title = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().title,
  );
  const readOnly = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().readOnly,
  );
  return (
    <div className="command-identity">
      <label className="sr-only" htmlFor="lesson-title">
        Lesson title
      </label>
      <input
        id="lesson-title"
        value={title}
        maxLength={120}
        placeholder="Untitled lesson"
        disabled={readOnly}
        onChange={(event) => engine.setTitle(event.target.value)}
      />
      <SaveStatus engine={engine} />
    </div>
  );
}
function HistoryControls({ engine }: { engine: BoardEngine }) {
  const undo = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().canUndo && !engine.getSnapshot().readOnly,
  );
  const redo = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().canRedo && !engine.getSnapshot().readOnly,
  );
  return (
    <div className="command-group" role="group" aria-label="Drawing history">
      <button
        type="button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!undo}
        onClick={() => engine.undo()}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!redo}
        onClick={() => engine.redo()}
      >
        <Icon name="redo" />
      </button>
    </div>
  );
}
