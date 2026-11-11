import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import type { BoardEngine } from "../../modules/board/engine.ts";
import { Icon } from "../Icon.tsx";

const Caller = lazy(() => import("./Caller.tsx"));

export function CallerTools({ engine }: { engine: BoardEngine }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Gọi học sinh"
        title="Gọi học sinh"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="caller" />
      </button>
      {open
        ? createPortal(
            <Suspense
              fallback={
                <p role="status" className="file-message">
                  Đang mở bộ gọi học sinh…
                </p>
              }
            >
              <Caller engine={engine} onClose={() => setOpen(false)} />
            </Suspense>,
            engine.pages.editor.getContainer().closest(".workspace") ??
              document.body,
          )
        : null}
    </>
  );
}
