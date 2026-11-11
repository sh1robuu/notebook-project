import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Box, useValue } from "tldraw";
import { TextLayer } from "pdfjs-dist";
import type { LessonSession } from "../modules/board/lesson-session.ts";
import type { BoardEngine } from "../modules/board/engine.ts";
import type { Paper } from "../modules/workspace/lesson-view.ts";
import { validatePaper } from "../modules/workspace/lesson-view.ts";
import { pdfTask } from "../modules/pdf/runtime.ts";
import { Icon } from "./Icon.tsx";
export const PdfSessionContext = createContext<LessonSession | null>(null);
export function PdfCanvas({ paper, zoom }: { paper: Paper; zoom: number }) {
  const session = useContext(PdfSessionContext),
    canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("loading");
  const ui = useSyncExternalStore(
    session?.subscribe ?? (() => () => {}),
    session?.getSnapshot ?? (() => null),
  );
  const source = session?.workspace.lesson.pdfSources[paper.sourceId ?? ""];
  const secret = session?.pdf.password(paper.sourceId ?? "");
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  useEffect(() => {
    const update = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener("resize", update);
    let media = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const changed = () => {
      update();
      media.removeEventListener("change", changed);
      media = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      media.addEventListener("change", changed);
    };
    media.addEventListener("change", changed);
    return () => {
      window.removeEventListener("resize", update);
      media.removeEventListener("change", changed);
    };
  }, []);
  const scale = Math.ceil(zoom * dpr * 2) / 2;
  useEffect(() => {
    if (!session || !source || !canvas.current) return;
    const abort = new AbortController(),
      element = canvas.current;
    setStatus("loading");
    void session.pdf
      .paint(source, paper.pageIndex!, scale, abort.signal)
      .then((image) => {
        if (abort.signal.aborted) return;
        element.width = image.width;
        element.height = image.height;
        element.getContext("2d")!.drawImage(image, 0, 0);
        setStatus("ready");
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setStatus("error");
          session.notify(
            source.encrypted
              ? "Unlock this PDF to display and export it. Passwords are not saved."
              : `PDF rendering failed: ${e instanceof Error ? e.message : "unknown error"}`,
          );
        }
      });
    return () => {
      abort.abort();
      element.width = element.height = 0;
    };
  }, [session, source, paper.pageIndex, scale, secret, ui?.editorEpoch]);
  return (
    <>
      <canvas
        ref={canvas}
        data-pdf-render={status}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {status !== "ready" ? (
        <span className="pdf-canvas-status">
          {status === "error"
            ? "PDF unavailable · see PDF controls"
            : "Rendering PDF…"}
        </span>
      ) : null}
    </>
  );
}
export function PdfControls({ engine }: { engine: BoardEngine }) {
  const session = engine.session,
    e = engine.pages.editor;
  const ui = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const page = useValue("PDF current page", () => e.getCurrentPage(), [e]);
  const paper = validatePaper(page.meta.paper),
    source = session.workspace.lesson.pdfSources[paper.sourceId ?? ""];
  const [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [unlock, setUnlock] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (unlock) dialog.current?.showModal();
    else dialog.current?.close();
  }, [unlock]);
  useEffect(() => {
    if (paper.kind !== "pdf" && session.state.reading)
      session.setReading(false);
  }, [paper.kind, session]);
  if (!source) return null;
  async function unlockPdf() {
    if (!source || busy) return;
    setBusy(true);
    setError("");
    const task = pdfTask(source.bytes, secret);
    task.onPassword = () => void task.destroy();
    try {
      await task.promise;
      session.pdf.setPassword(source.id, secret);
      setSecret("");
      setUnlock(false);
      session.notify("PDF unlocked for this lesson session.");
    } catch {
      setError("The PDF could not be unlocked. Check the password.");
    } finally {
      await task.destroy();
      setBusy(false);
    }
  }
  return (
    <div className="pdf-controls" role="group" aria-label="PDF controls">
      <span title={`${source.name} · source page ${paper.pageIndex! + 1}`}>
        {source.name} · source page {paper.pageIndex! + 1}
      </span>
      <button onClick={() => session.setReading(!ui.reading)}>
        {ui.reading ? "Annotate PDF" : "Read PDF text"}
      </button>
      <button
        type="button"
        className="context-icon"
        aria-label="Fit PDF page"
        title="Fit PDF page"
        onClick={() => {
          e.updateViewportScreenBounds(e.getContainer());
          e.zoomToBounds(new Box(0, 0, paper.width, paper.height));
        }}
      >
        <Icon name="fit" />
      </button>
      {source.encrypted ? (
        <button
          onClick={() => {
            setUnlock(true);
            setError("");
          }}
        >
          Unlock PDF
        </button>
      ) : null}
      <small>
        {source.pages[paper.pageIndex!].hasText
          ? "Text selection is available in reading mode."
          : "Scanned/image page · no OCR text."}
      </small>
      {source.pages[paper.pageIndex!].rasterOnly ? (
        <small>
          Existing PDF annotations are static. PDF export uses a raster
          background for this page.
        </small>
      ) : null}
      <dialog
        ref={dialog}
        className="context-panel context-panel-edge document-import-panel"
        aria-labelledby="unlock-pdf-title"
        onCancel={() => {
          setSecret("");
          setUnlock(false);
        }}
      >
        <header className="context-panel-heading">
          <h2 id="unlock-pdf-title">Unlock PDF</h2>
        </header>
        <p>The password stays in memory until this lesson closes.</p>
        <label>
          PDF password
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(ev) => setSecret(ev.target.value)}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button
            disabled={busy}
            onClick={() => {
              setSecret("");
              setUnlock(false);
            }}
          >
            Cancel
          </button>
          <button disabled={busy || !secret} onClick={() => void unlockPdf()}>
            Unlock for this session
          </button>
        </div>
      </dialog>
    </div>
  );
}
export function PdfReadingLayer({ engine }: { engine: BoardEngine }) {
  const session = engine.session,
    e = engine.pages.editor;
  const ui = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const paper = useValue(
    "reading page",
    () => validatePaper(e.getCurrentPage().meta.paper),
    [e],
  );
  const camera = useValue("reading camera", () => e.getCamera(), [e]);
  const container = useRef<HTMLDivElement>(null),
    region = useRef<HTMLDivElement>(null),
    [error, setError] = useState("");
  const source = session.workspace.lesson.pdfSources[paper.sourceId ?? ""];
  useEffect(() => {
    if (ui.reading) region.current?.focus();
  }, [ui.reading]);
  useEffect(() => {
    if (!ui.reading || !source || !container.current) return;
    const el = container.current,
      abort = new AbortController();
    let layer: TextLayer | undefined;
    el.replaceChildren();
    setError("");
    void session.pdf
      .document(source)
      .then((pdf) => pdf.getPage(paper.pageIndex! + 1))
      .then(async (page) => {
        const text = await page.getTextContent();
        if (abort.signal.aborted) return;
        layer = new TextLayer({
          textContentSource: text,
          container: el,
          viewport: page.getViewport({ scale: 1 }),
        });
        // PDF.js lays out text in unrotated crop coordinates. Its own rotation
        // rules act on this inner plane; the outer plane carries only camera.
        const [left, bottom, right, top] = page.view;
        el.style.width = (right - left) * page.userUnit + "px";
        el.style.height = (top - bottom) * page.userUnit + "px";
        el.style.setProperty("--total-scale-factor", String(page.userUnit));
        await layer.render();
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Text could not be loaded.",
          );
      });
    return () => {
      abort.abort();
      layer?.cancel();
      el.replaceChildren();
    };
  }, [session, source, paper.pageIndex, ui.reading]);
  if (!ui.reading || !source) return null;
  return (
    <div
      className="pdf-reading"
      ref={region}
      data-pdf-reading="true"
      role="region"
      tabIndex={0}
      aria-label="Selectable PDF text"
      onPointerDown={(ev) => ev.stopPropagation()}
      onCopy={(ev) => ev.stopPropagation()}
      onCut={(ev) => ev.stopPropagation()}
      onPaste={(ev) => ev.stopPropagation()}
    >
      {error ? <p role="alert">{error} Unlock the PDF if needed.</p> : null}
      {!source.pages[paper.pageIndex!].hasText ? (
        <p className="pdf-read-notice">
          This page has no selectable text. OCR is not implemented.
        </p>
      ) : null}
      <div
        className="pdf-text-viewport"
        style={{
          width: paper.width,
          height: paper.height,
          left: camera.x * camera.z,
          top: camera.y * camera.z,
          transform: `scale(${camera.z})`,
        }}
      >
        <div
          ref={container}
          data-testid="pdf-text-layer"
          className="pdf-text-layer"
        />
      </div>
    </div>
  );
}
