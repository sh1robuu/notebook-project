import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { BoardEngine } from "../../modules/board/engine.ts";
import { PPTX_MIME } from "../../modules/pptx/model.ts";
import type { PptxImportResult } from "../../modules/pptx/model.ts";
import { missingSlideFonts } from "../../modules/pptx/render.ts";
import { SlideCanvas } from "./SlideCanvas.tsx";
import { SlideWarnings } from "./SlideControls.tsx";
import { beginOperation } from "../../modules/workspace/activity.ts";

const isPptx = (file: File) =>
  file.type === PPTX_MIME || /\.pptx$/i.test(file.name);

export function PptxImport({ engine }: { engine: BoardEngine }) {
  const { session } = engine;
  const ui = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(""),
    [preview, setPreview] = useState(0);
  const [candidate, setCandidate] = useState<{
    scope: string;
    result: PptxImportResult;
  }>();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const job = useRef<AbortController | null>(null);
  const commitInFlight = useRef(false);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else if (dialog.current?.open) {
      dialog.current.close();
      trigger.current?.focus();
    }
  }, [open]);
  useEffect(() => () => job.current?.abort(), []);
  const choose = useCallback(
    async (file: File) => {
      if (
        commitInFlight.current ||
        session.workspace.readOnly ||
        session.state.presentation
      )
        return;
      const finish = beginOperation("Kiểm tra PowerPoint");
      job.current?.abort();
      const next = new AbortController();
      job.current = next;
      const scope = session.scope();
      setOpen(true);
      setError("");
      setCandidate(undefined);
      setPreview(0);
      setBusy(true);
      setProgress("Reading " + file.name + "…");
      try {
        const { inspectPptx } = await import("../../modules/pptx/import.ts");
        next.signal.throwIfAborted();
        const result = await inspectPptx(file, next.signal, setProgress);
        next.signal.throwIfAborted();
        if (session.scope() !== scope)
          throw new Error("The lesson changed while checking the file.");
        setCandidate({ scope, result });
        setProgress(
          "Ready to import. Review the preview and compatibility notices.",
        );
      } catch (e) {
        if (!next.signal.aborted) {
          setError(
            e instanceof Error ? e.message : "PowerPoint import failed.",
          );
          setProgress("");
        }
      } finally {
        finish();
        if (job.current === next) {
          job.current = null;
          setBusy(false);
        }
      }
    },
    [session],
  );
  useEffect(() => {
    const controller = new AbortController();
    const options = { capture: true, signal: controller.signal };
    window.addEventListener(
      "dragover",
      (event) => {
        if (
          Array.from(event.dataTransfer?.items ?? []).some(
            (item) => item.type === PPTX_MIME,
          )
        )
          event.preventDefault();
      },
      options,
    );
    window.addEventListener(
      "drop",
      (event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        const file = files.find(isPptx);
        if (!file) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (
          commitInFlight.current ||
          session.workspace.readOnly ||
          session.state.presentation
        )
          return;
        if (files.length === 1) void choose(file);
        else {
          job.current?.abort();
          setCandidate(undefined);
          setProgress("");
          setError("Drop one PowerPoint file at a time.");
          setOpen(true);
        }
      },
      options,
    );
    return () => controller.abort();
  }, [choose, session]);
  function close() {
    if (commitInFlight.current) return;
    job.current?.abort();
    job.current = null;
    setBusy(false);
    setOpen(false);
    setCandidate(undefined);
    setProgress("");
    setError("");
  }
  async function confirm() {
    if (!candidate || commitInFlight.current) return;
    const finish = beginOperation("Lưu trang chiếu");
    commitInFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const { importedSlideLesson } =
        await import("../../modules/pptx/lesson-import.ts");
      if (
        session.scope() !== candidate.scope ||
        session.workspace.readOnly ||
        session.state.presentation
      )
        throw new Error("The lesson changed. Check the PowerPoint file again.");
      for (const e of session.engines.values()) e.cancel();
      const viewport = engine.pages.editor.getViewportScreenBounds();
      const next = importedSlideLesson(
        session.getLesson(),
        candidate.result,
        "append",
        viewport,
      );
      await session.restore(next);
      session.notify(
        "PowerPoint imported. Your original file is stored locally and annotations are editable.",
      );
      setOpen(false);
      setCandidate(undefined);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The slides could not be saved.",
      );
    } finally {
      finish();
      commitInFlight.current = false;
      setSaving(false);
    }
  }
  const deck = candidate?.result.document;
  const slide = deck?.slides[preview];
  const fonts = useMemo(() => (slide ? missingSlideFonts(slide) : []), [slide]);
  return (
    <>
      <button
        ref={trigger}
        disabled={session.workspace.readOnly || ui.presentation}
        onClick={() => setOpen(true)}
      >
        Import PowerPoint
      </button>
      <dialog
        ref={dialog}
        className="pptx-import"
        aria-labelledby="pptx-import-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <h2 id="pptx-import-title">Import PowerPoint</h2>
        <p>
          Choose a .pptx file or drop it here. PowerPoint content stays on this
          device.
        </p>
        <label>
          Choose a PPTX file
          <input
            type="file"
            accept={".pptx," + PPTX_MIME}
            disabled={saving}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void choose(file);
            }}
          />
        </label>
        {progress ? <p role="status">{progress}</p> : null}
        {candidate && deck && slide ? (
          <>
            <label>
              Preview slide
              <select
                value={preview}
                onChange={(event) => setPreview(Number(event.target.value))}
              >
                {deck.slides.map((s, i) => (
                  <option key={s.id} value={i}>
                    {i + 1} · {s.title}
                    {s.hidden ? " (hidden)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {deck.slides.length} slides · {Math.round(deck.width)} ×{" "}
              {Math.round(deck.height)} slide units. Preview shows all supported
              builds.
            </p>
            <div
              className="pptx-preview"
              style={{
                maxWidth: Math.min(480, (230 * deck.width) / deck.height),
              }}
            >
              <SlideCanvas
                key={slide.id}
                deck={deck}
                slide={slide}
                sources={candidate.result.sources}
              />
            </div>
            <SlideWarnings
              diagnostics={deck.diagnostics}
              missingFonts={fonts}
            />
          </>
        ) : null}
        {error ? (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button disabled={saving} onClick={close}>
            {busy ? "Cancel import" : "Close"}
          </button>
          <button
            className="primary"
            disabled={!candidate || busy || saving}
            onClick={() => void confirm()}
          >
            {saving ? "Saving slides…" : "Add slides"}
          </button>
        </div>
      </dialog>
    </>
  );
}
