import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BoardEngine } from "../../modules/board/engine.ts";
import {
  ClassroomError,
  classroomApi,
  classroomError,
  roomPath,
} from "../../modules/classroom/api.ts";
import type { RoomSummary } from "../../modules/classroom/api.ts";
import {
  insertionTarget,
  insertClassroomSnapshot,
} from "../../modules/classroom/board-insertion.ts";
import { useLiveRoom } from "../../modules/classroom/state.ts";
import TeacherParticipation from "../../site/classroom/TeacherParticipation.tsx";
import type {
  BoardDestination,
  ParticipationSection,
} from "../../site/classroom/TeacherParticipation.tsx";
import { RoomConnectionStatus } from "../../site/classroom/ClassroomFrame.tsx";
import "../../site/classroom/classroom.css";

type Session = { csrfToken: string; rooms: RoomSummary[] };

export default function ClassroomDialog({
  engine,
  section,
  roomId,
  close,
}: {
  engine: BoardEngine;
  section: ParticipationSection;
  roomId?: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [session, setSession] = useState<Session>();
  const [selection, setSelection] = useState(roomId ?? "");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const closeRef = useRef(close);
  closeRef.current = close;
  const [board] = useState<BoardDestination>(() => {
    const target = insertionTarget(engine);
    const page = engine.pages.editor.getCurrentPage();
    const title = engine.getSnapshot().title.trim();
    return {
      target,
      label:
        (title || "Bài giảng chưa đặt tên") +
        " · " +
        (engine.surface === "scratchpad" ? "Bảng nháp" : page.name),
      save: async (insertion, file) => {
        const result = await insertClassroomSnapshot(engine, {
          insertionId: insertion.id,
          expected: target,
          file,
        });
        return result.revision;
      },
    };
  });
  useEffect(() => {
    const element = dialog.current;
    if (!element?.open) element?.showModal();
    const conceal = () => {
      if (element?.open) element.close();
      closeRef.current();
    };
    window.addEventListener("pagehide", conceal);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("lessonboard-classroom-session");
      channel.onmessage = ({ data }) => {
        if (data === "session-changed") conceal();
      };
    } catch {
      // Room authorization still follows the server session.
    }
    return () => {
      window.removeEventListener("pagehide", conceal);
      channel?.close();
      if (element?.open) element.close();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const current = await classroomApi.teacherSession(controller.signal);
      if (!current.teacher)
        throw new Error("Đăng nhập GroupHub để mở hoạt động của lớp.");
      if (
        current.teacher.entitlement !== "active" &&
        current.teacher.entitlement !== "trial"
      )
        throw new Error("Tài khoản chưa được cấp quyền quản lý lớp.");
      const { rooms } = await classroomApi.rooms(controller.signal);
      if (controller.signal.aborted) return;
      setSession({
        csrfToken: current.csrfToken,
        rooms: rooms.filter((room) => room.state !== "archived"),
      });
      setSelection((old) =>
        rooms.some((room) => room.id === old && room.state !== "archived")
          ? old
          : "",
      );
    };
    void load()
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof ClassroomError
              ? classroomError(failure)
              : failure instanceof Error
                ? failure.message
                : classroomError(failure),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  const denied = useCallback(() => {
    setSession(undefined);
    setError("Phiên đã hết hạn hoặc bạn không còn quyền mở phòng này.");
  }, []);
  function reload() {
    setError("");
    setLoading(true);
    setAttempt((value) => value + 1);
  }

  return createPortal(
    <dialog
      ref={dialog}
      className="classroom participation-board-dialog"
      aria-labelledby={heading}
      lang="vi"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="participation-heading">
        <h2 id={heading}>Hoạt động lớp học</h2>
        <button type="button" onClick={close} autoFocus>
          Đóng
        </button>
      </header>
      {loading && <p role="status">Đang tìm phòng học…</p>}
      {error && (
        <div className="classroom-notice">
          <p role="alert">{error}</p>
          <div className="classroom-actions">
            <a href="/classroom" target="_blank" rel="noopener noreferrer">
              Mở GroupHub
            </a>
            <button type="button" onClick={reload}>
              Thử lại
            </button>
          </div>
        </div>
      )}
      {session && (
        <>
          <p className="classroom-muted">
            Trang đích <strong>{board.label}</strong>
          </p>
          <div className="participation-heading">
            <label htmlFor={heading + "-room"}>Phòng học</label>
            <select
              id={heading + "-room"}
              value={selection}
              onChange={(event) => setSelection(event.target.value)}
            >
              <option value="">Chọn phòng học</option>
              {session.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.title}
                </option>
              ))}
            </select>
          </div>
          {!session.rooms.length && (
            <p>
              <a href="/classroom" target="_blank" rel="noopener noreferrer">
                Tạo phòng trong GroupHub
              </a>
            </p>
          )}
          {selection && (
            <BoardRoom
              key={selection}
              id={selection}
              csrfToken={session.csrfToken}
              board={board}
              section={section}
              denied={denied}
            />
          )}
        </>
      )}
    </dialog>,
    document.body,
  );
}

function BoardRoom({
  id,
  csrfToken,
  board,
  section,
  denied,
}: {
  id: string;
  csrfToken: string;
  board: BoardDestination;
  section: ParticipationSection;
  denied: () => void;
}) {
  const read = useCallback(
    (signal: AbortSignal) => classroomApi.room(id, signal),
    [id],
  );
  const live = useLiveRoom(read, roomPath(id) + "/events", denied);
  return (
    <>
      <RoomConnectionStatus state={live.connection} />
      {live.error && (
        <div className="classroom-notice">
          <p role="alert">{live.error}</p>
          <button type="button" onClick={live.refresh}>
            Tải lại phòng
          </button>
        </div>
      )}
      {live.room && (
        <TeacherParticipation
          room={live.room}
          csrfToken={csrfToken}
          onDenied={denied}
          initial={section}
          board={board}
        />
      )}
    </>
  );
}
