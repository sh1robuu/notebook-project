import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BoardEngine } from "../modules/board/engine.ts";
import type { Lesson } from "../modules/workspace/model.ts";
import {
  readArchiveCandidate,
  downloadArchive,
} from "../modules/workspace/archive.ts";
import type { ArchiveInfo } from "../modules/workspace/archive-core.ts";
import { beginOperation } from "../modules/workspace/activity.ts";
import { Icon } from "./Icon.tsx";
import { validateArchivedPdfs } from "../modules/pdf/archive-validation.ts";
import { abortError } from "../modules/pdf/runtime.ts";
export function LessonFiles({ engine }: { engine: BoardEngine }) {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const input = useRef<HTMLInputElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    openButton = useRef<HTMLButtonElement>(null);
  const checking = useRef<AbortController | null>(null),
    backupJob = useRef<AbortController | null>(null),
    fileOperation = useRef(false),
    passwordDialog = useRef<HTMLDialogElement>(null),
    passwordAnswer = useRef<((p: string) => void) | null>(null);
  const [passwordQuestion, setPasswordQuestion] = useState(""),
    [password, setPassword] = useState("");
  const [candidate, setCandidate] = useState<{
      kind: "archive" | "previous";
      lesson: Lesson;
      scope: string;
      passwords?: Record<string, string>;
      info?: ArchiveInfo;
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
  useEffect(
    () => () => {
      checking.current?.abort();
      backupJob.current?.abort();
    },
    [],
  );
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
    if (fileOperation.current) return;
    fileOperation.current = true;
    setBusy(true);
    setError("");
    setMessage("Preparing lesson file…");
    const job = new AbortController();
    backupJob.current = job;
    let finish = () => {};
    try {
      finish = beginOperation("Chuẩn bị bản sao bài giảng");
      if (
        [...engine.session.engines.values()].some(
          (current) =>
            current.isPointing() || current.editing.state.isTextEditing,
        )
      )
        throw new Error(
          "Hãy hoàn tất nét viết hoặc phần nhập văn bản trước khi tạo bản sao.",
        );
      const scope = engine.session.scope();
      let recoverable = engine.session.workspace.readOnly;
      if (!recoverable) {
        try {
          await engine.saving.flush();
        } catch {
          recoverable = true;
        }
      }
      if (job.signal.aborted || scope !== engine.session.scope())
        throw abortError();
      recoverable ||= engine.saving.status.phase !== "saved";
      const snapshot = engine.getLesson();
      const bytes = await downloadArchive(snapshot, job.signal);
      if (job.signal.aborted || scope !== engine.session.scope())
        throw abortError();
      const generatedAt = Date.now();
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/zip" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download =
        (snapshot.title.trim() || "Untitled lesson")
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
          .slice(0, 100) + ".teachboard";
      try {
        a.click();
        const initiatedAt = Date.now();
        window.dispatchEvent(
          new CustomEvent("lessonboard:backup-generated", {
            detail: {
              lessonId: snapshot.id,
              revision: snapshot.revision,
              generatedAt,
              initiatedAt,
              recoverable,
            },
          }),
        );
        setMessage(
          recoverable
            ? "Đã tạo bản phục hồi từ nội dung trong thẻ này và gửi yêu cầu tải xuống. Hãy mở tệp để kiểm tra và giữ một bản riêng."
            : "Đã tạo bản sao và gửi yêu cầu tải xuống. Hãy mở tệp để kiểm tra và giữ một bản riêng.",
        );
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (e) {
      if (job.signal.aborted) setMessage("Đã hủy chuẩn bị bản sao.");
      else {
        setError(
          e instanceof Error
            ? e.message
            : "The lesson file could not be prepared.",
        );
        setMessage("");
      }
    } finally {
      finish();
      backupJob.current = null;
      fileOperation.current = false;
      setBusy(false);
    }
  }
  async function choose(file: File) {
    if (fileOperation.current || candidate || state.readOnly) return;
    fileOperation.current = true;
    const job = new AbortController();
    checking.current = job;
    const scope = engine.session.scope();
    setBusy(true);
    setCandidate(null);
    setError("");
    setMessage("Checking lesson file…");
    let finish = () => {};
    try {
      finish = beginOperation("Kiểm tra bản sao bài giảng");
      const { lesson, info } = await readArchiveCandidate(file, job.signal);
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
      setCandidate({ kind: "archive", lesson, scope, passwords, info });
      setMessage("");
    } catch (e) {
      if (!job.signal.aborted)
        setError(
          e instanceof Error ? e.message : "The lesson file could not be read.",
        );
      setMessage("");
    } finally {
      finish();
      setBusy(false);
      setPassword("");
      setPasswordQuestion("");
      passwordAnswer.current = null;
      checking.current = null;
      fileOperation.current = false;
    }
  }
  async function previous() {
    if (fileOperation.current || candidate || state.readOnly) return;
    fileOperation.current = true;
    setBusy(true);
    setError("");
    let finish = () => {};
    const scope = engine.session.scope();
    try {
      finish = beginOperation("Kiểm tra bài giảng trước");
      const lesson = await engine.previousLesson();
      if (scope !== engine.session.scope()) throw abortError();
      setCandidate({ kind: "previous", lesson, scope });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Previous lesson could not be read.",
      );
    } finally {
      finish();
      fileOperation.current = false;
      setBusy(false);
    }
  }
  function cancel() {
    dialog.current?.close();
    setCandidate(null);
    openButton.current?.focus();
  }
  async function restore() {
    if (!candidate || fileOperation.current) return;
    fileOperation.current = true;
    setBusy(true);
    setError("");
    let finish = () => {};
    try {
      finish = beginOperation("Mở bản sao bài giảng");
      if (candidate.scope !== engine.session.scope())
        throw new Error(
          "Bài giảng đang mở đã thay đổi. Hãy kiểm tra lại tệp trước khi mở.",
        );
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
      finish();
      fileOperation.current = false;
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
        {busy && backupJob.current ? (
          <button onClick={() => backupJob.current?.abort()}>
            Hủy chuẩn bị bản sao
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
            {(
              candidate.info?.mainObjects ??
              Object.values(candidate.lesson.document.store).filter(
                (r) => r.typeName === "shape",
              ).length
            ).toLocaleString()}{" "}
            objects ·{" "}
            {candidate.info?.mainPages ??
              Object.values(candidate.lesson.document.store).filter(
                (r) => r.typeName === "page",
              ).length}{" "}
            main pages
          </p>
          <p>
            Your current work will be saved first. Use Previous lesson to return
            to it.
          </p>
          {candidate.kind === "archive" ? (
            <>
              <p>
                Tệp này sẽ được mở thành một bài giảng mới trên thiết bị. Bài
                giảng đang dùng được giữ lại.
              </p>
              {candidate.info ? (
                <dl className="archive-details">
                  <dt>Định dạng bản sao</dt>
                  <dd>teachboard {candidate.info.formatVersion}</dd>
                  <dt>Phiên bản tạo tệp</dt>
                  <dd>
                    {candidate.info.applicationVersion ??
                      "Tệp cũ chưa ghi thông tin"}
                  </dd>
                  {candidate.info.createdAt ? (
                    <>
                      <dt>Ngày tạo bản sao</dt>
                      <dd>
                        <time dateTime={candidate.info.createdAt}>
                          {new Date(candidate.info.createdAt).toLocaleString(
                            "vi-VN",
                          )}
                        </time>
                      </dd>
                    </>
                  ) : null}
                  <dt>Nội dung khung nháp</dt>
                  <dd>
                    {candidate.info.scratchpadObjects.toLocaleString()} đối
                    tượng
                  </dd>
                  <dt>Tệp nguồn</dt>
                  <dd>
                    {candidate.info.sourceCount.toLocaleString()} tệp ·{" "}
                    {candidate.info.sourceBytes.toLocaleString()} byte
                  </dd>
                </dl>
              ) : null}
              {candidate.info?.warnings.length ? (
                <ul>
                  {candidate.info.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              <p>
                Các tùy chọn riêng của thiết bị không được thay đổi khi mở bản
                sao.
              </p>
            </>
          ) : null}
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
