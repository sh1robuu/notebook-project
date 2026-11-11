import { useEffect, useState, useSyncExternalStore } from "react";
import type { LessonSession } from "../modules/board/lesson-session.ts";
import { Icon } from "./Icon.tsx";
export function PresentationControls({ session }: { session: LessonSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    const change = () => {
      if (!document.fullscreenElement) {
        session.engines
          .get(session.state.laser ?? session.state.active)
          ?.stopLaser();
        session.setPresentation(false);
      }
    };
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, [session]);
  const hidden = state.view.hidden;
  const laser = state.laser !== null;
  const toggleLaser = () => {
    if (state.laser !== null) session.engines.get(state.laser)?.stopLaser();
    else session.engines.get(state.active)?.startLaser();
  };
  return (
    <nav
      className="command-group presentation-commands"
      aria-label="Presentation controls"
    >
      <button
        type="button"
        aria-label="Laser pointer"
        title="Laser pointer"
        aria-pressed={laser}
        onClick={toggleLaser}
      >
        <Icon name="laser" />
      </button>
      <button
        type="button"
        aria-label={state.presentation ? "Exit presentation" : "Present"}
        title={state.presentation ? "Exit presentation" : "Present"}
        onClick={() => session.setPresentation(!state.presentation)}
      >
        <Icon name="slides" />
      </button>
      <FullscreenControl />
      <details data-tool-disclosure className="tool-disclosure view-disclosure">
        <summary className="chrome-control" title="View">
          <Icon name="settings" /> <span className="sr-only">View</span>
        </summary>
        <div className="tool-flyout">
          <button
            type="button"
            onClick={() =>
              session.updateView({
                hidden: { ...hidden, pages: !hidden.pages },
              })
            }
          >
            {hidden.pages ? "Show page controls" : "Hide page controls"}
          </button>
          <button
            type="button"
            onClick={() =>
              session.updateView({
                hidden: { ...hidden, scratch: !hidden.scratch },
              })
            }
          >
            {hidden.scratch
              ? "Show scratchpad controls"
              : "Hide scratchpad controls"}
          </button>
        </div>
      </details>
    </nav>
  );
}
export function PresentationExit({ session }: { session: LessonSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return (
    <div
      className="presentation-exit"
      role="group"
      aria-label="Presentation controls"
    >
      {state.laser !== null ? (
        <button
          type="button"
          aria-label="Laser pointer"
          title="Exit laser pointer"
          aria-pressed="true"
          onClick={() =>
            session.engines.get(state.laser ?? state.active)?.stopLaser()
          }
        >
          <Icon name="laser" />
        </button>
      ) : null}
      {state.presentation ? (
        <button
          type="button"
          aria-label="Exit presentation"
          title="Exit presentation"
          onClick={() => session.setPresentation(false)}
        >
          <Icon name="stop" />
        </button>
      ) : null}
      <FullscreenControl />
    </div>
  );
}

function FullscreenControl() {
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [error, setError] = useState("");
  useEffect(() => {
    const change = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const label = fullscreen ? "Exit fullscreen" : "Fullscreen";
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={fullscreen}
        onClick={async () => {
          setError("");
          try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else if (document.documentElement.requestFullscreen)
              await document.documentElement.requestFullscreen();
            else throw new Error("Fullscreen unavailable");
          } catch {
            setError(
              "Fullscreen is unavailable. Presentation controls remain available.",
            );
          }
        }}
      >
        <Icon name={fullscreen ? "minimize" : "fit"} />
      </button>
      {error ? (
        <span role="status" className="file-message file-error">
          {error}
        </span>
      ) : null}
    </>
  );
}
