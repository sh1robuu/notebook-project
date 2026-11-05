import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { LessonSession } from "../modules/board/lesson-session.ts";
export function ScratchpadControls({ session }: { session: LessonSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot),
    layout = state.view.layout;
  const [clearing, setClearing] = useState(false),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (clearing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [clearing]);
  const hidden =
    state.view.hidden.scratch || state.presentation || state.laser !== null;
  const update = (value: Partial<typeof layout>) =>
    session.updateView({ layout: { ...layout, ...value } });
  return (
    <nav className="surface-controls" aria-label="Workspace surfaces">
      <button
        onClick={() => {
          if (layout.open) {
            session.engines.get("scratchpad")?.cancel();
            session.activate("main");
          }
          update({ open: !layout.open });
          if (!layout.open) session.activate("scratchpad");
        }}
      >
        {layout.open ? "Close scratchpad" : "Open scratchpad"}
      </button>
      {layout.open ? (
        <>
          <button
            aria-pressed={state.active === "main"}
            onClick={() => session.activate("main")}
          >
            Main board
          </button>
          <button
            aria-pressed={state.active === "scratchpad"}
            onClick={() => session.activate("scratchpad")}
          >
            Scratchpad
          </button>
          {!hidden ? (
            <>
              <label>
                Dock{" "}
                <select
                  aria-label="Scratchpad dock"
                  value={layout.dock}
                  onChange={(e) =>
                    update({ dock: e.target.value as "right" | "bottom" })
                  }
                >
                  <option value="right">Right</option>
                  <option value="bottom">Below</option>
                </select>
              </label>
              <label>
                Size{" "}
                <input
                  aria-label="Scratchpad size percent"
                  type="number"
                  min={20}
                  max={65}
                  step={5}
                  value={Math.round(layout.ratio * 100)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (n >= 20 && n <= 65) update({ ratio: n / 100 });
                  }}
                />
                %
              </label>
              <button
                onClick={() => session.engines.get("scratchpad")?.resetView()}
              >
                Reset scratchpad view
              </button>
              <button
                disabled={session.workspace.readOnly || state.presentation}
                onClick={() => setClearing(true)}
              >
                Clear scratchpad
              </button>
            </>
          ) : null}
        </>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby="clear-scratchpad-title"
        onCancel={() => setClearing(false)}
      >
        <h2 id="clear-scratchpad-title">Clear scratchpad?</h2>
        <p>
          Remove all scratchpad objects. Main pages stay intact. Undo is
          available until this lesson closes.
        </p>
        <div className="dialog-actions">
          <button onClick={() => setClearing(false)}>Cancel</button>
          <button
            className="danger"
            onClick={() => {
              session.engines.get("scratchpad")?.clearSurface();
              setClearing(false);
            }}
          >
            Confirm clear scratchpad
          </button>
        </div>
      </dialog>
    </nav>
  );
}
export function WorkspaceLayout({
  session,
  children,
}: {
  session: LessonSession;
  children: ReactNode;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot),
    layout = state.view.layout,
    ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  useEffect(() => {
    const node = ref.current!;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const b = node.getBoundingClientRect();
        setSize((old) =>
          old.width === b.width && old.height === b.height
            ? old
            : { width: b.width, height: b.height },
        );
      });
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  const preferred =
    layout.dock === "right" && size.width >= 648 ? "right" : "bottom";
  const span = (preferred === "right" ? size.width : size.height) - 8;
  const minimum = preferred === "right" ? 320 : 300;
  const split = layout.open && span >= minimum * 2;
  const low = Math.max(0.2, minimum / Math.max(span, 1)),
    high = Math.min(0.65, 1 - minimum / Math.max(span, 1));
  const ratio = split
    ? Math.max(low, Math.min(high, layout.ratio))
    : layout.ratio;
  const change = (next: number) =>
    session.updateView({
      layout: { ...layout, ratio: Math.max(0.2, Math.min(0.65, next)) },
    });
  return (
    <div
      ref={ref}
      className="surface-workspace"
      data-mode={split ? preferred : "single"}
      data-open={layout.open}
      data-active={state.active}
      style={{ "--scratch-ratio": ratio } as React.CSSProperties}
    >
      {children}
      <div
        className="scratch-divider"
        role="separator"
        tabIndex={0}
        aria-label="Resize scratchpad"
        aria-orientation={preferred === "right" ? "vertical" : "horizontal"}
        aria-valuemin={Math.round(low * 100)}
        aria-valuemax={Math.round(high * 100)}
        aria-valuenow={Math.round(ratio * 100)}
        hidden={!split}
        onKeyDown={(e) => {
          const bigger = preferred === "right" ? "ArrowLeft" : "ArrowUp",
            smaller = preferred === "right" ? "ArrowRight" : "ArrowDown";
          if ([bigger, smaller, "Home", "End"].includes(e.key)) {
            e.preventDefault();
            change(
              e.key === "Home"
                ? low
                : e.key === "End"
                  ? high
                  : ratio + (e.key === bigger ? 0.05 : -0.05),
            );
          }
        }}
        onPointerDown={(e) => {
          for (const engine of session.engines.values()) engine.cancel();
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId) || !e.buttons)
            return;
          const b = ref.current!.getBoundingClientRect();
          const n =
            preferred === "right"
              ? (b.right - e.clientX) / b.width
              : (b.bottom - e.clientY) / b.height;
          change(Math.max(low, Math.min(high, n)));
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        <span className="divider-grip" aria-hidden="true" />
      </div>
    </div>
  );
}
