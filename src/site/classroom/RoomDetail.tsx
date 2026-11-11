import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  classroomApi,
  invitationLink,
  roomPath,
} from "../../modules/classroom/api.ts";
import type {
  Room,
  RoomCommand,
  RoomState,
} from "../../modules/classroom/api.ts";
import {
  useCommittedCommand,
  useLiveRoom,
} from "../../modules/classroom/state.ts";
import {
  ClassroomDisclosure,
  CommandNotice,
  RoomConnectionStatus,
  roomMode,
  roomState,
} from "./ClassroomFrame.tsx";
import { RoomFields } from "./RoomFields.tsx";
import { Roster, RoomGroups } from "./RoomRoster.tsx";

export type Confirmation = {
  heading: string;
  detail: string;
  label: string;
  command: RoomCommand;
};
type RoomAction = (command: RoomCommand) => void;
type ConfirmAction = (action: Confirmation) => void;

const endRoom: Confirmation = {
  heading: "Kết thúc phòng?",
  detail: "Mã mời sẽ ngừng hoạt động. Danh sách học sinh và nhóm được giữ lại.",
  label: "Kết thúc phòng",
  command: { type: "end" },
};
const archiveRoom: Confirmation = {
  heading: "Lưu trữ phòng?",
  detail: "Phòng đã lưu trữ sẽ không mở lại được từ GroupHub.",
  label: "Lưu trữ phòng",
  command: { type: "archive" },
};

export function RoomDetail({
  roomId,
  csrfToken,
  accessLost,
  summarize,
}: {
  roomId: string;
  csrfToken: string;
  accessLost: () => void;
  summarize: (room: Room) => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => classroomApi.room(roomId, signal),
    [roomId],
  );
  const live = useLiveRoom(load, roomPath(roomId) + "/events", accessLost);
  const mutation = useCommittedCommand(accessLost);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const room = live.room;
  useEffect(() => {
    if (room) summarize(room);
  }, [room, summarize]);
  const command: RoomAction = (value) => {
    mutation.run(async (key, signal) => {
      const { room } = await classroomApi.command(
        roomId,
        value,
        csrfToken,
        key,
        signal,
      );
      if (!signal.aborted) live.apply(room);
    });
  };
  if (!room) {
    return (
      <section className="classroom-panel classroom-empty">
        <h2>Phòng học</h2>
        {live.error ? (
          <>
            <p role="alert">{live.error}</p>
            <button
              type="button"
              onClick={live.refresh}
              disabled={live.refreshing}
            >
              Tải lại phòng
            </button>
          </>
        ) : (
          <p role="status">Đang tải phòng…</p>
        )}
      </section>
    );
  }
  const editable = room.state !== "ended" && room.state !== "archived";
  return (
    <section className="classroom-room" aria-labelledby="classroom-room-title">
      <div className="classroom-panel classroom-room-heading">
        <div className="classroom-room-bar">
          <div className="classroom-room-caption">
            <h2 id="classroom-room-title">{room.title}</h2>
            <div className="classroom-room-meta">
              <p className="classroom-muted">
                {roomState[room.state]} · {roomMode[room.mode]}
              </p>
              <RoomConnectionStatus state={live.connection} />
            </div>
          </div>
          <RoomControls
            state={room.state}
            act={command}
            confirm={setConfirmation}
            disabled={mutation.busy}
          />
        </div>
        <div className="classroom-room-links">
          {room.state === "open" && (
            <a className="classroom-quick-invite" href="#classroom-invitation">
              Đến mã mời
            </a>
          )}
          {editable && (
            <ClassroomDisclosure
              className="classroom-settings"
              label="Cài đặt phòng"
            >
              <RoomFields
                key={room.title + "\0" + room.mode}
                initial={room}
                label="Lưu cài đặt"
                submit={(values) => command({ type: "configure", ...values })}
                disabled={mutation.busy}
              />
            </ClassroomDisclosure>
          )}
        </div>
        <CommandNotice
          {...mutation}
          retry={mutation.canRetry ? mutation.retry : undefined}
        />
        {live.error && (
          <div className="classroom-notice">
            <p role="alert">{live.error} Đang hiện dữ liệu gần nhất.</p>
            <button
              type="button"
              onClick={live.refresh}
              disabled={live.refreshing}
            >
              Tải lại phòng
            </button>
          </div>
        )}
      </div>
      <div className="classroom-room-content">
        <Roster
          room={room}
          act={command}
          confirm={setConfirmation}
          disabled={!editable || mutation.busy}
        />
        <div className="classroom-side">
          <Invitations room={room} act={command} disabled={mutation.busy} />
          <RoomGroups
            room={room}
            act={command}
            confirm={setConfirmation}
            disabled={!editable || mutation.busy}
          />
        </div>
      </div>
      {confirmation && (
        <ConfirmRoomCommand
          action={confirmation}
          cancel={() => setConfirmation(null)}
          submit={() => {
            setConfirmation(null);
            command(confirmation.command);
          }}
        />
      )}
    </section>
  );
}

function RoomControls({
  state,
  act,
  confirm,
  disabled,
}: {
  state: RoomState;
  act: RoomAction;
  confirm: ConfirmAction;
  disabled: boolean;
}) {
  const next =
    state === "draft"
      ? (["open", "Mở phòng"] as const)
      : state === "open"
        ? (["lock", "Khóa tham gia"] as const)
        : state === "locked"
          ? (["unlock", "Mở khóa tham gia"] as const)
          : state === "ended"
            ? (["reopen", "Mở lại phòng"] as const)
            : null;
  if (!next) return null;
  return (
    <div className="classroom-actions">
      <button
        type="button"
        className={
          state === "draft" || state === "ended"
            ? "classroom-primary"
            : undefined
        }
        disabled={disabled}
        onClick={() => act({ type: next[0] })}
      >
        {next[1]}
      </button>
      {(state === "open" || state === "locked") && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => confirm(endRoom)}
        >
          {endRoom.label}
        </button>
      )}
      {state === "ended" && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => confirm(archiveRoom)}
        >
          {archiveRoom.label}
        </button>
      )}
    </div>
  );
}

function ConfirmRoomCommand({
  action,
  cancel,
  submit,
}: {
  action: Confirmation;
  cancel: () => void;
  submit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const current = dialog.current;
    current?.showModal();
    return () => current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <h3 id={title}>{action.heading}</h3>
      <p>{action.detail}</p>
      <div className="classroom-actions">
        <button type="button" autoFocus onClick={cancel}>
          Quay lại
        </button>
        <button type="button" className="classroom-danger" onClick={submit}>
          {action.label}
        </button>
      </div>
    </dialog>
  );
}

function Invitations({
  room,
  act,
  disabled,
}: {
  room: Room;
  act: RoomAction;
  disabled: boolean;
}) {
  const heading = useId();
  const invitation = room.state === "open" ? room.invitation : null;
  return (
    <section
      className="classroom-panel classroom-invitation"
      aria-labelledby={heading}
      id="classroom-invitation"
      tabIndex={-1}
    >
      <h3 id={heading}>Mời học sinh</h3>
      {invitation ? (
        <InvitationCode key={invitation.code} invite={invitation} />
      ) : (
        <p className="classroom-muted">
          {room.state === "open"
            ? "Tạo mã để học sinh vào phòng."
            : "Mã mời chỉ hoạt động khi phòng nhận người tham gia."}
        </p>
      )}
      {room.state === "open" && (
        <div className="classroom-actions">
          <button
            type="button"
            className={invitation ? undefined : "classroom-primary"}
            disabled={disabled}
            onClick={() => act({ type: "rotateInvitation" })}
          >
            {invitation ? "Đổi mã mời" : "Tạo mã mời"}
          </button>
          {invitation && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => act({ type: "revokeInvitation" })}
            >
              Thu hồi mã
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function InvitationCode({
  invite,
}: {
  invite: NonNullable<Room["invitation"]>;
}) {
  const link = invitationLink(location.origin, invite.code);
  const expiry = Date.parse(invite.expiresAt);
  const [expired, setExpired] = useState(() => expiry <= Date.now());
  const [qr, setQr] = useState("");
  const [qrError, setQrError] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const linkInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (expired) return;
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, expiry - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expired, expiry]);
  useEffect(() => {
    if (expired) return;
    let stale = false;
    void import("qrcode")
      .then(({ default: qrcode }) =>
        qrcode.toDataURL(link, { width: 256, margin: 4 }),
      )
      .then(
        (image) => {
          if (!stale) setQr(image);
        },
        () => {
          if (!stale) setQrError(true);
        },
      );
    return () => {
      stale = true;
    };
  }, [expired, link]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopyStatus("Đã sao chép liên kết.");
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setCopyStatus("Chọn và sao chép liên kết bằng bàn phím.");
    }
  }
  if (expired)
    return (
      <p role="status">Mã đã hết hạn. Tạo mã mới để tiếp tục nhận học sinh.</p>
    );
  return (
    <div className="classroom-qr">
      {qr ? (
        <img src={qr} width={192} height={192} alt="Mã QR tham gia phòng" />
      ) : qrError ? (
        <p role="status">
          Chưa tạo được QR. Bạn vẫn có thể chia sẻ liên kết hoặc mã mời.
        </p>
      ) : (
        <p role="status">Đang tạo mã QR…</p>
      )}
      <p className="classroom-code">
        <span>Mã mời</span>
        <code>{invite.code}</code>
      </p>
      {Number.isFinite(expiry) && (
        <p className="classroom-muted">
          Hết hạn{" "}
          <time dateTime={invite.expiresAt}>
            {new Date(expiry).toLocaleString("vi-VN")}
          </time>
        </p>
      )}
      <label>
        Liên kết tham gia
        <input ref={linkInput} readOnly value={link} />
      </label>
      <button type="button" onClick={() => void copy()}>
        Sao chép liên kết
      </button>
      {copyStatus && <p role="status">{copyStatus}</p>}
    </div>
  );
}
