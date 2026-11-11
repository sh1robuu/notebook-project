import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { BoardEngine } from "../../modules/board/engine.ts";
import type { MathPanelRequest } from "../../modules/board/editing.ts";
import { MathWorkerClient } from "../../modules/math/worker-client.ts";
import { GraphDialog } from "./GraphDialog.tsx";
import { VariationDialog } from "./VariationDialog.tsx";
import { Calculator } from "./Calculator.tsx";
import { Icon } from "../Icon.tsx";
import "../context-tools.css";
import "./math.css";

export default function MathPanel({
  engine,
  request,
  readOnly,
}: {
  engine: BoardEngine;
  request: MathPanelRequest;
  readOnly: boolean;
}) {
  const [worker] = useState(() => new MathWorkerClient());
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => engine.editing.closeMath();
  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement;
    node?.showModal();
    node
      ?.querySelector<HTMLInputElement>("input.math-input")
      ?.focus({ preventScroll: true });
    return () => {
      worker.close();
      if (node?.open) node.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, [worker]);
  let title: string;
  let panel: ReactNode;
  const original = request.shape?.props.figure;
  if (request.kind === "graph") {
    title = request.shape ? "Edit function graph" : "Function graph";
    panel = (
      <GraphDialog
        worker={worker}
        original={original?.kind === "graph" ? original : undefined}
        editing={!!request.shape}
        onSave={(figure, dimensions) => {
          const saved = engine.editing.saveMath(figure, dimensions);
          if (saved) close();
          return saved;
        }}
      />
    );
  } else if (request.kind === "variation") {
    title = request.shape ? "Edit variation table" : "Variation table";
    panel = (
      <VariationDialog
        worker={worker}
        original={original?.kind === "variation" ? original : undefined}
        editing={!!request.shape}
        onSave={(figure, dimensions) => {
          const saved = engine.editing.saveMath(figure, dimensions);
          if (saved) close();
          return saved;
        }}
      />
    );
  } else {
    title = "Scientific calculator";
    panel = (
      <Calculator
        worker={worker}
        readOnly={readOnly}
        onInsert={(text) => engine.editing.insertCalculation(text)}
      />
    );
  }
  return (
    <dialog
      className={
        request.kind === "calculator"
          ? "context-panel context-panel-edge math-dialog calculator-dialog"
          : "context-panel context-panel-edge math-dialog"
      }
      ref={dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="context-panel-heading math-dialog-header">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="context-panel-close"
          aria-label="Close"
          title="Close (Esc)"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </header>
      {panel}
    </dialog>
  );
}
