import { useEffect, useRef, useState } from "react";
import type { BoardEngine } from "../modules/board/engine.ts";
export function ContextMenu({ engine }: { engine: BoardEngine }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
      null,
    ),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return engine.editing.onContextMenu((point) => {
      setPosition({
        x: Math.max(8, Math.min(point.x, window.innerWidth - 210)),
        y: Math.max(8, Math.min(point.y, window.innerHeight - 360)),
      });
    });
  }, [engine]);
  useEffect(() => {
    if (!position) return;
    ref.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPosition(null);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [position]);
  if (!position) return null;
  const selected = engine.editing.state.selected;
  const ids = selected.length
    ? [
        "copy",
        "cut",
        "paste",
        "duplicate",
        ...(selected.length > 1 ? ["group"] : []),
        ...(selected.some((s) => s.type === "group") ? ["ungroup"] : []),
        ...(selected.length === 1 && selected[0].type === "equation"
          ? ["equation"]
          : []),
        "front",
        "back",
        "delete",
      ]
    : ["paste", "all", "fit"];
  return (
    <div
      ref={ref}
      className="board-context-menu"
      role="menu"
      aria-label="Board actions"
      style={{ left: position.x, top: position.y }}
      onKeyDown={(e) => {
        const buttons = [
            ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ],
          at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setPosition(null);
          engine.editing.focus();
        }
      }}
    >
      {engine.commands.entries(ids).map((c) => (
        <button
          key={c.id}
          role="menuitem"
          disabled={!c.enabled}
          onClick={() => {
            setPosition(null);
            engine.commands.execute(c.id);
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
