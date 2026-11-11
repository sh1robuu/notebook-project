import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FormEvent } from "react";
import { classroomEnabled } from "../../config/classroom.ts";
import type { BoardEngine } from "../../modules/board/engine.ts";
import { classroomApi, classroomError } from "../../modules/classroom/api.ts";
import type { RoomSummary } from "../../modules/classroom/api.ts";
import {
  insertCallerResult,
  insertionTarget,
} from "../../modules/classroom/board-insertion.ts";
import { CallerStore } from "../../modules/classroom/caller-store.ts";
import {
  appendNames,
  createCallerClass,
  drawLearners,
  editLearner,
  eligibleLearners,
  exportCallerClass,
  importCallerClass,
  isDrawCount,
  MAX_CALLER_IMPORT_BYTES,
  MAX_CALLER_NAME,
  MAX_CALLER_TITLE,
  parseRosterImport,
  removeLearner,
  renameCallerClass,
  reorderLearner,
  resetCallerCycle,
} from "../../modules/classroom/roster.ts";
import type { CallerClass } from "../../modules/classroom/roster.ts";
import { Icon } from "../Icon.tsx";
import "../context-tools.css";
import "./caller.css";

function downloadClass(list: CallerClass) {
  const href = URL.createObjectURL(
    new Blob([exportCallerClass(list)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = href;
  link.download = list.title.replace(/[<>:"/\\|?*]/g, "_") + ".caller.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

function labelByIdentity(
  list: CallerClass,
  learner: { id: string; name: string },
) {
  const index = list.learners.findIndex(
    (candidate) => candidate.id === learner.id,
  );
  return index < 0
    ? learner.name + " · đã rời danh sách"
    : learner.name + " · số " + (index + 1);
}

export default function Caller({
  engine,
  onClose,
}: {
  engine: BoardEngine;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const className = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const hostedRequest = useRef<AbortController | null>(null);
  const operating = useRef(false);
  const [store] = useState(() => new CallerStore());
  const [lists, setLists] = useState<CallerClass[]>([]);
  const [active, setActive] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirming, setConfirming] = useState<"reset" | "delete" | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [roomId, setRoomId] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const readOnly = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().readOnly,
  );
  const list = lists.find((entry) => entry.id === active);
  const remaining = list ? eligibleLearners(list).length : 0;
  const ready = !loading && !busy;

  function showData(data: Awaited<ReturnType<CallerStore["read"]>>) {
    setLists(data.lists);
    setActive(data.active);
  }

  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement;
    let mounted = true;
    node?.showModal();
    closeButton.current?.focus();
    void store
      .read()
      .then((data) => {
        if (!mounted) return;
        showData(data);
        setCreating(!data.active);
      })
      .catch(() => {
        if (mounted) setError("Không đọc được danh sách trên thiết bị này.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    const connectivity = () => setOnline(navigator.onLine);
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    return () => {
      mounted = false;
      hostedRequest.current?.abort();
      store.close();
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      if (node?.open) node.close();
      if (opener instanceof HTMLElement && opener.isConnected) {
        if (opener.getClientRects().length)
          opener.focus({ preventScroll: true });
        else
          opener
            .closest(".adaptive-tools")
            ?.querySelector<HTMLButtonElement>(".adaptive-trigger")
            ?.focus({ preventScroll: true });
      }
    };
  }, [store]);

  useEffect(() => {
    if (!loading && creating) className.current?.focus();
  }, [loading, creating]);

  async function run(operation: () => Promise<void>) {
    if (operating.current) return;
    operating.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await operation();
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError")
        return;
      setError(
        failure instanceof Error &&
          !["QuotaExceededError", "AbortError"].includes(failure.name)
          ? failure.message
          : "Không lưu được danh sách trên thiết bị. Hãy kiểm tra dung lượng và thử lại.",
      );
    } finally {
      operating.current = false;
      setBusy(false);
    }
  }

  const refresh = async () => showData(await store.read());
  const change = (update: (current: CallerClass) => CallerClass) => {
    if (!list) return;
    void run(async () => {
      const saved = await store.change(list.id, update);
      setLists((old) =>
        old.map((entry) => (entry.id === saved.id ? saved : entry)),
      );
    });
  };

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const namesText = String(values.get("names") ?? "");
    const title = String(values.get("title") ?? "");
    void run(async () => {
      const parsed = namesText.trim()
        ? parseRosterImport(namesText, "list.txt")
        : null;
      await store.add(
        createCallerClass(title, parsed?.kind === "names" ? parsed.names : []),
      );
      await refresh();
      setCreating(false);
      setStatus("Đã lưu lớp trên thiết bị.");
    });
  }

  function importFile(file: File) {
    void run(async () => {
      if (file.size > MAX_CALLER_IMPORT_BYTES)
        throw new Error("Tệp danh sách vượt quá 500 KB.");
      const parsed = parseRosterImport(await file.text(), file.name);
      const next =
        parsed.kind === "class"
          ? importCallerClass(parsed.value)
          : createCallerClass(
              file.name.replace(/\.[^.]+$/, "").slice(0, MAX_CALLER_TITLE),
              parsed.names,
            );
      await store.add(next);
      await refresh();
      setCreating(false);
      setStatus("Đã nhập danh sách.");
    });
  }

  async function hosted(action: (signal: AbortSignal) => Promise<void>) {
    if (!navigator.onLine)
      throw new Error("Cần có mạng để lấy danh sách GroupHub.");
    hostedRequest.current?.abort();
    const controller = new AbortController();
    hostedRequest.current = controller;
    try {
      await action(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      throw new Error(classroomError(error));
    } finally {
      if (hostedRequest.current === controller) hostedRequest.current = null;
    }
  }

  function insert() {
    if (!list?.result) return;
    const result = list.result;
    const expected = insertionTarget(engine);
    void run(async () => {
      const receipt = await insertCallerResult(engine, {
        insertionId: result.id,
        expected,
        names: result.learners.map((learner) => learner.name),
      });
      setStatus(
        receipt.duplicate
          ? "Kết quả này đã được chèn."
          : "Đã lưu kết quả lên bảng.",
      );
    });
  }

  function close() {
    if (!operating.current) onClose();
  }

  return (
    <dialog
      className="context-panel context-panel-edge caller-panel"
      ref={dialog}
      aria-labelledby={titleId}
      lang="vi"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="context-panel-heading">
        <h2 id={titleId}>Gọi học sinh</h2>
        <button
          ref={closeButton}
          type="button"
          className="context-panel-close"
          title="Đóng bộ gọi"
          aria-label="Đóng bộ gọi"
          onClick={close}
          disabled={busy}
        >
          <Icon name="close" />
        </button>
      </header>

      {loading ? <p role="status">Đang đọc danh sách…</p> : null}
      {lists.length ? (
        <div className="caller-class-row">
          <label>
            Lớp trên thiết bị
            <select
              value={active ?? ""}
              disabled={!ready}
              onChange={(event) => {
                const id = event.target.value;
                void run(async () => {
                  await store.select(id);
                  await refresh();
                  setCreating(false);
                  setConfirming(null);
                });
              }}
            >
              {lists.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              setCreating(!creating);
              setConfirming(null);
            }}
          >
            {creating ? "Hủy tạo lớp" : "Tạo lớp"}
          </button>
        </div>
      ) : null}
      {creating && !loading ? (
        <form className="caller-create" onSubmit={create}>
          <label>
            Tên lớp
            <input
              ref={className}
              name="title"
              required
              maxLength={MAX_CALLER_TITLE * 2}
              disabled={!ready}
            />
          </label>
          <label>
            Danh sách tên
            <textarea
              name="names"
              rows={3}
              maxLength={30_000}
              disabled={!ready}
              placeholder="Mỗi học sinh một dòng"
            />
          </label>
          <button type="submit" className="primary" disabled={!ready}>
            Lưu lớp
          </button>
        </form>
      ) : null}

      {list && !creating ? (
        <>
          <div className="caller-draw">
            <p className="caller-remaining" role="status">
              Còn {remaining} / {list.learners.length} học sinh
            </p>
            <div className="caller-draw-actions">
              <label>
                Số học sinh mỗi lần gọi
                <select
                  value={list.drawCount}
                  disabled={!ready}
                  onChange={(event) => {
                    const count = Number(event.target.value);
                    if (isDrawCount(count))
                      change((current) => ({ ...current, drawCount: count }));
                  }}
                >
                  {[1, 2, 3, 4].map((count) => (
                    <option key={count}>{count}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="primary"
                disabled={!ready || remaining === 0}
                onClick={() =>
                  change((current) => drawLearners(current, current.drawCount))
                }
              >
                Gọi ngẫu nhiên
              </button>
            </div>
            {remaining === 0 && list.learners.length ? (
              <p className="caller-note">Đã gọi hết học sinh trong lượt này.</p>
            ) : null}
            {!list.learners.length ? (
              <p className="caller-note">
                Thêm tên trong phần chỉnh danh sách để bắt đầu.
              </p>
            ) : null}
            <section
              className="caller-result"
              aria-live="polite"
              aria-atomic="true"
            >
              {list.result ? (
                <>
                  <h3>Kết quả lần gọi</h3>
                  <ol aria-label="Học sinh được gọi">
                    {list.result.learners.map((learner) => (
                      <li key={learner.id}>{labelByIdentity(list, learner)}</li>
                    ))}
                  </ol>
                  {list.result.learners.length < list.result.requested ? (
                    <p className="caller-note">
                      Lần này chỉ gọi những học sinh còn lại.
                    </p>
                  ) : null}
                </>
              ) : null}
            </section>
            <div className="caller-result-actions">
              <button
                type="button"
                disabled={!ready || !list.cycle.usedIds.length}
                onClick={() => setConfirming("reset")}
              >
                Bắt đầu lượt mới
              </button>
              {list.result ? (
                <button
                  type="button"
                  disabled={!ready || readOnly}
                  onClick={insert}
                >
                  Chèn lên bảng
                </button>
              ) : null}
            </div>
            {confirming === "reset" ? (
              <div className="caller-confirm">
                <p>Tất cả học sinh trong lớp sẽ có thể được gọi lại.</p>
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => {
                    change((current) => resetCallerCycle(current));
                    setConfirming(null);
                  }}
                >
                  Xác nhận bắt đầu lượt mới
                </button>
                <button type="button" onClick={() => setConfirming(null)}>
                  Hủy
                </button>
              </div>
            ) : null}
          </div>

          <details className="caller-details" key={list.id}>
            <summary>Chỉnh danh sách</summary>
            <RosterEditor list={list} ready={ready} change={change} />
            <button
              type="button"
              disabled={!ready}
              onClick={() => setConfirming("delete")}
            >
              Xóa lớp
            </button>
            {confirming === "delete" ? (
              <div className="caller-confirm">
                <p>Xóa lớp {list.title} và lượt gọi đang lưu trên thiết bị?</p>
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() =>
                    void run(async () => {
                      await store.remove(list.id);
                      const data = await store.read();
                      showData(data);
                      setCreating(!data.active);
                      setConfirming(null);
                    })
                  }
                >
                  Xác nhận xóa lớp
                </button>
                <button type="button" onClick={() => setConfirming(null)}>
                  Hủy
                </button>
              </div>
            ) : null}
          </details>
        </>
      ) : null}

      <div className="caller-file-actions">
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".txt,.csv,.json"
          aria-label="Tệp danh sách"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) importFile(file);
          }}
        />
        <button
          type="button"
          disabled={!ready}
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="open" /> Nhập danh sách
        </button>
        {list ? (
          <button
            type="button"
            disabled={!ready}
            onClick={() => downloadClass(list)}
          >
            <Icon name="download" /> Xuất danh sách
          </button>
        ) : null}
      </div>

      {classroomEnabled ? (
        <details className="caller-details">
          <summary>Lấy danh sách từ GroupHub</summary>
          <p className="caller-note">
            Tải bản sao về thiết bị để tiếp tục gọi khi mất mạng.
          </p>
          <button
            type="button"
            disabled={!ready || !online}
            onClick={() =>
              void run(() =>
                hosted(async (signal) => {
                  const result = await classroomApi.rooms(signal);
                  setRooms(result.rooms);
                  setRoomId(result.rooms[0]?.id ?? "");
                }),
              )
            }
          >
            Tải danh sách phòng
          </button>
          {!online ? (
            <p className="caller-note">Kết nối mạng để lấy danh sách phòng.</p>
          ) : null}
          {rooms?.length ? (
            <div className="caller-hosted-row">
              <label>
                Phòng
                <select
                  disabled={!ready}
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value)}
                >
                  {rooms.map((room) => (
                    <option value={room.id} key={room.id}>
                      {room.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!ready || !online || !roomId}
                onClick={() =>
                  void run(() =>
                    hosted(async (signal) => {
                      const { room } = await classroomApi.room(roomId, signal);
                      await store.importHosted(room);
                      await refresh();
                      setCreating(false);
                      setStatus("Đã lưu danh sách phòng trên thiết bị.");
                    }),
                  )
                }
              >
                Dùng danh sách phòng
              </button>
            </div>
          ) : rooms ? (
            <p className="caller-note">Tài khoản này chưa có phòng.</p>
          ) : null}
        </details>
      ) : null}
      {busy ? <p role="status">Đang xử lý…</p> : null}
      {status ? (
        <p role="status" className="caller-status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="caller-error">
          {error}
        </p>
      ) : null}
    </dialog>
  );
}

function RosterEditor({
  list,
  ready,
  change,
}: {
  list: CallerClass;
  ready: boolean;
  change: (update: (current: CallerClass) => CallerClass) => void;
}) {
  const [adding, setAdding] = useState(false);
  const used = new Set(list.cycle.usedIds);
  return (
    <div className="caller-roster">
      <form
        className="caller-title-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = String(
            new FormData(event.currentTarget).get("title") ?? "",
          );
          change((current) => renameCallerClass(current, value));
        }}
      >
        <label>
          Tên lớp
          <input
            key={list.title}
            name="title"
            defaultValue={list.title}
            required
            maxLength={MAX_CALLER_TITLE * 2}
            disabled={!ready}
          />
        </label>
        <button type="submit" disabled={!ready}>
          Đổi tên lớp
        </button>
      </form>
      <ol aria-label="Danh sách học sinh">
        {list.learners.map((learner, index) => (
          <li key={learner.id} className="caller-learner">
            <span className="caller-ordinal" aria-hidden="true">
              {index + 1}
            </span>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = String(
                  new FormData(event.currentTarget).get("name") ?? "",
                );
                change((current) => editLearner(current, learner.id, value));
              }}
            >
              <input
                key={learner.name}
                name="name"
                aria-label={"Tên học sinh " + (index + 1)}
                defaultValue={learner.name}
                required
                maxLength={MAX_CALLER_NAME * 2}
                disabled={!ready}
              />
              <button
                type="submit"
                aria-label={"Lưu tên học sinh " + (index + 1)}
                title="Lưu tên"
                disabled={!ready}
              >
                <Icon name="check" />
              </button>
            </form>
            <span className="caller-mark">
              {used.has(learner.id) ? "Đã gọi" : "Chưa gọi"}
            </span>
            <div className="caller-row-actions">
              {([-1, 1] as const).map((direction) => {
                const label =
                  "Chuyển học sinh " +
                  (index + 1) +
                  (direction < 0 ? " lên" : " xuống");
                return (
                  <button
                    key={direction}
                    type="button"
                    aria-label={label}
                    title={label}
                    disabled={
                      !ready ||
                      index + direction < 0 ||
                      index + direction >= list.learners.length
                    }
                    onClick={() =>
                      change((current) =>
                        reorderLearner(
                          current,
                          learner.id,
                          current.learners.findIndex(
                            (entry) => entry.id === learner.id,
                          ) + direction,
                        ),
                      )
                    }
                  >
                    <Icon name={direction < 0 ? "up" : "down"} />
                  </button>
                );
              })}
              <button
                type="button"
                aria-label={"Xóa học sinh " + (index + 1)}
                title="Xóa học sinh"
                disabled={!ready}
                onClick={() =>
                  change((current) => removeLearner(current, learner.id))
                }
              >
                <Icon name="trash" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        disabled={!ready}
        onClick={() => setAdding(!adding)}
      >
        {adding ? "Hủy thêm tên" : "Thêm tên"}
      </button>
      {adding ? (
        <form
          className="caller-create"
          onSubmit={(event) => {
            event.preventDefault();
            const value = String(
              new FormData(event.currentTarget).get("names") ?? "",
            );
            change((current) => {
              const parsed = parseRosterImport(value, "list.txt");
              return parsed.kind === "names"
                ? appendNames(current, parsed.names)
                : current;
            });
          }}
        >
          <label>
            Danh sách tên
            <textarea
              name="names"
              rows={3}
              maxLength={30_000}
              required
              disabled={!ready}
              placeholder="Mỗi học sinh một dòng"
            />
          </label>
          <button type="submit" disabled={!ready}>
            Lưu tên mới
          </button>
        </form>
      ) : null}
    </div>
  );
}
