import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useValue } from "tldraw";
import { createPortal } from "react-dom";
import type { TLShapeId } from "tldraw";
import type { BoardEngine } from "../../modules/board/engine.ts";
import { openInteractiveEvent } from "../../modules/interactive/InteractiveShape.tsx";
import { scopedInteractive } from "../../modules/interactive/board.ts";
import type { InteractiveRequest } from "./InteractiveDialog.tsx";

const InteractiveDialog = lazy(() => import("./InteractiveDialog.tsx"));

export function InteractiveTools({
  engine,
  canInsert,
}: {
  engine: BoardEngine;
  canInsert: boolean;
}) {
  const editor = engine.pages.editor;
  const [request, setRequest] = useState<InteractiveRequest | null>(null);
  const currentPage = useValue(
    "interactive page",
    () => editor.getCurrentPageId(),
    [editor],
  );
  const scope = engine.scope();
  const session = useSyncExternalStore(
    engine.session.subscribe,
    engine.session.getSnapshot,
  );

  useEffect(() => {
    const host = editor.getContainer();
    const open = (event: Event) => {
      const id = (event as CustomEvent<TLShapeId>).detail;
      const nextScope = engine.scope();
      if (scopedInteractive(engine, nextScope, id)) {
        engine.editing.closeMath();
        setRequest({ kind: "material", scope: nextScope, id });
      }
    };
    const close = () => setRequest(null);
    host.addEventListener(openInteractiveEvent, open);
    host.addEventListener("lessonboard:interactive-cancel", close);
    return () => {
      host.removeEventListener(openInteractiveEvent, open);
      host.removeEventListener("lessonboard:interactive-cancel", close);
    };
  }, [editor, engine]);

  if (session.active !== engine.surface) return null;
  return (
    <>
      {canInsert ? (
        <button
          type="button"
          className="interactive-launch"
          disabled={editor.getIsReadonly()}
          onClick={() => {
            engine.editing.closeMath();
            setRequest({ kind: "import", scope: engine.scope() });
          }}
        >
          Chèn mô phỏng
        </button>
      ) : null}
      {request && request.scope === scope
        ? createPortal(
            <Suspense fallback={<p role="status">Đang mở mô phỏng…</p>}>
              <InteractiveDialog
                key={
                  currentPage +
                  ":" +
                  request.scope +
                  ":" +
                  (request.kind === "material" ? request.id : "import")
                }
                engine={engine}
                request={request}
                onClose={() => setRequest(null)}
              />
            </Suspense>,
            document.body,
          )
        : null}
    </>
  );
}
