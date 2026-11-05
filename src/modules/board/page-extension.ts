import type { BoardEngine } from "./engine.ts";
import { validatePaper } from "../workspace/lesson-view.ts";
/** Explicitly armed one-shot gesture; never competes with ordinary handwriting. */
export function installExtension(element: HTMLElement, engine: BoardEngine) {
  const abort = new AbortController(),
    opts = { capture: true, signal: abort.signal };
  let gesture:
    | { id: number; x: number; y: number; time: number; page: string }
    | undefined;
  const stop = (e: PointerEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  element.addEventListener(
    "pointerdown",
    (e) => {
      if (engine.surface !== "main" || !engine.session.state.extension) return;
      stop(e);
      const ed = engine.pages.editor;
      if (
        gesture ||
        e.button !== 0 ||
        ed.getCurrentPageId() !== ed.getPages().at(-1)?.id ||
        validatePaper(ed.getCurrentPage().meta.paper).kind !== "blank"
      ) {
        gesture = undefined;
        engine.session.armExtension(false);
        return;
      }
      gesture = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        time: e.timeStamp,
        page: engine.currentPageId(),
      };
      element.setPointerCapture(e.pointerId);
    },
    opts,
  );
  element.addEventListener(
    "pointermove",
    (e) => {
      if (gesture) stop(e);
    },
    opts,
  );
  element.addEventListener(
    "pointerup",
    (e) => {
      if (!gesture) return;
      stop(e);
      const g = gesture;
      gesture = undefined;
      const armed = engine.session.state.extension;
      engine.session.armExtension(false);
      if (element.hasPointerCapture(e.pointerId))
        element.releasePointerCapture(e.pointerId);
      if (
        armed &&
        e.pointerId === g.id &&
        engine.currentPageId() === g.page &&
        g.y - e.clientY >= 120 &&
        Math.abs(g.x - e.clientX) <= 80 &&
        e.timeStamp - g.time < 3000
      )
        engine.pages.add();
    },
    opts,
  );
  const cancel = () => {
    if (gesture) {
      gesture = undefined;
      engine.session.armExtension(false);
    }
  };
  element.addEventListener("pointercancel", cancel, opts);
  element.addEventListener("lostpointercapture", cancel, opts);
  window.addEventListener("blur", cancel, { signal: abort.signal });
  return () => {
    abort.abort();
    cancel();
  };
}
