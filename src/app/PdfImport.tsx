import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { BoardEngine } from "../modules/board/engine.ts";
import type { PdfSource } from "../modules/pdf/sources.ts";
import { inspectPdf, abortError } from "../modules/pdf/runtime.ts";
import { importedLesson } from "../modules/pdf/import.ts";
import { beginOperation } from "../modules/workspace/activity.ts";
export function PdfImport({ engine }: { engine: BoardEngine }) {
  const session = engine.session,
    ui = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [open, setOpen] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [fileLabel, setFileLabel] = useState(""),
    [busy, setBusy] = useState(false),
    [committing, setCommitting] = useState(false),
    [candidate, setCandidate] = useState<{
      source: PdfSource;
      password?: string;
    }>(),
    [password, setPassword] = useState(""),
    [passwordPrompt, setPasswordPrompt] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    abort = useRef<AbortController | null>(null),
    answer = useRef<((value: string) => void) | null>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(
    () => () => {
      abort.current?.abort();
      answer.current = null;
    },
    [],
  );
  function cancel() {
    if (committing) return;
    abort.current?.abort();
    answer.current = null;
    setPassword("");
    setPasswordPrompt(false);
    setCandidate(undefined);
    setOpen(false);
    setProgress("");
    setFileLabel("");
    setBusy(false);
  }
  async function choose(file: File) {
    const finish = beginOperation("Kiểm tra PDF");
    setFileLabel(file.name + " · " + file.size.toLocaleString() + " bytes");
    abort.current?.abort();
    const job = new AbortController();
    abort.current = job;
    const scope = session.scope();
    setOpen(true);
    setCandidate(undefined);
    setError("");
    setBusy(true);
    try {
      const result = await inspectPdf(
        file,
        job.signal,
        setProgress,
        (wrong) =>
          new Promise((resolve, reject) => {
            if (job.signal.aborted) {
              reject(abortError());
              return;
            }
            setError(wrong ? "Incorrect PDF password. Try again." : "");
            setPassword("");
            setPasswordPrompt(true);
            const cancelled = () => reject(abortError());
            answer.current = (value) => {
              job.signal.removeEventListener("abort", cancelled);
              resolve(value);
            };
            job.signal.addEventListener("abort", cancelled, {
              once: true,
            });
          }),
      );
      if (job.signal.aborted || scope !== session.scope()) throw abortError();
      setCandidate(result);
      setProgress("Checked original PDF; no lesson changes yet.");
    } catch (e) {
      if (!job.signal.aborted)
        setError(
          e instanceof Error ? e.message : "The PDF could not be imported.",
        );
    } finally {
      finish();
      if (abort.current === job) {
        setBusy(false);
        setPasswordPrompt(false);
        setPassword("");
        answer.current = null;
        abort.current = null;
      }
    }
  }
  async function commit(mode: "append" | "replace") {
    if (!candidate || committing) return;
    const finish = beginOperation("Lưu PDF vào bài giảng");
    setCommitting(true);
    setError("");
    try {
      for (const e of session.engines.values()) e.cancel();
      const main = session.engines.get("main");
      if (!main) throw new Error("The main board is not ready.");
      const bounds = main.pages.editor.getViewportScreenBounds();
      const next = importedLesson(
        session.getLesson(),
        candidate.source,
        mode,
        bounds,
      );
      await session.restore(
        next,
        candidate.password !== undefined
          ? { [candidate.source.id]: candidate.password }
          : undefined,
      );
      setCandidate(undefined);
      setOpen(false);
      setPassword("");
      setProgress("");
      session.notify(
        "PDF imported. Original source preserved; annotations remain editable. Previous lesson is available.",
      );
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "PDF import failed."} The previous lesson and scratchpad have been kept.`,
      );
    } finally {
      finish();
      setCommitting(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    window.addEventListener(
      "dragover",
      (ev) => {
        if (
          Array.from(ev.dataTransfer?.items ?? []).some(
            (i) => i.type === "application/pdf",
          )
        )
          ev.preventDefault();
      },
      { capture: true, signal: controller.signal },
    );
    window.addEventListener(
      "drop",
      (ev) => {
        const files = Array.from(ev.dataTransfer?.files ?? []),
          pdf = files.find(
            (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name),
          );
        if (!pdf) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (session.workspace.readOnly || session.state.presentation) return;
        if (files.length !== 1) {
          setError("Drop one PDF at a time.");
          setOpen(true);
          return;
        }
        void choose(pdf);
      },
      { capture: true, signal: controller.signal },
    );
    return () => controller.abort();
  });
  return (
    <>
      <button
        disabled={session.workspace.readOnly || ui.presentation || committing}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        Import PDF
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="context-panel context-panel-edge document-import-panel"
          aria-labelledby="pdf-import-title"
          onCancel={(ev) => {
            ev.preventDefault();
            cancel();
          }}
        >
          <header className="context-panel-heading">
            <h2 id="pdf-import-title">Import PDF</h2>
          </header>
          <p>
            Choose or drop one local PDF, up to 50 MB and 200 pages. Documents
            stay on this device.
          </p>
          <label>
            PDF file
            <input
              type="file"
              aria-label="PDF file"
              accept=".pdf,application/pdf"
              disabled={busy || committing}
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                ev.target.value = "";
                if (f) void choose(f);
              }}
            />
          </label>
          {fileLabel ? <p>{fileLabel}</p> : null}
          {progress ? <p role="status">{progress}</p> : null}
          {passwordPrompt ? (
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                const resolve = answer.current;
                answer.current = null;
                setPasswordPrompt(false);
                resolve?.(password);
                setPassword("");
              }}
            >
              <label>
                PDF password
                <input
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  autoFocus
                />
              </label>
              <button type="submit">Continue with password</button>
            </form>
          ) : null}
          {candidate ? (
            <>
              <p>
                <strong>{candidate.source.name}</strong> ·{" "}
                {candidate.source.size.toLocaleString()} bytes ·{" "}
                {candidate.source.pages.length} pages
              </p>
              <p>
                Import commits only after validation and storage succeed.
                Current work is saved first. Main-page undo history resets;
                Previous lesson returns to this work. Scratchpad content and
                view stay.
              </p>
              {candidate.source.pages.some((p) => p.rasterOnly) ? (
                <p>
                  Supported PDF annotation appearances are static. Affected
                  backgrounds use 144 dpi raster PDF export.
                </p>
              ) : null}
              {candidate.source.encrypted ? (
                <p>
                  Encrypted original retained. Unlock again after reopening;
                  passwords are never saved.
                </p>
              ) : null}
            </>
          ) : null}
          {error ? (
            <p role="alert" className="dialog-error">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button disabled={committing} onClick={cancel}>
              {busy ? "Cancel import" : "Cancel"}
            </button>
            <button
              disabled={!candidate || busy || committing}
              onClick={() => void commit("append")}
            >
              Append PDF pages
            </button>
            <button
              className="primary"
              disabled={!candidate || busy || committing}
              onClick={() => void commit("replace")}
            >
              {committing ? "Committing…" : "Replace main pages"}
            </button>
          </div>
        </dialog>,
        engine.pages.editor.getContainer().closest(".workspace") ??
          document.body,
      )}
    </>
  );
}
