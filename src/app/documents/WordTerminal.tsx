import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BoardEngine } from "../../modules/board/engine.ts";
import {
  emptyDocument,
  walkBlocks,
  documentText,
  validateDocument,
} from "../../modules/documents/model.ts";
import type {
  DocumentModel,
  DocumentImportResult,
  DocumentBlock,
} from "../../modules/documents/model.ts";
import type { DocumentSources } from "../../modules/documents/sources.ts";
import {
  replaceBlock,
  insertParagraph,
  deleteBlock,
} from "../../modules/documents/terminal-model.ts";
import { compileDocument } from "../../modules/documents/layout.ts";
import { getWordTeaching } from "../../modules/documents/teaching.ts";
import { BlockEditor } from "./BlockEditor.tsx";
import { WordPreview } from "./WordPreview.tsx";
type ClipboardInput = {
  html?: string;
  text?: string;
  rtf?: string;
  images?: File[];
};
type OpenDetail = {
  document?: DocumentModel;
  blockId?: string;
  clipboard?: ClipboardInput;
};
export function WordTerminal({ engine }: { engine: BoardEngine }) {
  const session = engine.session;
  useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [open, setOpen] = useState(false),
    [model, setModel] = useState<DocumentModel>(
      () => session.getWordDraft() ?? emptyDocument(),
    ),
    [sources, setSources] = useState<DocumentSources>(session.wordSources),
    [sourceText, setSourceText] = useState(""),
    [sourceDirty, setSourceDirty] = useState(false),
    [selected, setSelected] = useState(""),
    [dirty, setDirty] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [candidate, setCandidate] = useState<DocumentImportResult | null>(null),
    [confirm, setConfirm] = useState<
      "compile" | "replace" | "clear" | "close" | "delete" | null
    >(null),
    [compiled, setCompiled] = useState(false),
    [fileLabel, setFileLabel] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    picker = useRef<HTMLInputElement>(null),
    job = useRef<AbortController | null>(null);
  const blocks = walkBlocks(model),
    block = blocks.find((block) => block.id === selected) ?? blocks[0];
  function load(
    document: DocumentModel,
    nextSources = session.wordSources,
    blockId?: string,
  ) {
    setModel(structuredClone(document));
    setSources(nextSources);
    setSelected(blockId ?? document.blocks[0]?.id ?? "");
    setSourceText(documentText(document));
    setSourceDirty(false);
    setDirty(false);
    setCandidate(null);
    setCompiled(false);
    setError("");
    setStatus("");
    setConfirm(null);
  }
  function show(detail: OpenDetail = {}) {
    load(
      detail.document ?? session.getWordDraft() ?? emptyDocument(),
      session.wordSources,
      detail.blockId,
    );
    setOpen(true);
    if (detail.clipboard) void normalize(detail.clipboard);
  }
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const receive = (event: ClipboardEvent) => {
      if (
        !(event.target instanceof Node) ||
        !dialog.current?.contains(event.target)
      )
        return;
      // Own dialog clipboard events before vendor document handlers import them.
      event.stopImmediatePropagation();
      if (event.type !== "paste") return;
      const data = event.clipboardData;
      if (
        !data ||
        (event.target as Element).getAttribute?.("aria-label") !==
          "Source / paste workspace"
      )
        return;
      const html = data.getData("text/html"),
        rtf = data.getData("text/rtf");
      if (html || rtf || data.files.length) {
        event.preventDefault();
        void normalize({
          html,
          text: data.getData("text/plain"),
          rtf,
          images: Array.from(data.files),
        });
      }
    };
    for (const type of ["paste", "copy", "cut"])
      window.addEventListener(type, receive as EventListener, true);
    return () => {
      for (const type of ["paste", "copy", "cut"])
        window.removeEventListener(type, receive as EventListener, true);
    };
  }, [open, sources, model]);
  useEffect(() => {
    const receive = (event: Event) =>
      show((event as CustomEvent<OpenDetail>).detail ?? {});
    const host = engine.pages.editor.getContainer();
    host.addEventListener("lessonboard:word-terminal", receive);
    window.addEventListener("lessonboard:word-terminal", receive);
    return () => {
      host.removeEventListener("lessonboard:word-terminal", receive);
      window.removeEventListener("lessonboard:word-terminal", receive);
      job.current?.abort();
    };
  }, [engine]);
  function stop() {
    job.current?.abort();
    job.current = null;
    setBusy(false);
    setStatus("Operation cancelled. The compiled lesson is unchanged.");
  }
  function close() {
    if (busy) {
      stop();
      return;
    }
    if (dirty || sourceDirty) {
      setConfirm("close");
      return;
    }
    setOpen(false);
    engine.pages.editor.focus();
  }
  async function normalize(input: ClipboardInput = { text: sourceText }) {
    job.current?.abort();
    const task = new AbortController();
    job.current = task;
    const scope = session.scope();
    setBusy(true);
    setError("");
    setStatus("Reading pasted content…");
    try {
      const { normalizeClipboard } =
        await import("../../modules/documents/clipboard.ts");
      const result = await normalizeClipboard(input, task.signal);
      if (task.signal.aborted || scope !== session.scope()) return;
      setModel(result.document);
      setSources({ ...session.wordSources, ...sources, ...result.sources });
      setSelected(result.document.blocks[0]?.id ?? "");
      setSourceText(documentText(result.document));
      setSourceDirty(false);
      setDirty(true);
      setCandidate(null);
      setStatus(
        "Content ready. Review any notices, then save your draft.",
      );
    } catch (reason) {
      if (!task.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not read the pasted content.",
        );
    } finally {
      if (job.current === task) {
        job.current = null;
        setBusy(false);
      }
    }
  }
  async function choose(file: File) {
    job.current?.abort();
    const task = new AbortController();
    job.current = task;
    const scope = session.scope();
    setOpen(true);
    setBusy(true);
    setError("");
    setCandidate(null);
    setFileLabel(`${file.name} · ${file.size.toLocaleString()} bytes`);
    setStatus("Reading DOCX…");
    try {
      const { inspectDocx } = await import("../../modules/documents/import.ts");
      const result = await inspectDocx(file, task.signal, setStatus);
      if (task.signal.aborted || scope !== session.scope()) return;
      setCandidate(result);
      setStatus(
        "DOCX ready. Review it before adding it to your draft.",
      );
    } catch (reason) {
      if (!task.signal.aborted) {
        setStatus("");
        setError(
          reason instanceof Error ? reason.message : "DOCX import failed.",
        );
      }
    } finally {
      if (job.current === task) {
        job.current = null;
        setBusy(false);
      }
    }
  }
  function accept() {
    if (!candidate) return;
    load(candidate.document, {
      ...session.wordSources,
      ...sources,
      ...candidate.sources,
    });
    setDirty(true);
    setStatus(
      "Document added to the draft. Your teaching page has not changed.",
    );
  }
  async function save() {
    if (sourceDirty) {
      setError(
        "Select Normalize source to apply your pasted content before saving.",
      );
      return false;
    }
    setBusy(true);
    setError("");
    const scope = session.scope();
    try {
      await session.saveWordDraft(model, sources);
      if (scope !== session.scope()) return false;
      setDirty(false);
      setStatus("Draft saved on this device. Your teaching page has not changed.");
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Draft could not be saved.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function compile() {
    setConfirm(null);
    if (sourceDirty) {
      setError("Normalize source edits before compiling.");
      return;
    }
    if (!model.blocks.length) {
      setError(
        "Add at least one supported or diagnosed source block before compiling.",
      );
      return;
    }
    const task = new AbortController();
    job.current = task;
    const scope = session.scope();
    setBusy(true);
    setError("");
    setStatus("Saving your draft…");
    const editor = engine.pages.editor;
    let rollback:
      ReturnType<typeof editor.markHistoryStoppingPoint> | undefined;
    try {
      validateDocument(model, sources);
      await session.saveWordDraft(model, sources);
      if (task.signal.aborted || scope !== session.scope()) return;
      const prior = editor.getCurrentPage().meta.word as
        DocumentModel | undefined;
      const required =
        model.blocks.length +
        model.sections.reduce(
          (n, section) => n + section.header.length + section.footer.length,
          0,
        );
      const existing =
        prior?.id === model.id
          ? editor
              .getCurrentPageShapes()
              .filter((shape) => shape.type === "word-block").length
          : 0;
      if (required - existing > session.remainingShapes())
        throw new Error(
          "The compiled blocks exceed the shared 20,000-object capacity. Current teaching content is unchanged.",
        );
      engine.cancel();
      session.activate("main");
      rollback = editor.markHistoryStoppingPoint(
        "Before reviewed Word compilation",
      );
      setStatus(
        "Preparing your teaching page…",
      );
      const result = await compileDocument(
        editor,
        model,
        sources,
        {
          mode: prior?.id === model.id ? "recompile" : "append",
          allowDetach: true,
        },
        task.signal,
      );
      if (scope !== session.scope()) return;
      session.changed("main", [], engine.editorEpoch);
      await session.saving.flush();
      if (session.saving.status.phase !== "saved")
        throw new Error(
          "Compilation is present but could not be saved. Retry saving or download the lesson.",
        );
      getWordTeaching(editor).stop();
      setDirty(false);
      setCompiled(true);
      setStatus(
        `Compiled ${model.blocks.length} blocks. ${result.detachedAnnotations ? `${result.detachedAnnotations} notes on removed content were kept in place.` : "Notes remain editable."}`,
      );
    } catch (reason) {
      if (rollback && scope === session.scope()) {
        editor.bailToMark(rollback);
        session.saving.request();
        try {
          await session.saving.flush();
        } catch {
          /* Save failure stays visible and recoverable. */
        }
      }
      if (!task.signal.aborted)
        setError(
          (reason instanceof Error ? reason.message : "Compilation failed.") +
            " Your previous teaching page was kept.",
        );
    } finally {
      if (job.current === task) {
        job.current = null;
        setBusy(false);
      }
    }
  }
  function apply(nextBlock: DocumentBlock) {
    try {
      setModel(replaceBlock(model, nextBlock));
      setDirty(true);
      setCompiled(false);
      setError("");
      setStatus(
        "Block updated. Save your draft or update the teaching page to keep this change.",
      );
    } catch (reason) {
      setError(String(reason));
    }
  }
  function insert(equation = false) {
    try {
      const next = insertParagraph(
        model,
        model.blocks.some((b) => b.id === block?.id) ? block!.id : null,
        equation ? "" : "New explanation",
      );
      if (equation) {
        const p = next.document.blocks.find((b) => b.id === next.blockId)!;
        if (p.kind === "paragraph")
          p.inlines = [
            {
              id: "equation:" + crypto.randomUUID(),
              kind: "equation",
              source: "x^2",
              original: "x^2",
              encoding: "latex",
              status: "editable",
            },
          ];
      }
      setModel(next.document);
      setSelected(next.blockId);
      setDirty(true);
      setCompiled(false);
    } catch (reason) {
      setError(String(reason));
    }
  }
  const shown = candidate?.document ?? model,
    shownSources = candidate ? { ...sources, ...candidate.sources } : sources;
  return (
    <>
      <button onClick={() => show()}>Word Terminal</button>
      <button
        disabled={session.workspace.readOnly}
        onClick={() => {
          if (!open) show();
          picker.current?.click();
        }}
      >
        Import DOCX
      </button>
      <input
        ref={picker}
        hidden
        type="file"
        accept=".docx,.doc"
        aria-label="DOCX file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void choose(file);
        }}
      />
      <dialog
        ref={dialog}
        className="word-dialog"
        aria-label="Word Terminal"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file && !busy) void choose(file);
        }}
      >
        <div className="word-heading">
          <h2>Word Terminal</h2>
          <button onClick={close}>Close terminal</button>
        </div>
        <p>
          Import or paste your Word content, edit it, then add it to a teaching
          page.
        </p>
        <div className="word-actions">
          <button
            disabled={busy || session.workspace.readOnly}
            onClick={() => picker.current?.click()}
          >
            Choose DOCX
          </button>
          <button
            disabled={busy || session.workspace.readOnly}
            onClick={() => void save()}
          >
            Save draft
          </button>
          <button
            disabled={
              busy || session.workspace.readOnly || !model.blocks.length
            }
            onClick={() => setConfirm("compile")}
          >
            Compile teaching page
          </button>
          <button
            disabled={busy || session.workspace.readOnly}
            onClick={() => setConfirm("clear")}
          >
            Clear draft
          </button>
          {compiled ? (
            <button
              onClick={() => {
                setOpen(false);
                engine.pages.editor.focus();
              }}
            >
              Go to teaching page
            </button>
          ) : null}
          {busy ? <button onClick={stop}>Cancel operation</button> : null}
        </div>
        {fileLabel ? <p>{fileLabel}</p> : null}
        <p role="status" data-testid="word-status">
          {status ||
            (dirty || sourceDirty
              ? "You have unsaved changes. The teaching page has not changed."
              : "Edit the draft here, then update the teaching page when you are ready.")}
        </p>
        {error ? (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        ) : null}
        {confirm ? (
          <div
            className="word-confirm"
            role="group"
            aria-label="Review terminal action"
          >
            <p>
              {confirm === "compile"
                ? "Add this draft to a teaching page, or update its existing page? Notes on removed content stay in their previous positions. Page breaks may differ from Word. You can undo this change."
                : confirm === "replace"
                  ? "Replace this draft with the imported document? Your teaching page will not change."
                  : confirm === "clear"
                    ? "Clear this draft? Existing teaching pages and original files will remain."
                    : confirm === "delete"
                      ? "Delete this block? Its notes will stay in place when you update the teaching page."
                      : "Discard unsaved changes and close? Your last saved draft will remain."}
            </p>
            <button onClick={() => setConfirm(null)}>Cancel action</button>
            <button
              disabled={busy}
              onClick={() => {
                if (confirm === "compile") {
                  void compile();
                  return;
                }
                if (confirm === "replace") accept();
                if (confirm === "clear") {
                  load(emptyDocument());
                  setDirty(true);
                }
                if (confirm === "close") {
                  setDirty(false);
                  setSourceDirty(false);
                  setOpen(false);
                }
                if (confirm === "delete" && block) {
                  try {
                    const next = deleteBlock(model, block.id);
                    setModel(next);
                    setSelected(next.blocks[0]?.id ?? "");
                    setDirty(true);
                    setCompiled(false);
                  } catch (reason) {
                    setError(String(reason));
                  }
                }
                setConfirm(null);
              }}
            >
              {confirm === "compile"
                ? "Confirm compilation"
                : confirm === "replace"
                  ? "Confirm replacement"
                  : confirm === "clear"
                    ? "Confirm clear"
                    : confirm === "delete"
                      ? "Confirm block deletion"
                      : "Discard unsaved terminal edits"}
            </button>
          </div>
        ) : null}
        {candidate ? (
          <div className="word-import-review">
            <h3>Checked document</h3>
            <p>
              {candidate.document.blocks.length} blocks ·{" "}
              {candidate.document.diagnostics.length} notices. The original DOCX
              will be kept.
            </p>
            <button
              onClick={() =>
                model.blocks.length ? setConfirm("replace") : accept()
              }
            >
              Use checked document
            </button>
            <button onClick={() => setCandidate(null)}>
              Keep current draft
            </button>
          </div>
        ) : null}
        <div className="word-workspace">
          <section className="word-editor" aria-label="Source draft editor">
            <label>
              Source / paste workspace
              <textarea
                aria-label="Source / paste workspace"
                value={sourceText}
                maxLength={500000}
                rows={5}
                disabled={busy}
                onChange={(event) => {
                  setSourceText(event.target.value);
                  setSourceDirty(true);
                }}
              />
            </label>
            <p>
              Paste from Word, or paste plain text with a blank line between
              paragraphs. If equations or images are missing, import the DOCX
              file instead. RTF is not supported.
            </p>
            <button
              disabled={busy || session.workspace.readOnly}
              onClick={() => void normalize()}
            >
              Normalize source
            </button>
            <label>
              Draft title
              <input
                value={model.title}
                maxLength={120}
                onChange={(event) => {
                  setModel({
                    ...model,
                    title: event.target.value,
                    revision: model.revision + 1,
                  });
                  setDirty(true);
                }}
              />
            </label>
            <label>
              Document block
              <select
                aria-label="Document block"
                value={block?.id ?? ""}
                onChange={(event) => setSelected(event.target.value)}
                disabled={busy}
              >
                {blocks.map((block, index) => (
                  <option key={block.id} value={block.id}>
                    {index + 1}. {block.kind} · {block.id.slice(-16)}
                  </option>
                ))}
              </select>
            </label>
            <div className="word-actions">
              <button disabled={busy} onClick={() => insert()}>
                Insert paragraph after
              </button>
              <button disabled={busy} onClick={() => insert(true)}>
                Insert equation after
              </button>
              <button
                disabled={busy || !block}
                onClick={() => setConfirm("delete")}
              >
                Delete block
              </button>
            </div>
            {block ? (
              <BlockEditor
                active={open && !busy && !candidate}
                key={block.id + ":" + model.revision}
                block={block}
                document={model}
                sources={sources}
                onApply={apply}
              />
            ) : (
              <p>No source blocks yet.</p>
            )}
          </section>
          <section className="word-preview-panel" aria-label="Document preview">
            <WordPreview document={shown} sources={shownSources} />
            <details
              className="word-diagnostics"
              open={shown.diagnostics.length > 0}
            >
              <summary>Diagnostics ({shown.diagnostics.length})</summary>
              <ul>
                {shown.diagnostics.map((diagnostic) => (
                  <li key={diagnostic.id}>
                    <strong>
                      {diagnostic.severity}: {diagnostic.code}
                    </strong>{" "}
                    · {diagnostic.message} {diagnostic.recovery}
                    {diagnostic.blockId && !candidate ? (
                      <button
                        onClick={() => {
                          setSelected(diagnostic.blockId!);
                          setStatus(
                            `Reviewing affected source block: ${diagnostic.code}`,
                          );
                        }}
                      >
                        Review affected block
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        </div>
      </dialog>
    </>
  );
}
