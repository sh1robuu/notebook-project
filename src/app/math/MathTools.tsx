import { lazy, Suspense, useRef } from "react";
import { createPortal } from "react-dom";
import type { BoardEngine } from "../../modules/board/engine.ts";
import type { MathPanelRequest } from "../../modules/board/editing.ts";
import { Icon } from "../Icon.tsx";
const MathPanel = lazy(() => import("./MathPanel.tsx"));
const tools = [
  ["graph", "Function graph"],
  ["variation", "Variation table"],
  ["calculator", "Scientific calculator"],
] as const;

export function MathTools({
  engine,
  request,
  readOnly,
}: {
  engine: BoardEngine;
  request: MathPanelRequest | null;
  readOnly: boolean;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const editing = engine.editing;
  return (
    <>
      <details className="math-tools" data-tool-disclosure ref={disclosure}>
        <summary
          className="chrome-control"
          ref={summary}
          role="button"
          aria-label="Math tools"
          title="Math tools"
        >
          <Icon name="graph" />
          <span>Math tools</span>
        </summary>
        <div className="math-tool-list">
          {tools.map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              disabled={readOnly && kind !== "calculator"}
              onClick={() => {
                if (disclosure.current) disclosure.current.open = false;
                summary.current?.focus();
                editing.openMath(kind);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </details>
      {request
        ? createPortal(
            <Suspense fallback={<p role="status">Opening math tools…</p>}>
              <MathPanel
                key={
                  request.scope +
                  ":" +
                  request.kind +
                  ":" +
                  (request.shape?.id ?? "new")
                }
                request={request}
                engine={engine}
                readOnly={readOnly}
              />
            </Suspense>,
            engine.pages.editor.getContainer().closest(".workspace") ??
              document.body,
          )
        : null}
    </>
  );
}
