import { StateNode } from "tldraw";
import type { BoardEngine } from "./engine.ts";
export class LaserTool extends StateNode {
  static override id = "lesson_laser";
}
const lifetime = 900,
  limit = 256;
/** Ephemeral world-coordinate samples, painted imperatively; never touches the store. */
export function installLaser(element: HTMLElement, engine: BoardEngine) {
  const ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg");
  svg.classList.add("laser-overlay");
  svg.setAttribute("aria-hidden", "true");
  svg.dataset.testid = "laser-trail";
  svg.dataset.points = "0";
  element.append(svg);
  let samples: { x: number; y: number; t: number }[] = [],
    frame = 0,
    pointer: number | undefined;
  const abort = new AbortController(),
    options = { capture: true, signal: abort.signal },
    motion = matchMedia("(prefers-reduced-motion: reduce)");
  const active = () => engine.session.state.laser === engine.surface;
  const paint = () => {
    frame = 0;
    const now = performance.now();
    samples = samples.filter((p) => now - p.t < lifetime);
    svg.replaceChildren();
    svg.dataset.points = String(samples.length);
    if (!active()) {
      samples = [];
      return;
    }
    const camera = engine.pages.editor.getCamera(),
      group = document.createElementNS(ns, "g");
    group.setAttribute(
      "transform",
      `translate(${camera.x * camera.z} ${camera.y * camera.z}) scale(${camera.z})`,
    );
    if (!motion.matches && samples.length > 1) {
      // Eight age bands bound DOM work independently of raw pointer sample frequency.
      for (let band = 0; band < 8; band++) {
        const points = samples.filter(
          (p) => Math.floor(((now - p.t) / lifetime) * 8) === band,
        );
        if (points.length < 2) continue;
        const path = document.createElementNS(ns, "polyline");
        path.setAttribute(
          "points",
          points.map((p) => `${p.x},${p.y}`).join(" "),
        );
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#e32636");
        path.setAttribute("stroke-width", String(4 / camera.z));
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("opacity", String(1 - band / 8));
        group.append(path);
      }
    }
    const last = samples.at(-1);
    if (last) {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", String(last.x));
      dot.setAttribute("cy", String(last.y));
      dot.setAttribute("r", String(5 / camera.z));
      dot.setAttribute("fill", "#e32636");
      dot.setAttribute("stroke", "white");
      dot.setAttribute("stroke-width", String(1.5 / camera.z));
      dot.setAttribute(
        "opacity",
        String(Math.max(0, 1 - (now - last.t) / lifetime)),
      );
      group.append(dot);
    }
    svg.append(group);
    if (samples.length) frame = requestAnimationFrame(paint);
  };
  const clear = () => {
    samples = [];
    pointer = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
    svg.replaceChildren();
    svg.dataset.points = "0";
  };
  const sample = (e: PointerEvent) => {
    const editor = engine.pages.editor;
    editor.updateViewportScreenBounds(editor.getContainer());
    const point = editor.screenToPage({ x: e.clientX, y: e.clientY });
    samples.push({ ...point, t: performance.now() });
    if (samples.length > limit) samples.splice(0, samples.length - limit);
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const stop = (e: PointerEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  element.addEventListener(
    "pointerdown",
    (e) => {
      if (!active()) return;
      stop(e);
      if (pointer !== undefined || e.button !== 0) return;
      pointer = e.pointerId;
      element.setPointerCapture(e.pointerId);
      sample(e);
    },
    options,
  );
  element.addEventListener(
    "pointermove",
    (e) => {
      if (!active()) return;
      stop(e);
      if (pointer !== undefined && pointer !== e.pointerId) return;
      sample(e);
    },
    options,
  );
  element.addEventListener(
    "pointerup",
    (e) => {
      if (!active()) return;
      stop(e);
      if (pointer !== e.pointerId) return;
      sample(e);
      pointer = undefined;
      if (element.hasPointerCapture(e.pointerId))
        element.releasePointerCapture(e.pointerId);
    },
    options,
  );
  element.addEventListener(
    "pointerleave",
    () => {
      if (pointer === undefined) clear();
    },
    { signal: abort.signal },
  );
  element.addEventListener(
    "pointercancel",
    () => {
      if (active()) engine.stopLaser();
    },
    options,
  );
  element.addEventListener(
    "lostpointercapture",
    () => {
      if (pointer !== undefined && active()) engine.stopLaser();
    },
    options,
  );
  window.addEventListener(
    "blur",
    () => {
      if (active()) engine.stopLaser();
    },
    { signal: abort.signal },
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden && active()) engine.stopLaser();
    },
    { signal: abort.signal },
  );
  const unsubscribe = engine.session.subscribe(() => {
    if (!active()) clear();
  });
  return () => {
    abort.abort();
    unsubscribe();
    clear();
    svg.remove();
  };
}
