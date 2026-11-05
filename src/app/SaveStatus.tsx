import { useSyncExternalStore } from "react";
import type { BoardEngine } from "../modules/board/engine.ts";
import { Icon } from "./Icon.tsx";
export function SaveStatus({ engine }: { engine: BoardEngine }) {
  const status = useSyncExternalStore(
    engine.saving.subscribe,
    engine.saving.getSnapshot,
  );
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  return (
    <div
      className={`save-status ${status.phase}`}
      data-testid="save-status"
      role="status"
      aria-live="polite"
    >
      {state.readOnly ? (
        <>
          <span className="status-dot" />
          Read-only tab
        </>
      ) : status.phase === "saved" ? (
        <>
          <Icon name="check" />
          Saved on this device
        </>
      ) : status.phase === "saving" ? (
        <>
          <span className="status-dot" />
          Saving…
        </>
      ) : (
        <>
          <span className="status-dot" />
          Not saved — storage error
        </>
      )}
    </div>
  );
}
export function SaveError({ engine }: { engine: BoardEngine }) {
  const status = useSyncExternalStore(
    engine.saving.subscribe,
    engine.saving.getSnapshot,
  );
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  if (!state.readOnly && status.phase !== "error") return null;
  return (
    <div className="save-warning" role="alert">
      <p>
        {state.readOnly
          ? "Another tab owns editing, or editing ownership changed. You can view and download this tab’s work."
          : `${status.error} Your current work is still visible. Download a lesson file to keep a separate copy.`}
      </p>
      {state.readOnly ? (
        <button onClick={() => window.location.reload()}>
          Reopen workspace
        </button>
      ) : (
        <button onClick={() => engine.saving.flush().catch(() => {})}>
          Retry save
        </button>
      )}
    </div>
  );
}
