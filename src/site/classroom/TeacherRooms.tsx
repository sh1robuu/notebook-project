import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../../app/Icon.tsx";
import {
  ClassroomError,
  classroomApi,
  classroomError,
} from "../../modules/classroom/api.ts";
import type {
  Room,
  RoomInput,
  RoomSummary,
} from "../../modules/classroom/api.ts";
import { useCommittedCommand } from "../../modules/classroom/state.ts";
import { CommandNotice, roomState } from "./ClassroomFrame.tsx";
import { RoomDetail } from "./RoomDetail.tsx";
import { RoomFields } from "./RoomFields.tsx";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function roomInUrl() {
  const id = new URLSearchParams(location.search).get("room");
  return id && uuid.test(id) ? id : null;
}

export function TeacherRooms({
  csrfToken,
  accessLost,
}: {
  csrfToken: string;
  accessLost: () => void;
}) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [roomId, setRoomId] = useState(roomInUrl);
  const [creating, setCreating] = useState(false);
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);
  const roomMenu = useId();
  const switcher = useRef<HTMLButtonElement>(null);
  const [reload, setReload] = useState(0);
  const [loadError, setLoadError] = useState("");
  const creation = useCommittedCommand(accessLost);
  useEffect(() => {
    const request = new AbortController();
    void classroomApi.rooms(request.signal).then(
      ({ rooms }) => {
        if (!request.signal.aborted) {
          setRooms(rooms);
          setLoadError("");
        }
      },
      (error) => {
        if (request.signal.aborted) return;
        if (error instanceof ClassroomError && error.unauthorized) accessLost();
        else setLoadError(classroomError(error));
      },
    );
    return () => request.abort();
  }, [accessLost, reload]);

  function select(id: string) {
    setRoomId(id);
    const url = new URL(location.href);
    url.searchParams.set("room", id);
    history.replaceState(null, "", url);
  }

  function closeRoomMenu() {
    setRoomMenuOpen(false);
    switcher.current?.focus();
  }

  const summarize = useCallback((room: Room) => {
    setRooms(
      (items) =>
        items?.map((item) =>
          item.id === room.id && item.revision < room.revision
            ? {
                id: room.id,
                title: room.title,
                mode: room.mode,
                state: room.state,
                revision: room.revision,
                createdAt: room.createdAt,
                updatedAt: room.updatedAt,
              }
            : item,
        ) ?? null,
    );
  }, []);

  function create(values: RoomInput) {
    creation.run(async (key, signal) => {
      const { room } = await classroomApi.createRoom(
        values,
        csrfToken,
        key,
        signal,
      );
      if (signal.aborted) return;
      setRooms((items) => [
        room,
        ...(items ?? []).filter((item) => item.id !== room.id),
      ]);
      select(room.id);
      setCreating(false);
    });
  }

  return (
    <div className="classroom-grid classroom-private">
      <aside
        className="classroom-room-list"
        aria-labelledby="classroom-rooms"
        onKeyDown={(event) => {
          if (event.key === "Escape" && roomMenuOpen) {
            event.preventDefault();
            closeRoomMenu();
          }
        }}
      >
        <div className="classroom-rail-heading">
          <h2 id="classroom-rooms">Phòng của tôi</h2>
          {roomId && !loadError && !!rooms?.length && (
            <button
              ref={switcher}
              type="button"
              className="classroom-room-switch"
              aria-controls={roomMenu}
              aria-expanded={roomMenuOpen}
              onClick={() => setRoomMenuOpen((open) => !open)}
            >
              Đổi phòng
            </button>
          )}
          <button
            type="button"
            aria-expanded={creating}
            disabled={creation.busy}
            onClick={() => setCreating((open) => !open)}
          >
            <Icon name={creating ? "close" : "plus"} />
            {creating ? "Đóng biểu mẫu" : "Tạo phòng"}
          </button>
        </div>
        {creating && (
          <RoomFields
            initial={{ title: "", mode: "individual" }}
            submit={create}
            disabled={creation.busy}
            label="Lưu phòng mới"
          />
        )}
        <CommandNotice
          error={creation.error}
          busy={creation.busy}
          retry={creation.canRetry ? creation.retry : undefined}
        />
        {loadError ? (
          <div className="classroom-notice">
            <p role="alert">{loadError}</p>
            <button
              type="button"
              onClick={() => setReload((version) => version + 1)}
            >
              Tải lại danh sách
            </button>
          </div>
        ) : rooms === null ? (
          <p role="status">Đang tải phòng…</p>
        ) : rooms.length === 0 ? (
          <p className="classroom-muted">Chưa có phòng nào.</p>
        ) : (
          <ul
            className="classroom-room-menu"
            id={roomMenu}
            data-folded={roomId && !roomMenuOpen ? "" : undefined}
          >
            {rooms.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  aria-pressed={room.id === roomId}
                  onClick={() => {
                    select(room.id);
                    if (roomMenuOpen) closeRoomMenu();
                  }}
                >
                  <span>{room.title}</span>
                  <small>{roomState[room.state]}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      {roomId ? (
        <RoomDetail
          key={roomId}
          roomId={roomId}
          csrfToken={csrfToken}
          accessLost={accessLost}
          summarize={summarize}
        />
      ) : (
        <section className="classroom-panel classroom-empty">
          <h2>
            {rooms?.length ? "Chọn phòng để tiếp tục" : "Bắt đầu một buổi học"}
          </h2>
          <p>
            {rooms?.length
              ? "Mở một phòng để xem danh sách học sinh, nhóm và mã mời."
              : "Tạo phòng mới, sau đó mở phòng để mời học sinh tham gia."}
          </p>
        </section>
      )}
    </div>
  );
}
