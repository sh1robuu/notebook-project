import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useValue } from "tldraw";
import type { TLShapeId } from "tldraw";
import type { BoardEngine } from "../../modules/board/engine.ts";
import { scopedInteractive } from "../../modules/interactive/board.ts";
import { InsertInteractive } from "./InsertInteractive.tsx";
import { MaterialPanel } from "./MaterialPanel.tsx";
import "./interactive.css";

export type InteractiveRequest =
  | { kind: "import"; scope: string }
  | { kind: "material"; scope: string; id: TLShapeId };

export default function InteractiveDialog({
  engine,
  request,
  onClose,
}: {
  engine: BoardEngine;
  request: InteractiveRequest;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [large, setLarge] = useState(false);
  const [docked, setDocked] = useState(false);
  const shape = useValue(
    "active interactive material",
    () =>
      request.kind === "material"
        ? scopedInteractive(engine, request.scope, request.id)
        : undefined,
    [engine, request],
  );
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const available =
    request.kind === "import" ? !state.readOnly : Boolean(shape);
  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement;
    return () => {
      if (node?.open) node.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const node = dialog.current;
    if (node?.open) node.close();
    if (docked) node?.show();
    else node?.showModal();
    closeButton.current?.focus({ preventScroll: true });
  }, [docked]);
  const title = request.kind === "import" ? "Chèn mô phỏng" : "Mô phỏng";
  return (
    <dialog
      ref={dialog}
      className="interactive-dialog"
      data-expanded={large}
      data-docked={docked}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (large) setLarge(false);
        else onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && docked) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="interactive-heading">
        <h2 id={id}>{title}</h2>
        <div className="interactive-actions">
          {request.kind === "material" && shape ? (
            <>
              <button
                type="button"
                aria-pressed={docked}
                onClick={() => {
                  setLarge(false);
                  setDocked(!docked);
                }}
              >
                {docked ? "Mở giữa màn hình" : "Ghim cạnh bảng"}
              </button>
              <button
                type="button"
                aria-pressed={large}
                onClick={() => {
                  setDocked(false);
                  setLarge(!large);
                }}
              >
                {large ? "Thu nhỏ" : "Toàn màn hình"}
              </button>
            </>
          ) : null}
          <button type="button" ref={closeButton} onClick={onClose}>
            Đóng
          </button>
        </div>
      </header>
      {!available ? (
        <p role="status">
          Trang hoặc quyền chỉnh sửa đã thay đổi. Hãy đóng cửa sổ này.
        </p>
      ) : request.kind === "import" ? (
        <InsertInteractive
          engine={engine}
          scope={request.scope}
          onDone={onClose}
        />
      ) : shape ? (
        <MaterialPanel
          engine={engine}
          scope={request.scope}
          shape={shape}
          readOnly={state.readOnly || shape.isLocked}
        />
      ) : null}
    </dialog>
  );
}
