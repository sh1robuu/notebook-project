import { useCallback, useEffect, useRef, useState } from "react";
import {
  ClassroomError,
  classroomApi,
  classroomError,
} from "../../modules/classroom/api.ts";
import type {
  Entitlement,
  TeacherSession,
} from "../../modules/classroom/api.ts";
import { ClassroomDisclosure, ClassroomFrame } from "./ClassroomFrame.tsx";
import { TeacherRooms } from "./TeacherRooms.tsx";

type Account = Extract<TeacherSession, { teacher: object }>;
type SessionState =
  | { kind: "checking" | "signing-out" }
  | { kind: "ready"; session: TeacherSession }
  | { kind: "error"; message: string };

const entitlementText: Record<Entitlement, string> = {
  active: "Có quyền quản lý lớp",
  trial: "Đang dùng thử",
  expired: "Quyền quản lý đã hết hạn",
  suspended: "Quyền quản lý đang tạm dừng",
  unknown: "Chưa được cấp quyền quản lý lớp",
};

function authNotice() {
  const result = new URLSearchParams(location.search).get("auth");
  if (result === "cancelled") return "Bạn đã hủy đăng nhập Google.";
  if (result === "failed")
    return "Chưa xác nhận được đăng nhập Google. Hãy thử lại.";
  return "";
}

export function TeacherClassroom() {
  const [state, setState] = useState<SessionState>({ kind: "checking" });
  const [notice, setNotice] = useState(authNotice);
  const request = useRef<AbortController | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const announce = useRef(true);
  const revalidate = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: "checking" });
    void classroomApi
      .teacherSession(controller.signal)
      .then(
        (session) => {
          if (controller.signal.aborted) return;
          setState({ kind: "ready", session });
          if (announce.current) {
            announce.current = false;
            if (session.teacher)
              channel.current?.postMessage("session-changed");
          }
        },
        (error) => {
          if (!controller.signal.aborted)
            setState({ kind: "error", message: classroomError(error) });
        },
      )
      .finally(() => {
        if (request.current === controller) request.current = null;
      });
  }, []);

  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.has("auth")) {
      url.searchParams.delete("auth");
      history.replaceState(null, "", url);
    }
    try {
      channel.current = new BroadcastChannel("lessonboard-classroom-session");
      channel.current.onmessage = ({ data }) => {
        if (data === "session-changed") revalidate();
      };
    } catch {
      // Server revalidation remains authoritative when cross-tab messaging is unavailable.
    }
    const visible = () => {
      if (document.visibilityState === "visible" && !request.current)
        revalidate();
    };
    document.addEventListener("visibilitychange", visible);
    const refresh = setInterval(visible, 60_000);
    revalidate();
    return () => {
      request.current?.abort();
      request.current = null;
      channel.current?.close();
      clearInterval(refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [revalidate]);

  async function logout(session: Account) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: "signing-out" });
    setNotice("");
    try {
      await classroomApi.teacherLogout(session.csrfToken, controller.signal);
      if (!controller.signal.aborted) {
        channel.current?.postMessage("session-changed");
        setState({
          kind: "ready",
          session: { teacher: null, status: "signed-out" },
        });
        setNotice("Đã đăng xuất.");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ClassroomError && error.unauthorized) {
        revalidate();
        return;
      }
      setState({
        kind: "error",
        message:
          "Chưa xác nhận được việc đăng xuất. Kiểm tra lại phiên của bạn.",
      });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  const session = state.kind === "ready" ? state.session : undefined;
  const account = session?.teacher && (
    <ClassroomDisclosure
      className="classroom-account classroom-private"
      label={<span>{session.teacher.displayName}</span>}
      accessibleName={"Tài khoản giáo viên " + session.teacher.displayName}
    >
      <div>
        <strong>{session.teacher.displayName}</strong>
        {session.teacher.email && <p>{session.teacher.email}</p>}
        <p>{entitlementText[session.teacher.entitlement]}</p>
        <button type="button" onClick={() => void logout(session)}>
          Đăng xuất
        </button>
      </div>
    </ClassroomDisclosure>
  );
  return (
    <ClassroomFrame account={account}>
      {(state.kind === "checking" || state.kind === "signing-out") && (
        <p className="classroom-auth classroom-muted" role="status">
          {state.kind === "checking"
            ? "Đang kiểm tra phiên giáo viên…"
            : "Đang đăng xuất…"}
        </p>
      )}
      {state.kind === "error" && (
        <div className="classroom-panel classroom-auth">
          <h2>Chưa mở được GroupHub</h2>
          <p role="alert">{state.message}</p>
          <button type="button" onClick={revalidate}>
            Kiểm tra lại phiên
          </button>
          <p>Bạn vẫn có thể mở bảng giảng cá nhân.</p>
        </div>
      )}
      {session && !session.teacher && (
        <section className="classroom-panel classroom-auth">
          <h2>Đăng nhập giáo viên</h2>
          <p>Tạo phòng, chia nhóm và mời học sinh bằng mã QR.</p>
          {notice && <p role="status">{notice}</p>}
          {(session.status === "expired" || session.status === "revoked") && (
            <p role="alert">Phiên đăng nhập đã kết thúc. Hãy đăng nhập lại.</p>
          )}
          <a
            className="classroom-button classroom-primary"
            href={classroomApi.googleSignIn}
          >
            Đăng nhập bằng Google
          </a>
          <p className="classroom-muted">
            Bài giảng cá nhân lưu trong trình duyệt. Đăng nhập GroupHub không
            gửi bài giảng vào phòng.
          </p>
          <a href="/join">Tôi có mã mời của giáo viên</a>
        </section>
      )}
      {session?.teacher &&
        (session.teacher.entitlement === "active" ? (
          <TeacherRooms
            key={session.teacher.id}
            csrfToken={session.csrfToken}
            accessLost={revalidate}
          />
        ) : (
          <section className="classroom-panel classroom-auth classroom-private">
            <h2>Quyền quản lý lớp</h2>
            <p role="status">{entitlementText[session.teacher.entitlement]}.</p>
            <p>Bạn vẫn có thể mở bảng giảng cá nhân và tải bài đã lưu.</p>
            <button type="button" onClick={revalidate}>
              Kiểm tra lại quyền
            </button>
          </section>
        ))}
    </ClassroomFrame>
  );
}
