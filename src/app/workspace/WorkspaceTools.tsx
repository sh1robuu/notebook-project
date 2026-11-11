import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { BoardEngine } from "../../modules/board/engine.ts";
import type { LessonListEntry } from "../../modules/workspace/local-workspace.ts";
import { makeLesson, blankDrawing } from "../../modules/workspace/model.ts";
import { defaultNotebookPaper } from "../../modules/workspace/lesson-view.ts";
import { devicePreferences } from "../../modules/workspace/preferences.ts";
import { prepareWorkspaceForNavigation } from "../../modules/workspace/activity.ts";
import { WorkspaceSettings } from "./WorkspaceSettings.tsx";
import { WorkspaceHelp } from "./WorkspaceHelp.tsx";
import { WorkspaceOffline, formatStorage } from "./WorkspaceOffline.tsx";
import { classroomEnabled } from "../../config/classroom.ts";
import { Icon } from "../Icon.tsx";
import "../context-tools.css";
import "./workspace-tools.css";

type Panel = "lessons" | "settings" | "offline" | "help" | "recovery";
type Backup = {
  lessonId: string;
  revision: number;
  generatedAt: number;
  initiatedAt: number;
  recoverable: boolean;
};
const tabs: readonly [Panel, string][] = [
  ["lessons", "Bài giảng"],
  ["settings", "Cài đặt"],
  ["offline", "Ngoại tuyến"],
  ["help", "Trợ giúp"],
  ["recovery", "Khôi phục"],
];
const backupKey = "lessonboard.last-backup.v1";
const dateFormat = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
});
const timeLabel = (value?: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= 8.64e15
    ? dateFormat.format(value)
    : "Chưa có";
function readBackup(): Backup | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(backupKey) ?? "null");
    if (
      value &&
      typeof value.lessonId === "string" &&
      Number.isSafeInteger(value.revision) &&
      Number.isFinite(value.generatedAt) &&
      Number.isFinite(value.initiatedAt) &&
      typeof value.recoverable === "boolean"
    )
      return value;
  } catch {
    /* Denied storage leaves no persistent download history. */
  }
}

export function lessonAddress(id?: string) {
  const target = new URL("/app", location.origin);
  if (id) target.searchParams.set("lesson", id);
  return target.pathname + target.search;
}

export function WorkspaceTools({ engine }: { engine: BoardEngine }) {
  const session = engine.session;
  const workspace = session.workspace;
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useId();
  const [panel, setPanel] = useState<Panel>("lessons");
  const [open, setOpen] = useState(false);
  const [lessons, setLessons] = useState<LessonListEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmOwner, setConfirmOwner] = useState(false);
  const [backup, setBackup] = useState(readBackup);
  const [storage, setStorage] = useState<{
    usage?: number;
    quota?: number;
    persistent?: boolean;
  }>({});
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const save = useSyncExternalStore(
    engine.saving.subscribe,
    engine.saving.getSnapshot,
  );
  useEffect(() => {
    const remember = (event: Event) => {
      const next = (event as CustomEvent<Backup>).detail;
      if (!next) return;
      setBackup(next);
      try {
        localStorage.setItem(backupKey, JSON.stringify(next));
      } catch {
        /* Current-session status still works. */
      }
    };
    window.addEventListener("lessonboard:backup-generated", remember);
    return () =>
      window.removeEventListener("lessonboard:backup-generated", remember);
  }, []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  useEffect(() => {
    if (!open || (panel !== "lessons" && panel !== "recovery")) return;
    let stale = false;
    setLessons(null);
    void workspace.listLessons().then(
      (rows) => {
        if (!stale) setLessons(rows);
      },
      (failure) => {
        if (!stale) {
          setLessons([]);
          setError(
            failure instanceof Error
              ? failure.message
              : "Chưa đọc được danh sách bài.",
          );
        }
      },
    );
    if (panel === "recovery")
      void readStorage().then(
        (value) => {
          if (!stale) setStorage(value);
        },
        () => {},
      );
    return () => {
      stale = true;
    };
  }, [open, panel, workspace, session.state.editorEpoch]);
  function show(next: Panel) {
    setError("");
    setPanel(next);
    setOpen(true);
  }
  useEffect(() => {
    const recovery = () => show("recovery");
    window.addEventListener("lessonboard:open-recovery", recovery);
    return () =>
      window.removeEventListener("lessonboard:open-recovery", recovery);
  }, []);
  function close() {
    if (busy) return;
    dialog.current?.close();
    setOpen(false);
    setConfirmOwner(false);
    trigger.current?.focus();
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Thao tác chưa hoàn tất.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function createLesson() {
    const release = await prepareWorkspaceForNavigation(session, {
      ignoreDialog: dialog.current ?? undefined,
    });
    try {
      const preferences = devicePreferences.getSnapshot().value;
      const draft = makeLesson(blankDrawing());
      const page =
        draft.document.store[draft.pageId as keyof typeof draft.document.store];
      if (page?.typeName === "page")
        page.meta = {
          ...page.meta,
          paper: defaultNotebookPaper(preferences.paperColor),
        };
      draft.view.layout.dock = preferences.scratchDock;
      await session.restore(draft);
      history.replaceState(null, "", lessonAddress(workspace.lesson.id));
      dialog.current?.close();
      setOpen(false);
    } finally {
      release();
    }
  }
  async function switchLesson(id: string) {
    const release = await prepareWorkspaceForNavigation(session, {
      ignoreDialog: dialog.current ?? undefined,
    });
    window.addEventListener("pageshow", release, { once: true });
    try {
      window.location.assign(lessonAddress(id));
    } catch (failure) {
      window.removeEventListener("pageshow", release);
      release();
      throw failure;
    }
  }
  async function takeOwnership() {
    const release = await prepareWorkspaceForNavigation(session, {
      ignoreDialog: dialog.current ?? undefined,
    });
    try {
      session.applyWorkspaceLesson(await workspace.takeOwnership());
      setConfirmOwner(false);
      dialog.current?.close();
      setOpen(false);
    } finally {
      release();
    }
  }
  async function persist() {
    if (!navigator.storage?.persist)
      throw new Error("Trình duyệt chưa hỗ trợ yêu cầu lưu bền.");
    await navigator.storage.persist();
    setStorage(await readStorage());
  }
  function download() {
    close();
    engine.commands.execute("download");
  }
  const currentBackup =
    backup?.lessonId === workspace.lesson.id ? backup : undefined;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="workspace-trigger"
        aria-label="Bài giảng & cài đặt"
        title="Bài giảng & cài đặt"
        onClick={() => show("lessons")}
      >
        <Icon name="notebook" />
        <span className="workspace-trigger-full">Bài giảng &amp; cài đặt</span>
        <span className="workspace-trigger-compact">Bài giảng</span>
      </button>
      <dialog
        ref={dialog}
        className="context-panel context-panel-edge workspace-tools"
        lang="vi"
        aria-labelledby={title}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          if (
            event.key !== "Escape" ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return;
          event.preventDefault();
          close();
        }}
      >
        {open ? (
          <>
            <header className="context-panel-heading workspace-dialog-header">
              <h2 id={title}>Không gian cá nhân</h2>
              <button
                type="button"
                className="context-panel-close"
                aria-label="Đóng"
                title="Đóng (Esc)"
                onClick={close}
                disabled={busy}
              >
                <Icon name="close" />
              </button>
            </header>
            <nav className="workspace-tabs" aria-label="Mục không gian cá nhân">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={panel === key}
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setPanel(key);
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
            {classroomEnabled && panel === "lessons" && (
              <p>
                <a href="/classroom" target="_blank" rel="noopener noreferrer">
                  Mở GroupHub trong tab mới
                </a>
              </p>
            )}
            {panel === "settings" ? (
              <WorkspaceSettings
                apply={(preferences) => {
                  for (const current of session.engines.values())
                    current.applyDevicePreferences(preferences);
                }}
              />
            ) : panel === "help" ? (
              <WorkspaceHelp commands={engine.commands} />
            ) : panel === "offline" ? (
              <WorkspaceOffline session={session} dialog={dialog.current} />
            ) : (
              <>
                {panel === "recovery" ? (
                  <section aria-label="Lưu trữ và phục hồi">
                    <h3>Lưu trữ và phục hồi</h3>
                    <dl className="workspace-facts">
                      <dt>Ước tính đã dùng</dt>
                      <dd>{formatStorage(storage.usage)}</dd>
                      <dt>Hạn mức ước tính</dt>
                      <dd>{formatStorage(storage.quota)}</dd>
                      <dt>Lưu trữ bền</dt>
                      <dd>
                        {storage.persistent === undefined
                          ? "Chưa có số liệu"
                          : storage.persistent
                            ? "Trình duyệt đã cấp"
                            : "Trình duyệt chưa cấp"}
                      </dd>
                      <dt>Lần lưu gần nhất</dt>
                      <dd>{timeLabel(save.savedAt)}</dd>
                      <dt>Lần yêu cầu tải bản sao</dt>
                      <dd>{timeLabel(currentBackup?.initiatedAt)}</dd>
                    </dl>
                    <p>
                      Trình duyệt có thể xóa dữ liệu của trang. Giữ tệp
                      .teachboard riêng để chuyển thiết bị hoặc phục hồi bài.
                    </p>
                    <div className="workspace-row">
                      <button
                        type="button"
                        disabled={busy || !navigator.storage?.persist}
                        onClick={() => void run(persist)}
                      >
                        Yêu cầu lưu bền
                      </button>
                      {save.phase === "error" && !state.readOnly ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => engine.saving.flush())}
                        >
                          Thử lưu lại
                        </button>
                      ) : null}
                      <button type="button" disabled={busy} onClick={download}>
                        {save.phase === "saved" && !state.readOnly
                          ? "Tải bản sao bài giảng"
                          : "Tải bản phục hồi"}
                      </button>
                    </div>
                    {state.readOnly ? (
                      <div className="workspace-confirm">
                        <p>
                          {workspace.databaseClosed
                            ? "Kết nối lưu trữ đã đóng. Hãy giữ một bản sao trước khi mở lại."
                            : "Bài đang chỉ đọc. Hãy giữ bản sao nếu tab này có nội dung chưa lưu."}
                        </p>
                        {!workspace.databaseClosed ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmOwner(!confirmOwner)}
                          >
                            Giành quyền chỉnh sửa
                          </button>
                        ) : null}
                        {confirmOwner ? (
                          <button
                            className="primary"
                            type="button"
                            disabled={busy}
                            onClick={() => void run(takeOwnership)}
                          >
                            Xác nhận mở bản đã lưu và giành quyền
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                ) : null}
                <section aria-label="Bài giảng trên thiết bị">
                  <div className="workspace-list-title">
                    <h3>Bài giảng trên thiết bị</h3>
                    {panel === "lessons" ? (
                      <button
                        className="primary"
                        type="button"
                        disabled={busy || state.readOnly}
                        onClick={() => void run(createLesson)}
                      >
                        Tạo bài mới
                      </button>
                    ) : null}
                  </div>
                  {lessons === null ? (
                    <p role="status">Đang đọc bài giảng…</p>
                  ) : (
                    <ul className="workspace-lesson-list">
                      {lessons.map((lesson) => (
                        <li key={lesson.id}>
                          <div>
                            <strong>
                              {lesson.title || "Bài giảng chưa đặt tên"}
                            </strong>
                            <small>
                              {timeLabel(lesson.updatedAt)} · Bản lưu{" "}
                              {lesson.revision}
                              {lesson.error ? " · Cần kiểm tra" : ""}
                            </small>
                          </div>
                          {lesson.active ? (
                            <span className="workspace-current">Đang mở</span>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={"Mở " + lesson.title}
                              onClick={() =>
                                void run(() => switchLesson(lesson.id))
                              }
                            >
                              Mở
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
            {error ? (
              <p role="alert" className="dialog-error">
                {error}
              </p>
            ) : null}
          </>
        ) : null}
      </dialog>
    </>
  );
}

async function readStorage() {
  const [estimate, persistent] = await Promise.all([
    navigator.storage?.estimate?.().catch(() => undefined),
    navigator.storage?.persisted?.().catch(() => undefined),
  ]);
  return { usage: estimate?.usage, quota: estimate?.quota, persistent };
}
