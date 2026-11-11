import { useSyncExternalStore } from "react";
import type { BoardEngine } from "../modules/board/engine.ts";
import { Icon } from "./Icon.tsx";
const savedTime = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit",
});
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
      {status.phase === "error" ? (
        <>
          <span className="status-dot" />
          <span className="save-label">Not saved · storage error</span>
        </>
      ) : state.readOnly ? (
        <>
          <span className="status-dot" />
          <span className="save-label">Read-only tab</span>
        </>
      ) : status.phase === "saved" ? (
        <>
          <Icon name="check" />
          <span className="save-label">Saved on this device</span>
        </>
      ) : (
        <>
          <span className="status-dot" />
          <span className="save-label">
            {status.pending ? "Saving soon · unsaved changes" : "Saving…"}
          </span>
        </>
      )}
      {status.savedAt !== undefined &&
      Number.isFinite(status.savedAt) &&
      Math.abs(status.savedAt) <= 8.64e15 ? (
        <time
          className="save-time"
          dateTime={new Date(status.savedAt).toISOString()}
          aria-label="Lần lưu gần nhất"
        >
          {savedTime.format(status.savedAt)}
        </time>
      ) : null}
    </div>
  );
}
export function SaveError({ engine }: { engine: BoardEngine }) {
  const status = useSyncExternalStore(
    engine.saving.subscribe,
    engine.saving.getSnapshot,
  );
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  if (!state.readOnly && !status.error) return null;
  return (
    <div className="save-warning" role="alert">
      <p>
        {status.error
          ? `${status.error} Hãy tải một bản phục hồi trước khi đóng tab.`
          : state.readOnly
            ? "Another tab owns editing, or editing ownership changed. You can view and download this tab’s work."
            : null}
      </p>
      <div className="workspace-row">
        {!state.readOnly ? (
          <button onClick={() => engine.saving.flush().catch(() => {})}>
            Retry save
          </button>
        ) : null}
        <button
          onClick={() =>
            window.dispatchEvent(new Event("lessonboard:open-recovery"))
          }
        >
          Mở mục khôi phục
        </button>
      </div>
    </div>
  );
}
