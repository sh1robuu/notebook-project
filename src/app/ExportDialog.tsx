import { useEffect, useRef, useState } from "react";
import { useValue } from "tldraw";
import type { BoardEngine } from "../modules/board/engine.ts";
import type { ExportOptions } from "../modules/pdf/export.ts";
import { InteractiveExportWarning } from "../modules/pdf/export-contract.ts";
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
    [currentBuild, setCurrentBuild] = useState(false),
    [missingPreviews, setMissingPreviews] = useState<readonly string[]>([]);
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
  async function prepare(allowInteractivePlaceholders = false) {
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
        { ...options, selected, slideFrame, allowInteractivePlaceholders },
        passwords,
        job.signal,
        setProgress,
      );
      checkAbort(job.signal);
      setMissingPreviews([]);
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
          `Download ready (${result.bytes.length.toLocaleString()} bytes). Open the file to check it before sharing.`,
        );
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (e) {
      if (!job.signal.aborted) {
        if (e instanceof InteractiveExportWarning) {
          setMissingPreviews(e.titles);
          setProgress("");
          return;
        }
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
    setMissingPreviews([]);
  }
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          setError("");
          setProgress("");
          setMissingPreviews([]);
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
          Exports capture the page when you select Prepare export. Controls and
          laser marks are left out. PNGs have a solid background. Exported files
          are not encrypted and do not retain the original file's signatures or
          permissions. Word pages include all content, even parts not yet shown
          while teaching. Keep a .teachboard file to edit your work later;
          exporting to DOCX is not supported.
        </p>
        {paper.kind === "pptx" ? (
          <p>
            PowerPoint slides are exported as still images. Other slides in a
            selected range include all supported builds.
          </p>
        ) : null}
        {options.format === "pdf" ? (
          <p>
            Original PDF text stays searchable where supported. Added text,
            equations and some graphics are exported as images. Some annotated
            PDF pages are also flattened to images. Forms, links and scripts are
            not included, and scanned text is not made searchable.
          </p>
        ) : null}
        {progress ? <p role="status">{progress}</p> : null}
        {missingPreviews.length ? (
          <div role="alert">
            <p>
              Chưa có ảnh tĩnh cho {missingPreviews.length} mô phỏng. Bạn có thể
              xuất với thẻ tên, hoặc quay lại để thêm ảnh minh họa.
            </p>
            <ul>
              {missingPreviews.slice(0, 8).map((title, index) => (
                <li key={index}>{title}</li>
              ))}
              {missingPreviews.length > 8 ? (
                <li>Và {missingPreviews.length - 8} mô phỏng khác</li>
              ) : null}
            </ul>
          </div>
        ) : null}
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
            onClick={() => void prepare(missingPreviews.length > 0)}
          >
            {busy
              ? "Preparing…"
              : missingPreviews.length
                ? "Xuất với thẻ tên"
                : "Prepare export"}
          </button>
        </div>
      </dialog>
    </>
  );
}
