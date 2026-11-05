import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BoardEngine } from "../modules/board/engine.ts";
import type { Lesson } from "../modules/workspace/model.ts";
import { readArchive, downloadArchive } from "../modules/workspace/archive.ts";
import { Icon } from "./Icon.tsx";
import { validateArchivedPdfs } from "../modules/pdf/archive-validation.ts";
import { abortError } from "../modules/pdf/runtime.ts";
export function LessonFiles({ engine }: { engine: BoardEngine }) {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const input = useRef<HTMLInputElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    openButton = useRef<HTMLButtonElement>(null);
  const checking = useRef<AbortController | null>(null),
    passwordDialog = useRef<HTMLDialogElement>(null),
    passwordAnswer = useRef<((p: string) => void) | null>(null);
  const [passwordQuestion, setPasswordQuestion] = useState(""),
    [password, setPassword] = useState("");
  const [candidate, setCandidate] = useState<{
      kind: "archive" | "previous";
      lesson: Lesson;
      passwords?: Record<string, string>;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (candidate) dialog.current?.showModal();
  }, [candidate]);
  useEffect(() => {
    if (passwordQuestion) passwordDialog.current?.showModal();
    else passwordDialog.current?.close();
  }, [passwordQuestion]);
  useEffect(() => () => checking.current?.abort(), []);
  useEffect(() => {
    return engine.commands.register(
      "download",
      "Download lesson",
      () => void download(),
      ["mod+s"],
      () => !busy,
    );
  });
  async function download() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("Preparing lesson file…");
    try {
      const bytes = await downloadArchive(engine.getLesson());
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes).buffer], { type: "application/zip" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download =
        (state.title.trim() || "Untitled lesson")
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
          .slice(0, 100) + ".teachboard";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setMessage("Download prepared. Keep the file as a separate copy.");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The lesson file could not be prepared.",
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  }
  async function choose(file: File) {
    const job = new AbortController();
    checking.current?.abort();
    checking.current = job;
    const scope = engine.session.scope();
    setBusy(true);
    setCandidate(null);
    setError("");
    setMessage("Checking lesson file…");
    try {
      const lesson = await readArchive(file, job.signal);
      const passwords = await validateArchivedPdfs(
        lesson,
        job.signal,
        setMessage,
        (name, wrong) =>
          new Promise((resolve, reject) => {
            setPassword("");
            setPasswordQuestion(
              (wrong
                ? "Incorrect password. Try again: "
                : "Unlock original PDF: ") + name,
            );
            const cancelled = () => reject(abortError());
            passwordAnswer.current = (value) => {
              job.signal.removeEventListener("abort", cancelled);
              resolve(value);
            };
            job.signal.addEventListener("abort", cancelled, {
              once: true,
            });
          }),
        (id) => engine.session.pdf.password(id),
      );
      if (job.signal.aborted || scope !== engine.session.scope())
        throw abortError();
      setCandidate({ kind: "archive", lesson, passwords });
      setMessage("");
    } catch (e) {
      if (!job.signal.aborted)
        setError(
          e instanceof Error ? e.message : "The lesson file could not be read.",
        );
      setMessage("");
    } finally {
      setBusy(false);
      setPassword("");
      setPasswordQuestion("");
      passwordAnswer.current = null;
      if (checking.current === job) checking.current = null;
    }
  }
  async function previous() {
    setBusy(true);
    setError("");
    try {
      setCandidate({ kind: "previous", lesson: await engine.previousLesson() });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Previous lesson could not be read.",
      );
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    dialog.current?.close();
    setCandidate(null);
    openButton.current?.focus();
  }
  async function restore() {
    if (!candidate) return;
    setBusy(true);
    setError("");
    try {
      if (candidate.kind === "previous") await engine.restorePrevious();
      else {
        await engine.restore(candidate.lesson);
        for (const [id, p] of Object.entries(candidate.passwords ?? {}))
          engine.session.pdf.setPassword(id, p);
      }
      cancel();
      setMessage(
        "Lesson opened. Use Previous lesson to return to the work you just left.",
      );
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "The lesson could not be opened."} Your saved lessons have been kept.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="file-actions">
        {busy && checking.current ? (
          <button onClick={() => checking.current?.abort()}>
            Cancel checking lesson
          </button>
        ) : null}
        {state.hasPrevious ? (
          <button
            aria-label="Previous lesson"
            title="Open the previous saved lesson"
            disabled={busy || state.readOnly}
            onClick={() => void previous()}
          >
            <Icon name="undo" />
            <span>Previous lesson</span>
          </button>
        ) : null}
        <button
          ref={openButton}
          aria-label="Open lesson"
          disabled={busy || state.readOnly}
          onClick={() => input.current?.click()}
        >
          <Icon name="open" />
          <span>Open lesson</span>
        </button>
        <button
          className="primary"
          aria-label="Download lesson"
          disabled={busy}
          onClick={() => void download()}
        >
          <Icon name="download" />
          <span>Download lesson</span>
        </button>
      </div>
      <dialog
        ref={passwordDialog}
        aria-labelledby="archive-password-title"
        onCancel={() => checking.current?.abort()}
      >
        <h2 id="archive-password-title">Unlock archived PDF</h2>
        <p>{passwordQuestion}</p>
        <p>Password stays in memory for this session.</p>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            const answer = passwordAnswer.current;
            passwordAnswer.current = null;
            setPasswordQuestion("");
            answer?.(password);
            setPassword("");
          }}
        >
          <label>
            Archived PDF password
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button type="button" onClick={() => checking.current?.abort()}>
              Cancel archive check
            </button>
            <button type="submit">Continue archive check</button>
          </div>
        </form>
      </dialog>
      <input
        ref={input}
        type="file"
        hidden
        aria-label="Lesson file"
        accept=".teachboard,application/zip"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void choose(file);
        }}
      />
      {message ? (
        <div className="file-message" role="status">
          {message}
        </div>
      ) : null}
      {error && !candidate ? (
        <div className="file-message file-error" role="alert">
          {error}
        </div>
      ) : null}
      {candidate ? (
        <dialog
          ref={dialog}
          aria-labelledby="open-title"
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) cancel();
          }}
        >
          <h2 id="open-title">Open this lesson?</h2>
          <p className="dialog-title">
            {candidate.lesson.title || "Untitled lesson"}
          </p>
          <p>
            {Object.values(candidate.lesson.document.store)
              .filter((r) => r.typeName === "shape")
              .length.toLocaleString()}{" "}
            objects ·{" "}
            {
              Object.values(candidate.lesson.document.store).filter(
                (r) => r.typeName === "page",
              ).length
            }{" "}
            main pages
          </p>
          <p>
            Your current work will be saved first. Use Previous lesson to return
            to it.
          </p>
          {error ? (
            <p role="alert" className="dialog-error">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => void restore()}
              disabled={busy}
            >
              {busy ? "Opening…" : "Open checked lesson"}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
