import { useEffect, useRef, useState } from "react";
import { ClassroomError } from "../../modules/classroom/api.ts";
import type { ParticipantRoom } from "../../modules/classroom/api.ts";
import {
  classroomImages,
  externalSubmissionUrl,
  MAX_PRODUCT_BYTES,
  MAX_PRODUCT_IMAGES,
  participationApi,
  privateMediaUrl,
  uploadClassroomImage,
} from "../../modules/classroom/participation-api.ts";
import type { DraftImage } from "../../modules/classroom/participation-api.ts";
import {
  clearSubmissionDraft,
  loadSubmissionDraft,
  saveSubmissionDraft,
  sendParticipationCommand,
} from "../../modules/classroom/participation-outbox.ts";
import type { SubmissionDraft } from "../../modules/classroom/participation-outbox.ts";
import type {
  ClassroomProduct,
  StudentParticipationCommand,
} from "../../modules/classroom/participation-types.ts";
import { TaskSummary } from "./ParticipationTask.tsx";
import { participationError, useParticipation } from "./ParticipationState.ts";
import "./participation.css";

const emptyDraft = (): SubmissionDraft => ({
  taskId: "",
  caption: "",
  link: "",
  images: [],
});
const helpState = {
  pending: "Đang chờ",
  acknowledged: "Giáo viên đã nhận",
  resolved: "Đã giải quyết",
  cancelled: "Đã hủy",
};

export default function StudentParticipation({
  room,
  onDenied,
}: {
  room: ParticipantRoom;
  onDenied: () => void;
}) {
  const scope = "student:" + room.id + ":" + room.self.id;
  const live = useParticipation(
    participationApi.student,
    room.revision,
    onDenied,
  );
  const [draft, setDraft] = useState<SubmissionDraft>(emptyDraft);
  const [ready, setReady] = useState(false);
  const [format, setFormat] = useState<"images" | "link">();
  const [imagesAvailable, setImagesAvailable] = useState<boolean>();
  const [help, setHelp] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const action = useRef<AbortController | null>(null);
  const camera = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void loadSubmissionDraft(scope).then(
      (value) => {
        if (!active) return;
        if (value) {
          setDraft(value);
          setFormat(
            value.attempt?.kind ??
              (value.images.length
                ? "images"
                : value.link
                  ? "link"
                  : undefined),
          );
        }
        setReady(true);
      },
      () => {
        if (active) setError("Không mở được bản nháp trên thiết bị này.");
      },
    );
    return () => {
      active = false;
      action.current?.abort();
    };
  }, [scope]);
  useEffect(() => {
    const controller = new AbortController();
    void participationApi.capabilities(controller.signal).then(
      (value) => setImagesAvailable(value.images),
      () => {
        if (!controller.signal.aborted) setImagesAvailable(false);
      },
    );
    return () => controller.abort();
  }, []);

  const view = live.data?.participation;
  const csrf = live.data?.csrfToken;
  const task =
    view?.tasks.find((item) => item.id === draft.taskId) ?? view?.tasks[0];
  const imageAllowed = task?.allowedTypes.includes("image");
  const linkAllowed = task?.allowedTypes.includes("link");
  const kind =
    draft.attempt?.kind ??
    format ??
    (linkAllowed && (!imageAllowed || imagesAvailable === false)
      ? "link"
      : "images");
  const allowed =
    kind === "images" ? imageAllowed && imagesAvailable === true : linkAllowed;

  function update(value: Partial<SubmissionDraft>) {
    const next = {
      ...draft,
      taskId: task?.id ?? "",
      ...value,
      attempt: undefined,
      attemptKey: undefined,
    };
    setDraft(next);
    setError("");
    void saveSubmissionDraft(scope, next).catch(() =>
      setError("Thiết bị chưa lưu được bản nháp. Giữ trang này mở và thử lại."),
    );
  }

  function addImages(input: HTMLInputElement) {
    const selected = Array.from(input.files ?? []);
    input.value = "";
    if (!selected.length) return;
    try {
      const next = [...draft.images, ...classroomImages(selected)];
      if (next.length > MAX_PRODUCT_IMAGES)
        throw new Error("Chọn tối đa 4 ảnh cho mỗi bài nộp.");
      if (
        next.reduce((sum, item) => sum + item.file.size, 0) > MAX_PRODUCT_BYTES
      )
        throw new Error("Tổng dung lượng ảnh tối đa 20 MB.");
      update({ images: next });
    } catch (failure) {
      setError(participationError(failure));
    }
  }

  function run(operation: (signal: AbortSignal) => Promise<void>) {
    if (action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    void operation(controller.signal)
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(participationError(failure));
        if (failure instanceof ClassroomError && failure.status === 401)
          onDenied();
        else live.refresh();
      })
      .finally(() => {
        if (action.current === controller) action.current = null;
        if (!controller.signal.aborted) {
          setBusy(false);
          setProgress(undefined);
        }
      });
  }

  async function command(
    body: StudentParticipationCommand,
    signal: AbortSignal,
    key?: string,
  ) {
    if (!csrf) throw new Error("Phiên tham gia chưa sẵn sàng.");
    const result = key
      ? await participationApi.submit(body, csrf, key, signal)
      : await sendParticipationCommand(scope, body, (key) =>
          participationApi.submit(body, csrf, key, signal),
        );
    if (!signal.aborted)
      live.apply({ participation: result.participation, csrfToken: csrf });
    return result;
  }

  function submit() {
    if (!task || !csrf) return;
    run(async (signal) => {
      let body = draft.attempt;
      const attemptKey = draft.attemptKey ?? crypto.randomUUID();
      if (!body) {
        if (!task.submissionOpen || !allowed)
          throw new Error("Bài tập hiện không nhận định dạng này.");
        const link =
          kind === "link"
            ? externalSubmissionUrl(draft.link.trim())
            : undefined;
        if (kind === "link" && !link)
          throw new Error("Nhập một liên kết HTTPS hợp lệ.");
        if (kind === "images" && !draft.images.length)
          throw new Error("Chọn ít nhất một ảnh.");
        const mediaIds: string[] = [];
        const total = draft.images.reduce(
          (sum, item) => sum + item.file.size,
          0,
        );
        let sent = 0;
        if (kind === "images") {
          setProgress(0);
          for (const image of draft.images) {
            mediaIds.push(
              await uploadClassroomImage(
                "participant",
                image,
                csrf,
                (bytes) => setProgress((sent + bytes) / total),
                signal,
              ),
            );
            sent += image.file.size;
          }
        }
        body = {
          type: "submitProduct",
          taskId: task.id,
          taskRevision: task.revision,
          kind,
          caption: draft.caption.trim(),
          link: link ?? null,
          mediaIds,
        };
      }
      const awaiting = {
        ...draft,
        taskId: body.taskId,
        attempt: body,
        attemptKey,
      };
      await saveSubmissionDraft(scope, awaiting);
      setDraft(awaiting);
      setNotice("Đang chờ máy chủ xác nhận…");
      try {
        const result = await command(body, signal, attemptKey);
        signal.throwIfAborted();
        await clearSubmissionDraft(scope).catch(() => {});
        setDraft({ ...emptyDraft(), taskId: task.id });
        setNotice(
          "Đã nộp bài lúc " +
            new Date(result.receipt.acceptedAt).toLocaleTimeString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
            }),
        );
      } catch (failure) {
        setNotice("");
        if (failure instanceof ClassroomError && !failure.retryable) {
          const editable = {
            ...draft,
            taskId: task.id,
            attempt: undefined,
            attemptKey: undefined,
          };
          setDraft(editable);
          await saveSubmissionDraft(scope, editable).catch(() => {});
        }
        throw failure;
      }
    });
  }

  if (live.unsupported) return null;
  return (
    <section
      className="classroom-panel participation-student"
      aria-label="Bài tập và bài nộp"
    >
      <h3>Bài tập và bài nộp</h3>
      {live.error && (
        <p role="alert">
          {live.error}{" "}
          <button type="button" onClick={live.refresh}>
            Tải lại
          </button>
        </p>
      )}
      {!view && !live.error && <p role="status">Đang tải bài tập…</p>}
      {view && !task && (
        <p className="classroom-muted">Chưa có bài tập được giao cho bạn.</p>
      )}
      {task && (
        <>
          {view && view.tasks.length > 1 && (
            <label className="participation-field">
              Bài tập
              <select
                value={task.id}
                disabled={busy || !!draft.attempt}
                onChange={(event) => {
                  setFormat(undefined);
                  update({ taskId: event.target.value });
                }}
              >
                {view.tasks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <TaskSummary task={task} clock={live.clock} />
          <form
            className="participation-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <fieldset disabled={!ready || busy}>
              <legend>Bản nháp</legend>
              <label>
                Cách nộp
                <select
                  value={kind}
                  disabled={!!draft.attempt}
                  onChange={(event) => {
                    setFormat(
                      event.target.value === "link" ? "link" : "images",
                    );
                    update({});
                  }}
                >
                  <option value="images" disabled={!imageAllowed}>
                    Ảnh
                  </option>
                  <option value="link" disabled={!linkAllowed}>
                    Liên kết HTTPS
                  </option>
                </select>
              </label>
              {kind === "images" ? (
                <>
                  <label>
                    Chọn ảnh bài làm
                    <input
                      type="file"
                      multiple
                      disabled={!!draft.attempt}
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => addImages(event.currentTarget)}
                    />
                  </label>
                  <input
                    className="participation-native-camera"
                    ref={camera}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    hidden
                    aria-label="Camera bài làm"
                    onChange={(event) => addImages(event.currentTarget)}
                  />
                  <button
                    type="button"
                    disabled={!!draft.attempt}
                    onClick={() => camera.current?.click()}
                  >
                    Chụp thêm ảnh
                  </button>
                  <div className="participation-draft-images">
                    {draft.images.map((image) => (
                      <DraftPreview
                        key={image.requestId}
                        image={image}
                        remove={
                          draft.attempt
                            ? undefined
                            : () =>
                                update({
                                  images: draft.images.filter(
                                    (item) => item !== image,
                                  ),
                                })
                        }
                      />
                    ))}
                  </div>
                </>
              ) : (
                <label>
                  Liên kết bài làm
                  <input
                    type="url"
                    maxLength={2000}
                    placeholder="https://"
                    value={draft.link}
                    readOnly={!!draft.attempt}
                    onChange={(event) => update({ link: event.target.value })}
                  />
                </label>
              )}
              <label>
                Mô tả ngắn
                <textarea
                  rows={2}
                  maxLength={500}
                  value={draft.caption}
                  readOnly={!!draft.attempt}
                  onChange={(event) => update({ caption: event.target.value })}
                />
              </label>
              {kind === "images" && imagesAvailable === false && (
                <p className="classroom-muted">
                  Kho ảnh chưa sẵn sàng. Bạn có thể lưu ảnh vào bản nháp.
                </p>
              )}
              <div className="classroom-actions">
                <button
                  type="submit"
                  className="classroom-primary"
                  disabled={
                    !draft.attempt && (!task.submissionOpen || !allowed)
                  }
                >
                  {draft.attempt ? "Kiểm tra lại lần nộp" : "Nộp bài"}
                </button>
                <button
                  type="button"
                  disabled={!!draft.attempt}
                  onClick={() => update({ ...emptyDraft(), taskId: task.id })}
                >
                  Xóa bản nháp
                </button>
              </div>
            </fieldset>
          </form>
        </>
      )}
      {progress !== undefined && (
        <p className="participation-progress">
          <span>
            {progress === 1 ? "Đang kiểm tra ảnh…" : "Đang tải ảnh lên"}
          </span>
          <progress aria-label="Tiến độ tải ảnh" value={progress} max={1} />
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {view && (
        <>
          <section className="participation-section" aria-label="Bài đã nộp">
            <h4>Bài đã nộp</h4>
            {view.products.length ? (
              <ul className="participation-items">
                {view.products.map((product) => (
                  <li key={product.id}>
                    <ProductSummary product={product} showFeedback />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="classroom-muted">
                Chưa có bài được máy chủ xác nhận.
              </p>
            )}
          </section>
          <section
            className="participation-section"
            aria-label="Yêu cầu trợ giúp"
          >
            <h4>Yêu cầu trợ giúp</h4>
            <form
              className="participation-form"
              onSubmit={(event) => {
                event.preventDefault();
                run(async (signal) => {
                  await command(
                    {
                      type: "requestHelp",
                      taskId: task?.id ?? null,
                      productId: null,
                      explanation: help.trim(),
                    },
                    signal,
                  );
                  setHelp("");
                  setNotice("Đã gửi yêu cầu trợ giúp.");
                });
              }}
            >
              <label>
                Bạn đang vướng ở đâu?
                <textarea
                  rows={2}
                  maxLength={500}
                  value={help}
                  onChange={(event) => setHelp(event.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={
                  busy ||
                  !csrf ||
                  view.help.some(
                    (item) =>
                      item.state === "pending" || item.state === "acknowledged",
                  )
                }
              >
                Xin trợ giúp
              </button>
            </form>
            <ul className="participation-items">
              {view.help.map((item) => (
                <li key={item.id}>
                  <span>
                    {helpState[item.state]}
                    {item.explanation && " · " + item.explanation}
                  </span>
                  {item.state === "pending" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(async (signal) => {
                          await command(
                            { type: "cancelHelp", helpId: item.id },
                            signal,
                          );
                        })
                      }
                    >
                      Hủy yêu cầu
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {!!view.gallery.length && (
            <section
              className="participation-section"
              aria-label="Bài được trưng bày"
            >
              <h4>Bài được trưng bày</h4>
              <ul className="participation-items">
                {view.gallery.map((product) => (
                  <li key={product.id}>
                    <ProductSummary product={product} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function DraftPreview({
  image,
  remove,
}: {
  image: DraftImage;
  remove?: () => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(image.file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image.file]);
  return (
    <figure>
      {url && <img src={url} alt={"Ảnh nháp " + image.file.name} />}
      {remove && (
        <button
          type="button"
          onClick={remove}
          aria-label={"Bỏ ảnh " + image.file.name}
        >
          Bỏ ảnh
        </button>
      )}
    </figure>
  );
}

export function ProductSummary({
  product,
  showFeedback = false,
}: {
  product: ClassroomProduct;
  showFeedback?: boolean;
}) {
  const link = externalSubmissionUrl(product.link);
  return (
    <article className="participation-receipt">
      <strong>
        {product.removedAt
          ? "Bài đã gỡ"
          : product.caption ||
            (product.kind === "link" ? "Liên kết bài làm" : "Ảnh bài làm")}
      </strong>
      <time dateTime={product.acceptedAt}>
        {new Date(product.acceptedAt).toLocaleString("vi-VN")}
      </time>
      {!product.removedAt && (
        <>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer">
              Mở liên kết bên ngoài
            </a>
          )}
          {!!product.media.length && (
            <div className="participation-thumbs">
              {product.media.map((item, index) => (
                <img
                  key={item.id}
                  loading="lazy"
                  src={privateMediaUrl(item.thumbnailUrl)}
                  alt={(product.caption || "Ảnh bài nộp") + " · " + (index + 1)}
                />
              ))}
            </div>
          )}
        </>
      )}
      {showFeedback && !!product.feedback.length && (
        <ul className="participation-feedback">
          {product.feedback.map((item) => (
            <li key={item.id}>
              <strong>Nhận xét của giáo viên</strong>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
