import { useEffect, useRef, useState } from "react";
import { useValue } from "tldraw";
import type { BoardEngine } from "../modules/board/engine.ts";
import type { ExportOptions } from "../modules/pdf/export.ts";
import { checkAbort } from "../modules/pdf/runtime.ts";
import { validatePaper } from "../modules/workspace/lesson-view.ts";
import { playbackKey } from "./pptx/SlideCanvas.tsx";
const defaults: ExportOptions = {
  format: "png",
  scope: "current",
  range: "1",
  includeScratch: false,
  background: true,
  annotations: true,
  scale: 2,
  region: { x: 0, y: 0, w: 640, h: 480 },
  selected: [],
};
export function ExportDialog({ engine }: { engine: BoardEngine }) {
  const session = engine.session;
  const editor = engine.pages.editor;
  const paper = useValue(
    "export current paper",
    () => validatePaper(editor.getCurrentPage().meta.paper),
    [editor],
  );
  const [open, setOpen] = useState(false),
    [options, setOptions] = useState(defaults),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(""),
    [currentBuild, setCurrentBuild] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => () => abort.current?.abort(), []);
  function cancel() {
    abort.current?.abort();
    setBusy(false);
    setOpen(false);
    setProgress("");
  }
  async function prepare() {
    if (busy) return;
    const job = new AbortController();
    abort.current = job;
    setBusy(true);
    setError("");
    setProgress("Capturing lesson…");
    try {
      for (const e of session.engines.values()) e.cancel();
      const lesson = session.getLesson();
      const snapshot = {
        ...lesson,
        document: structuredClone(lesson.document),
        scratchpad: structuredClone(lesson.scratchpad),
        view: structuredClone(lesson.view),
      };
      const selected = [
        ...(session.engines.get("main")?.pages.editor.getSelectedShapeIds() ??
          []),
      ];
      const passwords = Object.fromEntries(
        Object.keys(lesson.pdfSources).flatMap((id) => {
          const p = session.pdf.password(id);
          return p === undefined ? [] : [[id, p]];
        }),
      );
      const frame = session.slides.getSnapshot();
      const slideFrame =
        currentBuild &&
        paper.kind === "pptx" &&
        frame.key === playbackKey(snapshot.pageId, paper.sourceId!)
          ? { pageId: snapshot.pageId, hiddenIds: [...frame.hidden] }
          : undefined;
      const { createExport } = await import("../modules/pdf/export.ts");
      checkAbort(job.signal);
      const result = await createExport(
        snapshot,
        { ...options, selected, slideFrame },
        passwords,
        job.signal,
        setProgress,
      );
      checkAbort(job.signal);
      const blob = new Blob([new Uint8Array(result.bytes).buffer], {
          type: result.mime,
        }),
        url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download =
          (lesson.title.trim() || "Lesson")
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
            .slice(0, 100) +
          "." +
          result.extension;
        a.click();
        setProgress(
          `Download prepared (${result.bytes.length.toLocaleString()} bytes${result.extension === "pdf" ? `, ${result.rasterLayers} raster fallback layers` : ""}). Check the downloaded file before sharing.`,
        );
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (e) {
      if (!job.signal.aborted) {
        setError(
          e instanceof Error ? e.message : "Export could not be prepared.",
        );
        setProgress("");
      }
    } finally {
      if (abort.current === job) setBusy(false);
    }
  }
  function update(value: Partial<ExportOptions>) {
    setOptions((old) => ({ ...old, ...value }));
    setError("");
    setProgress("");
  }
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          setError("");
          setProgress("");
        }}
      >
        Export
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="export-title"
        onCancel={(ev) => {
          ev.preventDefault();
          cancel();
        }}
      >
        <h2 id="export-title">Export</h2>
        <div className="export-fields">
          <label>
            Format
            <select
              aria-label="Export format"
              value={options.format}
              disabled={busy}
              onChange={(ev) =>
                update({
                  format: ev.target.value as "png" | "pdf",
                  scope: "current",
                })
              }
            >
              <option value="png">PNG image</option>
              <option value="pdf">PDF document</option>
            </select>
          </label>
          <label>
            Scope
            <select
              aria-label="Export scope"
              value={options.scope}
              disabled={busy}
              onChange={(ev) =>
                update({ scope: ev.target.value as ExportOptions["scope"] })
              }
            >
              <option value="current">
                Current main page · full finite paper
              </option>
              {options.format === "pdf" ? (
                <>
                  <option value="range">Main page range</option>
                  <option value="all">All main pages</option>
                </>
              ) : (
                <>
                  <option value="selection">Selected main objects</option>
                  <option value="region">Numeric main region</option>
                </>
              )}
              <option value="scratchpad">Scratchpad only</option>
            </select>
          </label>
          {options.scope === "range" ? (
            <label>
              Page range
              <input
                aria-label="Export page range"
                value={options.range}
                disabled={busy}
                onChange={(ev) => update({ range: ev.target.value })}
              />
            </label>
          ) : null}
          {options.scope === "region" ? (
            <fieldset>
              <legend>World coordinates</legend>
              {(["x", "y", "w", "h"] as const).map((key) => (
                <label key={key}>
                  {key}
                  <input
                    aria-label={"Region " + key}
                    type="number"
                    value={options.region[key]}
                    disabled={busy}
                    onChange={(ev) =>
                      update({
                        region: {
                          ...options.region,
                          [key]: ev.target.valueAsNumber,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </fieldset>
          ) : null}
          {options.format === "pdf" && options.scope !== "scratchpad" ? (
            <label>
              <input
                type="checkbox"
                disabled={busy}
                checked={options.includeScratch}
                onChange={(ev) => update({ includeScratch: ev.target.checked })}
              />
              Append scratchpad explicitly
            </label>
          ) : null}
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={options.background}
              onChange={(ev) => update({ background: ev.target.checked })}
            />
            {paper.kind === "pptx"
              ? "Include slide / paper background"
              : "Include PDF / paper background"}
          </label>
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={options.annotations}
              onChange={(ev) => update({ annotations: ev.target.checked })}
            />
            Include editable annotations
          </label>
          {options.format === "png" ? (
            <label>
              Resolution
              <select
                aria-label="Export resolution"
                value={options.scale}
                disabled={busy}
                onChange={(ev) => update({ scale: Number(ev.target.value) })}
              >
                <option value={1}>1 pixel / world unit</option>
                <option value={2}>2 pixels / world unit</option>
                <option value={3}>3 pixels / world unit</option>
              </select>
            </label>
          ) : null}
          {paper.kind === "pptx" &&
          options.background &&
          options.scope !== "scratchpad" ? (
            <label>
              PowerPoint build state
              <select
                disabled={busy}
                value={currentBuild ? "current" : "all"}
                onChange={(event) =>
                  setCurrentBuild(event.target.value === "current")
                }
              >
                <option value="all">All supported builds</option>
                <option value="current">Current build (active slide)</option>
              </select>
            </label>
          ) : null}
        </div>
        <p>
          PNG output is opaque. Viewport, controls, selection handles and laser
          marks are excluded. Work is captured when you prepare the export.
          Generated files are unencrypted. Source signatures and permission
          restrictions are not preserved. Structured Word pages include all
          compiled blocks, including content not yet revealed in teaching mode.
          Word blocks use raster layers; editable source stays in the lesson
          archive. Native DOCX export is not available.
        </p>
        {paper.kind === "pptx" ? (
          <p>
            PowerPoint exports use static slide backgrounds. Other slides in a
            range include all supported builds. Annotations are included
            according to your export settings.
          </p>
        ) : null}
        {options.format === "pdf" ? (
          <p>
            Original PDF text and vectors are retained on supported static
            pages. Text, equations, images, dashed/dotted strokes and
            unsupported SVG roots use transparent PNG layers at 2 pixels/world
            unit (144 dpi on PDF pages; 192 dpi on blank paper). Pages with
            supported static PDF annotation appearances use a 144 dpi raster
            background. These layers are not searchable text. No OCR,
            interactive forms, links or scripts are exported.
          </p>
        ) : null}
        {progress ? <p role="status">{progress}</p> : null}
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button onClick={cancel}>{busy ? "Cancel export" : "Close"}</button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void prepare()}
          >
            {busy ? "Preparing…" : "Prepare export"}
          </button>
        </div>
      </dialog>
    </>
  );
}
