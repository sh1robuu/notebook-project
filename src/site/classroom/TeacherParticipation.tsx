import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ClassroomError } from "../../modules/classroom/api.ts";
import type { Room } from "../../modules/classroom/api.ts";
import {
  participationApi,
  privateMediaUrl,
} from "../../modules/classroom/participation-api.ts";
import { sendParticipationCommand } from "../../modules/classroom/participation-outbox.ts";
import type {
  ClassroomInsertion,
  CaptureGrant,
  ParticipationTarget,
  TeacherParticipation,
  TeacherParticipationCommand,
  TeacherTask,
} from "../../modules/classroom/participation-types.ts";
import { sameInsertionTarget } from "../../modules/classroom/participation-types.ts";
import type { SnapshotAction } from "./ProductGallery.tsx";
import { participationError, useParticipation } from "./ParticipationState.ts";
import { TaskControls, TaskEditor, TaskSummary } from "./ParticipationTask.tsx";
import "./participation.css";

const Gallery = lazy(() => import("./ProductGallery.tsx"));
const sections = [
  ["tasks", "Bài tập"],
  ["gallery", "Bài làm"],
  ["help", "Trợ giúp"],
  ["capture", "Chụp ảnh"],
] as const;
export type ParticipationSection = (typeof sections)[number][0];
export type BoardDestination = {
  target: ParticipationTarget;
  label: string;
  save: (value: ClassroomInsertion, file: File) => Promise<number>;
};
type Commit = (
  value: TeacherParticipationCommand,
) => ReturnType<typeof participationApi.teach>;

export default function TeacherParticipation({
  room,
  csrfToken,
  onDenied,
  initial = "tasks",
  board,
}: {
  room: Room;
  csrfToken: string;
  onDenied: () => void;
  initial?: ParticipationSection;
  board?: BoardDestination;
}) {
  const [section, setSection] = useState(initial);
  const [editor, setEditor] = useState<{
    id: string;
    original?: TeacherTask;
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState<boolean>();
  const lock = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const read = useCallback(
    (signal: AbortSignal) => participationApi.teacher(room.id, signal),
    [room.id],
  );
  const live = useParticipation(read, room.revision, onDenied);
  const view = live.data?.participation;
  const roomActive = room.state === "open" || room.state === "locked";

  useEffect(() => {
    const controller = new AbortController();
    void participationApi.capabilities(controller.signal).then(
      (result) => setImages(result.images),
      () => {
        if (!controller.signal.aborted) setImages(false);
      },
    );
    return () => {
      controller.abort();
      operation.current?.abort();
    };
  }, []);

  async function run<T>(work: (commit: Commit) => Promise<T>) {
    if (lock.current) throw new Error("Đợi thao tác đang chạy hoàn tất.");
    const controller = new AbortController();
    operation.current = controller;
    lock.current = true;
    setBusy(true);
    setError("");
    const commit: Commit = async (command) => {
      controller.signal.throwIfAborted();
      const result = await sendParticipationCommand(
        "teacher:" + room.id,
        command,
        (key) =>
          participationApi.teach(
            room.id,
            command,
            csrfToken,
            key,
            controller.signal,
          ),
      );
      if (!controller.signal.aborted) live.apply(result);
      return result;
    };
    try {
      return await work(commit);
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (failure instanceof ClassroomError && failure.unauthorized)
          onDenied();
        else {
          setError(participationError(failure));
          if (failure instanceof ClassroomError && failure.status === 409)
            live.refresh();
        }
      }
      throw failure;
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function send(value: TeacherParticipationCommand) {
    return run((commit) => commit(value)).then(
      () => true,
      () => false,
    );
  }

  const insert: SnapshotAction | undefined =
    board &&
    (async ({ mediaId, captureId, productId, file }) => {
      await run(async (commit) => {
        const target = board.target;
        const prepared = await commit({
          type: "prepareInsertion",
          mediaId,
          captureId,
          productId,
          target,
        });
        const insertion = prepared.participation.insertions.find(
          (item) => item.id === prepared.receipt.resourceId,
        );
        if (!insertion || !sameInsertionTarget(insertion.target, target))
          throw new Error("Yêu cầu chèn không khớp với trang đang mở.");
        const localRevision = await board.save(insertion, file);
        if (insertion.state === "saved") return;
        try {
          await commit({
            type: "completeInsertion",
            insertionId: insertion.id,
            target: insertion.target,
            localRevision,
          });
        } catch {
          throw new Error(
            "Ảnh đã lưu trên bảng. Hãy thử lại để xác nhận với lớp.",
          );
        }
      });
    });

  if (live.unsupported) return null;
  return (
    <section
      className="classroom-panel participation-teacher"
      aria-label="Hoạt động lớp học"
    >
      <nav className="participation-sections" aria-label="Hoạt động lớp học">
        {sections.map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-current={section === id ? "true" : undefined}
            disabled={busy}
            onClick={() => setSection(id)}
          >
            {label}
            {id === "help" &&
              !!view?.help.some((item) => item.state === "pending") &&
              " (" +
                view.help.filter((item) => item.state === "pending").length +
                ")"}
          </button>
        ))}
      </nav>
      {!view && !live.error && <p role="status">Đang tải hoạt động lớp học…</p>}
      {live.error && (
        <div className="classroom-notice">
          <p role="alert">{live.error}</p>
          <button type="button" onClick={live.refresh}>
            Tải lại hoạt động
          </button>
        </div>
      )}
      {error && (
        <p className="classroom-notice" role="alert">
          {error}
        </p>
      )}
      {view && section === "tasks" && (
        <>
          <div className="participation-heading">
            <h3>Bài tập đã giao</h3>
            <button
              type="button"
              className="classroom-primary"
              disabled={busy || !roomActive}
              onClick={() => setEditor({ id: crypto.randomUUID() })}
            >
              Bài tập mới
            </button>
          </div>
          {!roomActive && (
            <p className="classroom-muted">
              Mở phòng để giao bài và chỉnh giờ.
            </p>
          )}
          {editor && (
            <TaskEditor
              key={editor.id}
              task={editor.original}
              groups={room.groups}
              busy={busy}
              cancel={() => setEditor(undefined)}
              submit={(value) => {
                const command: TeacherParticipationCommand = editor.original
                  ? {
                      ...value,
                      type: "reviseTask",
                      taskId: editor.id,
                      expectedRevision: editor.original.revision,
                    }
                  : { ...value, type: "publishTask", taskId: editor.id };
                void run((commit) => commit(command)).then(
                  () => setEditor(undefined),
                  () => {},
                );
              }}
            />
          )}
          {!view.tasks.length && (
            <p className="classroom-muted">Chưa giao bài tập nào.</p>
          )}
          <ul className="participation-list">
            {view.tasks.map((task) => (
              <li key={task.id}>
                <TaskSummary task={task} clock={live.clock} />
                <p className="classroom-muted">
                  {task.groupIds.length
                    ? room.groups
                        .filter((group) => task.groupIds.includes(group.id))
                        .map((group) => group.name)
                        .join(", ")
                    : "Cả lớp"}
                </p>
                <TaskControls
                  task={task}
                  send={send}
                  busy={busy || !roomActive}
                />
                <button
                  type="button"
                  disabled={busy || !roomActive}
                  onClick={() => setEditor({ id: task.id, original: task })}
                >
                  Sửa bài tập
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {view && section === "gallery" && (
        <>
          {!board && (
            <p>
              <BoardLink roomId={room.id} section="gallery">
                Mở trên bảng giảng để chèn ảnh
              </BoardLink>
            </p>
          )}
          <Suspense fallback={<p role="status">Đang mở bài làm…</p>}>
            <Gallery
              products={view.products}
              assignments={view.tasks}
              help={view.help}
              send={send}
              insert={insert}
              busy={busy}
            />
          </Suspense>
        </>
      )}
      {view && section === "help" && (
        <section aria-label="Yêu cầu trợ giúp">
          <h3>Yêu cầu trợ giúp</h3>
          {!view.help.length && (
            <p className="classroom-muted">Chưa có yêu cầu trợ giúp.</p>
          )}
          <ul className="participation-list">
            {view.help.map((item) => (
              <li key={item.id}>
                <strong>{item.displayName}</strong>
                <p className="classroom-muted">
                  {[
                    room.groups.find((group) => group.id === item.groupId)
                      ?.name,
                    helpLabel[item.state],
                  ]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  ·{" "}
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleTimeString("vi-VN")}
                  </time>
                </p>
                <p className="participation-prose">{item.explanation}</p>
                {item.taskId && (
                  <p className="classroom-muted">
                    {view.tasks.find((task) => task.id === item.taskId)?.title}
                  </p>
                )}
                {item.productId && (
                  <p className="classroom-muted">
                    {view.products.find(
                      (product) => product.id === item.productId,
                    )?.caption || "Bài nộp"}
                  </p>
                )}
                <div className="classroom-actions">
                  {item.state === "pending" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        send({ type: "acknowledgeHelp", helpId: item.id })
                      }
                    >
                      Đã nhận yêu cầu
                    </button>
                  )}
                  {(item.state === "pending" ||
                    item.state === "acknowledged") && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        send({ type: "resolveHelp", helpId: item.id })
                      }
                    >
                      Đã hỗ trợ
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view && section === "capture" && (
        <CapturePanel
          room={room}
          view={view}
          board={board}
          images={images}
          busy={busy}
          active={roomActive}
          send={send}
          insert={insert}
        />
      )}
    </section>
  );
}

const helpLabel = {
  pending: "Đang chờ",
  acknowledged: "Đã tiếp nhận",
  resolved: "Đã hỗ trợ",
  cancelled: "Đã hủy",
};

function BoardLink({
  roomId,
  section,
  children,
}: {
  roomId: string;
  section: ParticipationSection;
  children: string;
}) {
  return (
    <a
      href={
        "/app?" + new URLSearchParams({ classroom: roomId, panel: section })
      }
    >
      {children}
    </a>
  );
}

function CapturePanel({
  room,
  view,
  board,
  images,
  busy,
  active,
  send,
  insert,
}: {
  room: Room;
  view: TeacherParticipation;
  board?: BoardDestination;
  images?: boolean;
  busy: boolean;
  active: boolean;
  send: (command: TeacherParticipationCommand) => void;
  insert?: SnapshotAction;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [inFlight, setInFlight] = useState<string>();
  const controller = useRef<AbortController | null>(null);
  const grant = view.captureGrant?.revokedAt ? null : view.captureGrant;
  useEffect(() => () => controller.current?.abort(), []);

  async function insertCapture(id: string) {
    const capture = view.captures.find((item) => item.id === id);
    if (!capture || !insert || controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setInFlight(id);
    setMessage("");
    setError("");
    try {
      const { snapshotFile } = await import("./ProductGallery.tsx");
      const file = await snapshotFile(
        capture.media,
        [],
        "Ảnh chụp",
        current.signal,
      );
      current.signal.throwIfAborted();
      await insert({
        captureId: id,
        productId: null,
        mediaId: capture.media.id,
        file,
      });
      setMessage("Đã lưu ảnh trên bảng giảng.");
    } catch (failure) {
      if (!current.signal.aborted) setError(participationError(failure));
    } finally {
      controller.current = null;
      if (!current.signal.aborted) setInFlight(undefined);
    }
  }

  return (
    <section aria-label="Chụp ảnh từ điện thoại">
      <h3>Chụp ảnh từ điện thoại</h3>
      {!board && (
        <p>
          <BoardLink roomId={room.id} section="capture">
            Mở trên bảng giảng
          </BoardLink>{" "}
          để tạo mã và chọn nơi chèn.
        </p>
      )}
      {images === false && <p role="status">Kho ảnh chưa sẵn sàng.</p>}
      {grant && <CaptureCode grant={grant} serverTime={view.serverTime} />}
      <div className="classroom-actions">
        {board && (
          <button
            type="button"
            className="classroom-primary"
            disabled={busy || !active || images !== true}
            onClick={() =>
              send({
                type: grant ? "rotateCapture" : "createCapture",
                target: board.target,
              })
            }
          >
            {grant ? "Đổi mã chụp ảnh" : "Tạo mã chụp ảnh"}
          </button>
        )}
        {grant && (
          <button
            type="button"
            disabled={busy || !active}
            onClick={() => send({ type: "revokeCapture" })}
          >
            Thu hồi mã
          </button>
        )}
      </div>
      <h4>Ảnh đã nhận</h4>
      {!view.captures.length && (
        <p className="classroom-muted">Ảnh gửi từ điện thoại sẽ hiện ở đây.</p>
      )}
      <ul className="participation-products">
        {view.captures.map((capture) => {
          const previous = view.insertions.find(
            (item) => item.id === capture.insertionId,
          );
          const otherPage =
            board && !sameInsertionTarget(capture.target, board.target);
          return (
            <li key={capture.id}>
              <img
                loading="lazy"
                className="participation-capture-thumb"
                src={privateMediaUrl(capture.media.thumbnailUrl)}
                alt="Ảnh từ điện thoại"
              />
              <time dateTime={capture.acceptedAt}>
                {new Date(capture.acceptedAt).toLocaleTimeString("vi-VN")}
              </time>
              {previous?.state === "saved" ? (
                <span>Đã chèn lên bảng</span>
              ) : (
                board && (
                  <>
                    {otherPage && (
                      <p className="classroom-muted">
                        Mã này được tạo ở trang khác.
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={busy || !!inFlight}
                      onClick={() => void insertCapture(capture.id)}
                    >
                      {otherPage
                        ? "Chèn vào trang đang mở"
                        : "Chèn ảnh lên bảng"}
                    </button>
                  </>
                )
              )}
            </li>
          );
        })}
      </ul>
      {inFlight && <p role="status">Đang lưu ảnh trên bảng…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function CaptureCode({
  grant,
  serverTime,
}: {
  grant: CaptureGrant;
  serverTime: string;
}) {
  const link = new URL(
    "/capture#code=" + encodeURIComponent(grant.code),
    location.origin,
  ).href;
  const [qr, setQr] = useState("");
  const [copy, setCopy] = useState("");
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    let current = true;
    setQr("");
    setCopy("");
    const remaining = Math.max(
      0,
      Date.parse(grant.expiresAt) - Date.parse(serverTime),
    );
    setExpired(remaining === 0);
    const timer = setTimeout(() => setExpired(true), remaining);
    if (remaining)
      void import("qrcode")
        .then(({ default: qr }) =>
          qr.toDataURL(link, { width: 192, margin: 2 }),
        )
        .then(
          (image) => {
            if (current) setQr(image);
          },
          () => {},
        );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [grant.expiresAt, link, serverTime]);
  if (expired)
    return <p role="status">Mã đã hết hạn. Tạo mã mới để tiếp tục.</p>;
  return (
    <div className="participation-code">
      {qr && <img src={qr} width="192" height="192" alt="Mã QR chụp ảnh" />}
      <div>
        <p>Quét mã bằng điện thoại để gửi ảnh.</p>
        <label>
          Liên kết chụp ảnh
          <input
            value={link}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(link).then(
              () => setCopy("Đã sao chép liên kết."),
              () => setCopy("Chọn liên kết để sao chép."),
            )
          }
        >
          Sao chép liên kết
        </button>
        {copy && <p role="status">{copy}</p>}
      </div>
    </div>
  );
}
