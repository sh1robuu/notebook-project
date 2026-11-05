import { useEffect, useState, useSyncExternalStore } from "react";
import type { LessonSession } from "../modules/board/lesson-session.ts";
export function PresentationControls({ session }: { session: LessonSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot),
    [fullscreen, setFullscreen] = useState(!!document.fullscreenElement),
    [error, setError] = useState("");
  useEffect(() => {
    const change = () => {
      setFullscreen(!!document.fullscreenElement);
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
  return (
    <nav className="presentation-controls" aria-label="Presentation controls">
      <button
        aria-pressed={state.laser !== null}
        onClick={() => {
          const engine = session.engines.get(state.active);
          if (state.laser !== null)
            session.engines.get(state.laser)?.stopLaser();
          else engine?.startLaser();
        }}
      >
        Laser pointer
      </button>
      <button onClick={() => session.setPresentation(!state.presentation)}>
        {state.presentation ? "Exit presentation" : "Present"}
      </button>
      <button
        onClick={async () => {
          setError("");
          try {
            if (fullscreen) await document.exitFullscreen();
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
        {fullscreen ? "Exit fullscreen" : "Fullscreen"}
      </button>
      <button
        onClick={() =>
          session.updateView({ hidden: { ...hidden, pages: !hidden.pages } })
        }
      >
        {hidden.pages ? "Show page controls" : "Hide page controls"}
      </button>
      <button
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
      {state.extension ? (
        <span role="status">
          Extension armed · swipe upward on the main board
        </span>
      ) : null}
      {error ? <span role="status">{error}</span> : null}
      {state.message ? <span role="status">{state.message}</span> : null}
    </nav>
  );
}
