import type { Editor } from "tldraw";
import { InputPolicy } from "./input-policy.ts";
import type { TouchMode } from "./input-policy.ts";

/** Filters conflicting contacts only; SDK receives the accepted original events. */
export function installInputGuard(
  element: HTMLElement,
  editor: Editor,
  changed: () => void,
  begin: () => void,
  allow: (event: PointerEvent) => boolean = () => true,
  finish: () => boolean = () => true,
) {
  const policy = new InputPolicy("pan");
  let mark: string | undefined,
    temporaryTool: string | undefined,
    gestureTool = "",
    ignoreTouch = false;
  const abort = new AbortController(),
    options = { capture: true, signal: abort.signal };
  const stop = (e: Event) => {
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  };
  const cancel = () => {
    const tool = temporaryTool ?? editor.getCurrentToolId();
    if (policy.activeCount > 0 || mark || editor.inputs.getIsPointing())
      editor.cancel();
    if (mark) {
      editor.bailToMark(mark);
      mark = undefined;
    }
    if (editor.getCurrentToolId() !== tool) editor.setCurrentTool(tool);
    policy.cancel();
    temporaryTool = undefined;
    editor.inputs.isPointing = false;
    editor.inputs.isPinching = false;
    editor.inputs.setIsDragging(false);
    changed();
  };
  const down = (e: PointerEvent) => {
    if (
      e.target instanceof Element &&
      e.target.closest(
        'input,textarea,[contenteditable="true"],[data-pdf-reading]',
      )
    )
      return;
    const hadTouch = policy.touchCount > 0;
    if (e.pointerType === "pen" && hadTouch) cancel();
    const intent = policy.down(e.pointerId, e.pointerType, {
      x: e.clientX,
      y: e.clientY,
    });
    if (intent === "ignore") {
      stop(e);
      return;
    }
    if (e.pointerType !== "pen")
      editor.updateInstanceState({ isPenMode: false });
    if (
      editor.getInstanceState().isReadonly &&
      editor.getCurrentToolId() !== "hand"
    ) {
      stop(e);
      return;
    }
    if (e.pointerType === "touch" && intent === "pan") {
      const originTool = temporaryTool ?? editor.getCurrentToolId();
      if (mark) {
        editor.cancel();
        editor.bailToMark(mark);
        mark = undefined;
      }
      if (!temporaryTool) temporaryTool = originTool;
      editor.setCurrentTool("hand");
    }
    if (!allow(e)) {
      policy.up(e.pointerId);
      stop(e);
      return;
    }
    if (
      intent === "ink" &&
      (e.button === 0 || e.button === 5) &&
      !editor.inputs.getIsPanning()
    ) {
      if (editor.getCurrentToolId() !== "hand") begin();
      gestureTool = editor.getCurrentToolId();
      if (!["hand", "lesson_laser", "partial_eraser"].includes(gestureTool))
        mark = editor.markHistoryStoppingPoint("input gesture");
    }
  };
  const move = (e: PointerEvent) => {
    if (
      e.target instanceof Element &&
      e.target.closest(
        'input,textarea,[contenteditable="true"],[data-pdf-reading]',
      )
    )
      return;
    if (e.buttons === 0) return;
    if (policy.move(e.pointerId, { x: e.clientX, y: e.clientY }) === "ignore")
      stop(e);
  };
  const up = (e: PointerEvent) => {
    if (
      e.target instanceof Element &&
      e.target.closest(
        'input,textarea,[contenteditable="true"],[data-pdf-reading]',
      )
    )
      return;
    const intent = policy.move(e.pointerId, { x: e.clientX, y: e.clientY });
    policy.up(e.pointerId);
    if (intent === "ignore") {
      stop(e);
      return;
    }
    queueMicrotask(() => {
      if (mark) {
        if (!finish()) {
          editor.cancel();
          editor.bailToMark(mark);
        } else {
          if (["draw", "highlight", "eraser"].includes(gestureTool))
            editor.complete();
          editor.squashToMark(mark);
        }
        mark = undefined;
      }
      if (temporaryTool && policy.touchCount === 0) {
        const tool = temporaryTool;
        temporaryTool = undefined;
        editor.setCurrentTool(tool);
      }
      changed();
    });
  };
  element.addEventListener("pointerdown", down, options);
  element.addEventListener("pointermove", move, options);
  element.addEventListener("pointerup", up, options);
  const cancelPointer = (e: PointerEvent) => {
    if (policy.owns(e.pointerId)) cancel();
    else {
      policy.up(e.pointerId);
      stop(e);
    }
  };
  element.addEventListener("pointercancel", cancelPointer, options);
  element.addEventListener("lostpointercapture", cancelPointer, options);
  for (const name of [
    "touchstart",
    "touchmove",
    "touchend",
    "touchcancel",
  ] as const)
    element.addEventListener(
      name,
      (e: TouchEvent) => {
        if (policy.hasPen) ignoreTouch = true;
        if (ignoreTouch) stop(e);
        if (e.touches.length === 0) ignoreTouch = false;
      },
      { ...options, passive: false },
    );
  window.addEventListener("blur", cancel, { signal: abort.signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden && policy.activeCount) cancel();
    },
    { signal: abort.signal },
  );
  return {
    setTouchMode(mode: TouchMode) {
      cancel();
      policy.mode = mode;
      editor.updateInstanceState({ isPenMode: false });
    },
    cancel,
    dispose() {
      abort.abort();
      if (mark) cancel();
    },
  };
}
