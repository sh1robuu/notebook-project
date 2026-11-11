import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../../app/Icon.tsx";
import {
  annotationPath,
  annotationStyle,
  editAnnotations,
  emptyAnnotations,
  makeAnnotationSnapshot,
  pointInImage,
  strokeHit,
} from "../../modules/classroom/annotations.ts";
import type {
  Annotation,
  AnnotationHistory,
  ImagePoint,
} from "../../modules/classroom/annotations.ts";
import {
  externalSubmissionUrl,
  privateMediaUrl,
} from "../../modules/classroom/participation-api.ts";
import type {
  ClassroomHelp,
  ClassroomMedia,
  ClassroomProduct,
  ClassroomTask,
  TeacherParticipationCommand,
} from "../../modules/classroom/participation-types.ts";
import { participationError } from "./ParticipationState.ts";

export type SnapshotAction = (source: {
  productId: string | null;
  captureId: string | null;
  mediaId: string;
  file: File;
}) => Promise<void>;

export default function ProductGallery({
  products,
  assignments,
  help,
  send,
  insert,
  busy,
}: {
  products: ClassroomProduct[];
  assignments: ClassroomTask[];
  help: ClassroomHelp[];
  send: (command: TeacherParticipationCommand) => Promise<boolean>;
  insert?: SnapshotAction;
  busy: boolean;
}) {
  const [active, setActive] = useState<string>();
  const [compared, setCompared] = useState<string[]>([]);
  const [mode, setMode] = useState<"browse" | "compare">("browse");
  const [presenting, setPresenting] = useState(false);
  const [group, setGroup] = useState("");
  const [task, setTask] = useState("");
  const [drawings, setDrawings] = useState<Record<string, AnnotationHistory>>(
    {},
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const published = products.filter((product) => !product.removedAt);
  const matching = published.filter(
    (product) =>
      (!group || (product.groupId ?? "individual") === group) &&
      (!task || product.taskId === task),
  );
  const selected = published.find((product) => product.id === active);
  const index = matching.findIndex((product) => product.id === active);
  const groups = new Map(
    published.map((product) => [
      product.groupId ?? "individual",
      product.groupName ?? "Cá nhân",
    ]),
  );
  const tasks = new Map(assignments.map((task) => [task.id, task.title]));
  const pendingHelp = new Set(
    help
      .filter(
        (item) => item.state === "pending" || item.state === "acknowledged",
      )
      .map((item) => item.participantId),
  );
  const counts = new Map<string, number>();
  for (const product of published)
    counts.set(
      product.groupId ?? product.participantId,
      (counts.get(product.groupId ?? product.participantId) ?? 0) + 1,
    );

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const media = new Set(
      products
        .filter((product) => !product.removedAt)
        .flatMap((product) => product.media.map((item) => item.id)),
    );
    setDrawings((old) =>
      Object.keys(old).some((id) => !media.has(id))
        ? Object.fromEntries(
            Object.entries(old).filter(([id]) => media.has(id)),
          )
        : old,
    );
  }, [products]);

  async function snapshot(product: ClassroomProduct, media: ClassroomMedia) {
    if (!insert || controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setSaving(true);
    setError("");
    setNote("");
    try {
      const file = await snapshotFile(
        media,
        drawings[media.id]?.strokes ?? [],
        product.caption || "Bài làm",
        current.signal,
      );
      current.signal.throwIfAborted();
      await insert({
        productId: product.id,
        captureId: null,
        mediaId: media.id,
        file,
      });
      setNote("Đã lưu ảnh trên bảng giảng.");
    } catch (failure) {
      if (!current.signal.aborted) setError(participationError(failure));
    } finally {
      if (controller.current === current) controller.current = null;
      if (!current.signal.aborted) setSaving(false);
    }
  }
  function detail(product: ClassroomProduct) {
    return (
      <ProductDetail
        key={product.id}
        product={product}
        drawings={drawings}
        change={(mediaId, history) =>
          setDrawings((old) => ({ ...old, [mediaId]: history }))
        }
        snapshot={insert ? (media) => void snapshot(product, media) : undefined}
        busy={busy || saving}
        send={send}
      />
    );
  }

  return (
    <section
      className="participation-gallery"
      aria-label="Trưng bày bài làm"
      data-presenting={presenting || undefined}
    >
      <div className="participation-heading">
        <h3>Trưng bày bài làm</h3>
        <div className="classroom-actions">
          <button
            type="button"
            disabled={compared.length < 2}
            onClick={() => setMode("compare")}
          >
            So sánh ({compared.length})
          </button>
          {(mode === "compare" || selected) && (
            <button
              type="button"
              aria-pressed={presenting}
              onClick={() => setPresenting((value) => !value)}
            >
              {presenting ? "Thoát trình bày" : "Trình bày"}
            </button>
          )}
          {mode === "compare" && (
            <button
              type="button"
              onClick={() => {
                setMode("browse");
                setPresenting(false);
              }}
            >
              Về thư viện
            </button>
          )}
        </div>
      </div>
      {mode === "compare" ? (
        <div className="participation-compare">
          {compared.map((id) => {
            const product = published.find((item) => item.id === id);
            return product ? (
              detail(product)
            ) : (
              <p key={id} role="status">
                Bài đã gỡ hoặc không còn quyền xem.
              </p>
            );
          })}
        </div>
      ) : (
        <>
          <div className="participation-filters" hidden={presenting}>
            <label>
              Nhóm
              <select
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              >
                <option value="">Tất cả</option>
                {[...groups].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bài tập
              <select
                value={task}
                onChange={(event) => setTask(event.target.value)}
              >
                <option value="">Tất cả</option>
                {[...tasks].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!matching.length && (
            <p className="classroom-muted">Chưa có bài làm trong bộ lọc này.</p>
          )}
          <ul className="participation-products" hidden={presenting}>
            {matching.map((product) => (
              <li key={product.id} data-selected={product.id === active}>
                <button
                  type="button"
                  className="participation-card-open"
                  onClick={() => setActive(product.id)}
                >
                  {product.media[0] ? (
                    <img
                      loading="lazy"
                      alt=""
                      src={privateMediaUrl(product.media[0].thumbnailUrl)}
                    />
                  ) : (
                    <Icon name="open" />
                  )}
                  <span>
                    <strong>{product.displayName}</strong>
                    <small>
                      {product.groupName ?? "Cá nhân"} ·{" "}
                      {product.caption ||
                        (product.kind === "link" ? "Liên kết" : "Ảnh")}
                    </small>
                    <small>
                      {tasks.get(product.taskId)} ·{" "}
                      {counts.get(product.groupId ?? product.participantId)} bài
                    </small>
                    <small>
                      {product.published ? "Đang trưng bày" : "Riêng tư"} ·{" "}
                      {product.feedback.length} nhận xét
                      {pendingHelp.has(product.participantId)
                        ? " · Cần trợ giúp"
                        : ""}
                    </small>
                  </span>
                </button>
                <label className="participation-inline">
                  <input
                    type="checkbox"
                    checked={compared.includes(product.id)}
                    aria-label={
                      "So sánh " + product.displayName + " " + product.caption
                    }
                    disabled={
                      !compared.includes(product.id) && compared.length >= 3
                    }
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setCompared((current) =>
                        checked
                          ? [...current, product.id]
                          : current.filter((id) => id !== product.id),
                      );
                    }}
                  />{" "}
                  So sánh
                </label>
              </li>
            ))}
          </ul>
          {active && !selected && (
            <p role="status">
              Bài đang xem đã gỡ hoặc không còn quyền truy cập.
            </p>
          )}
          {selected && (
            <>
              <div className="classroom-actions participation-browse">
                <button
                  type="button"
                  disabled={index <= 0}
                  onClick={() => setActive(matching[index - 1]?.id)}
                >
                  Bài trước
                </button>
                <button
                  type="button"
                  disabled={index < 0 || index >= matching.length - 1}
                  onClick={() => setActive(matching[index + 1]?.id)}
                >
                  Bài tiếp
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActive(undefined);
                    setPresenting(false);
                  }}
                >
                  Đóng bài
                </button>
              </div>
              {detail(selected)}
            </>
          )}
        </>
      )}
      {saving && <p role="status">Đang tải và lưu ảnh trên bảng…</p>}
      {note && <p role="status">{note}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function ProductDetail({
  product,
  drawings,
  change,
  snapshot,
  send,
  busy,
}: {
  product: ClassroomProduct;
  drawings: Record<string, AnnotationHistory>;
  change: (id: string, history: AnnotationHistory) => void;
  snapshot?: (media: ClassroomMedia) => void;
  send: (command: TeacherParticipationCommand) => Promise<boolean>;
  busy: boolean;
}) {
  const [activeMedia, setActiveMedia] = useState(product.media[0]?.id);
  const media = product.media.find((item) => item.id === activeMedia);
  const link = externalSubmissionUrl(product.link);
  return (
    <article
      className="participation-product-detail"
      aria-label={"Bài của " + product.displayName}
    >
      <div className="participation-heading">
        <h4>
          {product.displayName}
          {product.groupName && " · " + product.groupName}
        </h4>
        <time dateTime={product.acceptedAt}>
          {new Date(product.acceptedAt).toLocaleTimeString("vi-VN")}
        </time>
      </div>
      {product.caption && (
        <p className="participation-prose">{product.caption}</p>
      )}
      {link && (
        <p>
          <a href={link} target="_blank" rel="noopener noreferrer">
            Mở liên kết bên ngoài
          </a>
        </p>
      )}
      {product.media.length > 1 && (
        <div
          className="participation-thumbs"
          role="group"
          aria-label="Ảnh trong bài"
        >
          {product.media.map((item, index) => (
            <button
              type="button"
              key={item.id}
              aria-label={"Xem ảnh " + (index + 1)}
              aria-pressed={item.id === activeMedia}
              onClick={() => setActiveMedia(item.id)}
            >
              <img
                loading="lazy"
                src={privateMediaUrl(item.thumbnailUrl)}
                alt=""
              />
            </button>
          ))}
        </div>
      )}
      {media && (
        <AnnotationStage
          key={media.id}
          media={media}
          alt={product.caption || "Bài của " + product.displayName}
          history={drawings[media.id] ?? emptyAnnotations()}
          update={(history) => change(media.id, history)}
          snapshot={snapshot ? () => snapshot(media) : undefined}
          busy={busy}
        />
      )}
      <details className="participation-private-notes participation-moderation">
        <summary>Nhận xét và hiển thị</summary>
        {!!product.feedback.length && (
          <ul className="participation-feedback">
            {product.feedback.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        )}
        <form
          className="participation-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const text = String(
              new FormData(form).get("feedback") ?? "",
            ).trim();
            if (text)
              void send({ type: "feedback", productId: product.id, text }).then(
                (committed) => {
                  if (
                    committed &&
                    String(new FormData(form).get("feedback") ?? "").trim() ===
                      text
                  )
                    form.reset();
                },
              );
          }}
        >
          <label>
            Nhận xét riêng
            <textarea name="feedback" maxLength={1000} rows={2} required />
          </label>
          <button type="submit" disabled={busy}>
            Gửi nhận xét
          </button>
        </form>
        <div className="classroom-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              send({
                type: "publishProduct",
                productId: product.id,
                published: !product.published,
              })
            }
          >
            {product.published ? "Ẩn khỏi học sinh" : "Cho lớp xem"}
          </button>
          <details>
            <summary>Gỡ bài</summary>
            <p>Bài sẽ biến mất khỏi thư viện của lớp.</p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                send({ type: "removeProduct", productId: product.id })
              }
            >
              Xác nhận gỡ bài
            </button>
          </details>
        </div>
      </details>
    </article>
  );
}

type Tool = "pen" | "highlight" | "erase" | "hand";
const tools = [
  ["pen", "pen", "Bút"],
  ["highlight", "highlight", "Bút tô"],
  ["erase", "erase", "Tẩy nét"],
  ["hand", "hand", "Cuộn ảnh"],
] as const;

function AnnotationStage({
  media,
  alt,
  history,
  update,
  snapshot,
  busy,
}: {
  media: ClassroomMedia;
  alt: string;
  history: AnnotationHistory;
  update: (next: AnnotationHistory) => void;
  snapshot?: () => void;
  busy: boolean;
}) {
  const [tool, setTool] = useState<Tool>("pen");
  const [zoom, setZoom] = useState(1);
  const [unavailable, setUnavailable] = useState(false);
  const drawing = useRef<{
    id: number;
    tool: "pen" | "highlight";
    points: ImagePoint[];
  }>(undefined);
  const transient = useRef<SVGPathElement>(null);
  const { width, height } = media;
  const style = annotationStyle(
    tool === "highlight" ? "highlight" : "pen",
    width,
    height,
  );
  function point(event: ReactPointerEvent<SVGSVGElement>) {
    return pointInImage(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
  }
  function finish(event: ReactPointerEvent<SVGSVGElement>, commit: boolean) {
    const current = drawing.current;
    if (!current || current.id !== event.pointerId) return;
    drawing.current = undefined;
    transient.current?.setAttribute("d", "");
    if (commit)
      update(
        editAnnotations(history, {
          type: "add",
          stroke: {
            id: crypto.randomUUID(),
            tool: current.tool,
            points: current.points,
          },
        }),
      );
  }
  return (
    <>
      <div
        className="participation-annotation-toolbar"
        role="group"
        aria-label="Ghi chú trên ảnh"
      >
        {tools.map(([id, icon, label]) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={tool === id}
            onClick={() => setTool(id)}
          >
            <Icon name={icon} />
          </button>
        ))}
        <button
          type="button"
          aria-label="Hoàn tác ghi chú"
          title="Hoàn tác ghi chú"
          disabled={!history.past.length}
          onClick={() => update(editAnnotations(history, { type: "undo" }))}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          aria-label="Làm lại ghi chú"
          title="Làm lại ghi chú"
          disabled={!history.future.length}
          onClick={() => update(editAnnotations(history, { type: "redo" }))}
        >
          <Icon name="redo" />
        </button>
        <button
          type="button"
          aria-label="Xóa ghi chú"
          title="Xóa ghi chú"
          disabled={!history.strokes.length}
          onClick={() => update(editAnnotations(history, { type: "clear" }))}
        >
          <Icon name="trash" />
        </button>
        <button
          type="button"
          aria-label="Thu nhỏ ảnh"
          title="Thu nhỏ ảnh"
          disabled={zoom <= 1}
          onClick={() => setZoom((value) => value - 0.5)}
        >
          <Icon name="minus" />
        </button>
        <button
          type="button"
          aria-label="Phóng to ảnh"
          title="Phóng to ảnh"
          disabled={zoom >= 2.5}
          onClick={() => setZoom((value) => value + 0.5)}
        >
          <Icon name="plus" />
        </button>
        {snapshot && (
          <button
            type="button"
            aria-label="Chèn ảnh lên bảng"
            title="Chèn ảnh lên bảng"
            disabled={busy || unavailable}
            onClick={snapshot}
          >
            <Icon name="image" />
          </button>
        )}
      </div>
      {unavailable ? (
        <p role="status">Ảnh không còn khả dụng.</p>
      ) : (
        <div
          className="participation-media-scroll"
          tabIndex={0}
          aria-label="Vùng xem ảnh"
        >
          <figure
            className="participation-media-stage"
            style={{
              aspectRatio: width + "/" + height,
              width:
                zoom === 1
                  ? "min(100%, " +
                    Math.min(1000, (520 * width) / height) +
                    "px)"
                  : zoom * 100 + "%",
            }}
          >
            <img
              src={privateMediaUrl(media.url)}
              alt={alt}
              onError={() => setUnavailable(true)}
            />
            <svg
              viewBox={"0 0 " + width + " " + height}
              aria-hidden="true"
              data-tool={tool}
              onPointerDown={(event) => {
                if (tool === "hand" || event.button !== 0 || drawing.current)
                  return;
                const start = point(event);
                if (tool === "erase") {
                  const box = event.currentTarget.getBoundingClientRect();
                  const hit = history.strokes.findLast((stroke) =>
                    strokeHit(stroke, start, box.width, box.height, 12),
                  );
                  if (hit)
                    update(
                      editAnnotations(history, { type: "erase", id: hit.id }),
                    );
                  return;
                }
                event.currentTarget.setPointerCapture(event.pointerId);
                drawing.current = {
                  id: event.pointerId,
                  tool,
                  points: [start],
                };
                transient.current?.setAttribute(
                  "d",
                  annotationPath([start], width, height),
                );
              }}
              onPointerMove={(event) => {
                const current = drawing.current;
                if (
                  current?.id !== event.pointerId ||
                  current.points.length >= 1800
                )
                  return;
                current.points.push(point(event));
                transient.current?.setAttribute(
                  "d",
                  annotationPath(current.points, width, height),
                );
              }}
              onPointerUp={(event) => finish(event, true)}
              onPointerCancel={(event) => finish(event, false)}
              onLostPointerCapture={(event) => finish(event, false)}
            >
              {history.strokes.map((stroke) => {
                const appearance = annotationStyle(stroke.tool, width, height);
                return (
                  <path
                    key={stroke.id}
                    d={annotationPath(stroke.points, width, height)}
                    stroke={appearance.color}
                    strokeOpacity={appearance.opacity}
                    strokeWidth={appearance.width}
                  />
                );
              })}
              <path
                ref={transient}
                stroke={style.color}
                strokeOpacity={style.opacity}
                strokeWidth={style.width}
              />
            </svg>
          </figure>
        </div>
      )}
    </>
  );
}

export async function snapshotFile(
  media: ClassroomMedia,
  strokes: readonly Annotation[],
  name: string,
  signal?: AbortSignal,
) {
  const url = privateMediaUrl(media.url);
  if (!url) throw new Error("Không tìm thấy ảnh được cấp quyền.");
  const response = await fetch(url, {
    credentials: "same-origin",
    mode: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (
    !response.ok ||
    !/^image\/(?:jpeg|png|webp)$/i.test(
      response.headers.get("Content-Type") ?? "",
    )
  )
    throw new Error("Ảnh đã gỡ hoặc phiên xem đã hết.");
  return makeAnnotationSnapshot(await response.blob(), strokes, name);
}
