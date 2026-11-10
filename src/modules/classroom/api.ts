export const classroomApiPrefix = "/api/classroom";

export type Entitlement =
  "active" | "trial" | "expired" | "suspended" | "unknown";
export type Teacher = {
  id: string;
  displayName: string;
  email?: string;
  entitlement: Entitlement;
};
export type TeacherSession =
  | { teacher: Teacher; csrfToken: string; status?: "active" }
  | { teacher: null; status?: "signed-out" | "expired" | "revoked" };

export type RoomMode = "individual" | "group";
export type RoomState = "draft" | "open" | "locked" | "ended" | "archived";
export type RoomInput = { title: string; mode: RoomMode };
export type RoomSummary = RoomInput & {
  id: string;
  state: RoomState;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type Group = { id: string; name: string };
export type Participant = {
  id: string;
  displayName: string;
  position: number;
  groupId: string | null;
  joinedAt: string;
};
export type Room = RoomSummary & {
  participants: Participant[];
  groups: Group[];
  invitation: { code: string; expiresAt: string } | null;
};
export type ParticipantRoom = Pick<
  RoomSummary,
  "id" | "title" | "mode" | "state" | "revision"
> & {
  self: { id: string; displayName: string; group: Group | null };
};
export type RoomCommand =
  | {
      type:
        | "open"
        | "lock"
        | "unlock"
        | "end"
        | "reopen"
        | "archive"
        | "rotateInvitation"
        | "revokeInvitation";
    }
  | ({ type: "configure" } & RoomInput)
  | { type: "renameParticipant"; participantId: string; displayName: string }
  | { type: "removeParticipant"; participantId: string }
  | { type: "reorderParticipants"; participantIds: string[] }
  | { type: "assignGroup"; participantId: string; groupId: string | null }
  | { type: "createGroup"; name: string }
  | { type: "renameGroup"; groupId: string; name: string }
  | { type: "deleteGroup"; groupId: string };

export class ClassroomError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
  get unauthorized() {
    return this.status === 401 || this.status === 403;
  }
}

type RequestOptions = {
  signal?: AbortSignal;
  body?: unknown;
  csrfToken?: string;
  key?: string;
};

async function request<T>(
  path: string,
  { signal, body, csrfToken, key }: RequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (csrfToken) headers.set("x-classroom-csrf", csrfToken);
  if (key) headers.set("Idempotency-Key", key);
  const timeout = AbortSignal.timeout(18_000);
  let response: Response;
  try {
    response = await fetch(classroomApiPrefix + path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      credentials: "same-origin",
      mode: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ClassroomError(0, "network");
  }
  if (response.status === 204) return undefined as T;
  const content: unknown = await response.json().catch(() => null);
  if (!response.ok || !content || typeof content !== "object") {
    const code =
      content &&
      typeof content === "object" &&
      "error" in content &&
      typeof content.error === "string"
        ? content.error
        : "unavailable";
    throw new ClassroomError(response.ok ? 502 : response.status, code);
  }
  return content as T;
}

export function roomPath(id: string) {
  return "/rooms/" + encodeURIComponent(id);
}

export const classroomApi = {
  googleSignIn: classroomApiPrefix + "/auth/google",
  teacherSession: (signal?: AbortSignal) =>
    request<TeacherSession>("/auth/session", { signal }),
  teacherLogout: (csrfToken: string, signal?: AbortSignal) =>
    request<void>("/auth/logout", { body: {}, csrfToken, signal }),
  rooms: (signal?: AbortSignal) =>
    request<{ rooms: RoomSummary[] }>("/rooms", { signal }),
  room: (id: string, signal?: AbortSignal) =>
    request<{ room: Room }>(roomPath(id), { signal }),
  createRoom: (
    body: RoomInput,
    csrfToken: string,
    key: string,
    signal?: AbortSignal,
  ) =>
    request<{ room: RoomSummary }>("/rooms", { body, csrfToken, key, signal }),
  command: (
    id: string,
    body: RoomCommand,
    csrfToken: string,
    key: string,
    signal?: AbortSignal,
  ) =>
    request<{ room: Room; receipt: { revision: number } }>(
      roomPath(id) + "/commands",
      { body, csrfToken, key, signal },
    ),
  join: (
    body: { code: string; displayName: string },
    key: string,
    signal?: AbortSignal,
  ) => request<{ room: ParticipantRoom }>("/join", { body, key, signal }),
  participantRoom: (signal?: AbortSignal) =>
    request<{ room: ParticipantRoom }>("/participant/room", { signal }),
};

export function invitationCode(input: string) {
  const code = input.trim();
  return /^[A-Za-z0-9_-]{12,128}$/.test(code) ? code : "";
}

export function invitationFromLocation(hash: string) {
  const codes = new URLSearchParams(hash.slice(1)).getAll("code");
  return codes.length === 1 ? invitationCode(codes[0]) : "";
}

export function invitationLink(origin: string, code: string) {
  const url = new URL("/join", origin);
  url.hash = new URLSearchParams({ code }).toString();
  return url.href;
}

export function classroomError(
  error: unknown,
  operation: "join" | "other" = "other",
): string {
  if (error instanceof ClassroomError) {
    if (error.status === 429)
      return "Có quá nhiều yêu cầu. Đợi một lúc rồi thử lại.";
    if (error.status === 0)
      return "Không kết nối được với GroupHub. Kiểm tra mạng rồi thử lại.";
    if (
      operation === "join" &&
      [400, 403, 404, 409, 410, 423].includes(error.status)
    )
      return "Chưa thể vào phòng. Kiểm tra tên và mã mời, hoặc xin giáo viên mã mới.";
    if (error.status === 401)
      return "Phiên đã hết hoặc bị thu hồi. Hãy kết nối lại.";
    if (error.status === 403)
      return "Phiên hiện tại không có quyền thực hiện thao tác này.";
    if (error.status === 404)
      return "Không tìm thấy phòng trong phạm vi của phiên này.";
    if (error.status === 409 || error.status === 423)
      return "Phòng vừa thay đổi. Kiểm tra trạng thái mới rồi thử lại.";
    if (error.status === 400 || error.status === 422)
      return "Dữ liệu chưa hợp lệ. Kiểm tra thông tin đã nhập.";
  }
  return "GroupHub chưa hoàn tất yêu cầu. Hãy thử lại.";
}
