import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ClassroomError,
  classroomApi,
  classroomError,
  invitationCode,
  invitationFromLocation,
} from "../../modules/classroom/api.ts";
import type { ParticipantRoom } from "../../modules/classroom/api.ts";
import {
  useCommittedCommand,
  useLiveRoom,
} from "../../modules/classroom/state.ts";
import {
  ClassroomFrame,
  CommandNotice,
  RoomConnectionStatus,
  roomMode,
  roomState,
} from "./ClassroomFrame.tsx";

type State =
  | { kind: "checking" }
  | { kind: "form"; note?: string }
  | { kind: "joined"; room: ParticipantRoom }
  | { kind: "error"; message: string };

export function StudentJoin() {
  const [code] = useState(() => invitationFromLocation(location.hash));
  const [state, setState] = useState<State>(
    code ? { kind: "form" } : { kind: "checking" },
  );
  const request = useRef<AbortController | null>(null);
  const check = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: "checking" });
    void classroomApi.participantRoom(controller.signal).then(
      ({ room }) => {
        if (!controller.signal.aborted) setState({ kind: "joined", room });
      },
      (error) => {
        if (controller.signal.aborted) return;
        if (
          error instanceof ClassroomError &&
          (error.unauthorized || error.status === 404)
        )
          setState({ kind: "form" });
        else setState({ kind: "error", message: classroomError(error) });
      },
    );
  }, []);
  useEffect(() => {
    if (location.hash.startsWith("#code="))
      history.replaceState(null, "", "/join");
    if (!code) check();
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("lessonboard-classroom-session");
      channel.onmessage = ({ data }) => {
        if (data === "session-changed") check();
      };
    } catch {
      // Visibility checks still verify the server session before showing an old view.
    }
    const visible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      request.current?.abort();
      channel?.close();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [check, code]);
  const expired = useCallback(() => {
    setState({
      kind: "form",
      note: "Phiên học sinh đã hết hoặc bị thu hồi. Hãy xin giáo viên mã mời để vào lại.",
    });
  }, []);
  return (
    <ClassroomFrame student>
      <div className="classroom-join">
        <div className="classroom-title">
          <h1>Tham gia lớp học</h1>
        </div>
        {state.kind === "checking" && (
          <p role="status">Đang kiểm tra phiên tham gia…</p>
        )}
        {state.kind === "error" && (
          <section className="classroom-panel">
            <h2>Chưa mở được phòng</h2>
            <p role="alert">{state.message}</p>
            <div className="classroom-actions">
              <button type="button" onClick={check}>
                Kiểm tra lại
              </button>
              <button type="button" onClick={() => setState({ kind: "form" })}>
                Nhập mã mời
              </button>
            </div>
          </section>
        )}
        {state.kind === "form" && (
          <JoinForm
            initialCode={code}
            note={state.note}
            onJoined={(room) => setState({ kind: "joined", room })}
          />
        )}
        {state.kind === "joined" && (
          <StudentRoom
            key={state.room.self.id}
            initial={state.room}
            expired={expired}
            changeRoom={() => setState({ kind: "form" })}
          />
        )}
      </div>
    </ClassroomFrame>
  );
}

function JoinForm({
  initialCode,
  note,
  onJoined,
}: {
  initialCode: string;
  note?: string;
  onJoined: (room: ParticipantRoom) => void;
}) {
  const mutation = useCommittedCommand(() => {}, "join");
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = invitationCode(String(form.get("code") ?? ""));
    const displayName = String(form.get("name") ?? "").trim();
    if (!code || !displayName) {
      setError("Nhập tên hiển thị và mã mời giáo viên đã gửi.");
      return;
    }
    setError("");
    mutation.run(async (key, signal) => {
      const { room } = await classroomApi.join(
        { code, displayName },
        key,
        signal,
      );
      if (!signal.aborted) onJoined(room);
    });
  }
  return (
    <section className="classroom-panel classroom-join-panel">
      <h2>Mã mời của giáo viên</h2>
      <p>Nhập mã mời và tên giáo viên sẽ thấy trong danh sách lớp.</p>
      {note && <p role="alert">{note}</p>}
      <form className="classroom-form" onSubmit={submit}>
        <label>
          Mã mời
          <input
            name="code"
            defaultValue={initialCode}
            maxLength={128}
            required
            disabled={mutation.busy}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <label>
          Tên hiển thị
          <input
            name="name"
            maxLength={80}
            required
            disabled={mutation.busy}
            autoComplete="off"
          />
        </label>
        <button
          className="classroom-primary"
          type="submit"
          disabled={mutation.busy}
        >
          Vào phòng
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <CommandNotice
        {...mutation}
        retry={mutation.canRetry ? mutation.retry : undefined}
      />
      <p className="classroom-muted">
        Bạn không cần tài khoản Google để tham gia.
      </p>
    </section>
  );
}

function StudentRoom({
  initial,
  expired,
  changeRoom,
}: {
  initial: ParticipantRoom;
  expired: () => void;
  changeRoom: () => void;
}) {
  const live = useLiveRoom(
    classroomApi.participantRoom,
    "/participant/events",
    expired,
    initial,
  );
  const room = live.room;
  if (!room) return null;
  return (
    <section className="classroom-panel classroom-join-panel classroom-private">
      <div className="classroom-section-heading">
        <h2>{room.title}</h2>
        <RoomConnectionStatus state={live.connection} />
      </div>
      <dl className="classroom-student-details">
        <div>
          <dt>Tên của bạn</dt>
          <dd>{room.self.displayName}</dd>
        </div>
        <div>
          <dt>Hình thức</dt>
          <dd>{roomMode[room.mode]}</dd>
        </div>
        <div>
          <dt>Trạng thái phòng</dt>
          <dd>{roomState[room.state]}</dd>
        </div>
        <div>
          <dt>Nhóm của bạn</dt>
          <dd>{room.self.group?.name ?? "Chưa vào nhóm"}</dd>
        </div>
      </dl>
      {live.error && (
        <div className="classroom-notice">
          <p role="alert">{live.error} Đang hiện dữ liệu gần nhất.</p>
          <button
            type="button"
            onClick={live.refresh}
            disabled={live.refreshing}
          >
            Tải lại trạng thái
          </button>
        </div>
      )}
      <button type="button" onClick={changeRoom}>
        Vào phòng khác
      </button>
    </section>
  );
}
