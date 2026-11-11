import {
  ClassroomError,
  classroomApiPrefix,
  classroomRequest,
  roomPath,
} from "./api.ts";
import type {
  CaptureSessionView,
  ParticipationReceipt,
  ParticipationView,
  StudentParticipationCommand,
  TeacherParticipation,
  TeacherParticipationCommand,
} from "./participation-types.ts";

export const participationApi = {
  capabilities: (signal?: AbortSignal) =>
    classroomRequest<{ images: boolean }>("/media/capabilities", { signal }),
  teacher: (roomId: string, signal?: AbortSignal) =>
    classroomRequest<{ participation: TeacherParticipation }>(
      roomPath(roomId) + "/participation",
      { signal },
    ),
  student: (signal?: AbortSignal) =>
    classroomRequest<{ participation: ParticipationView; csrfToken: string }>(
      "/participant/participation",
      { signal },
    ),
  teach: (
    roomId: string,
    body: TeacherParticipationCommand,
    csrfToken: string,
    key: string,
    signal?: AbortSignal,
  ) =>
    classroomRequest<ParticipationReceipt<TeacherParticipation>>(
      roomPath(roomId) + "/participation/commands",
      { body, csrfToken, key, signal },
    ),
  submit: (
    body: StudentParticipationCommand,
    csrfToken: string,
    key: string,
    signal?: AbortSignal,
  ) =>
    classroomRequest<ParticipationReceipt>(
      "/participant/participation/commands",
      { body, csrfToken, key, signal },
    ),
  captureSession: (signal?: AbortSignal) =>
    classroomRequest<{ session: CaptureSessionView; csrfToken: string }>(
      "/capture/session",
      { signal },
    ),
  redeem: (code: string, signal?: AbortSignal) =>
    classroomRequest<{ session: CaptureSessionView; csrfToken: string }>(
      "/capture/redeem",
      { body: { code }, signal },
    ),
  acceptCapture: (
    mediaId: string,
    csrfToken: string,
    key: string,
    signal?: AbortSignal,
  ) =>
    classroomRequest<{
      session: CaptureSessionView;
      receipt: {
        id: string;
        resourceId: string;
        acceptedAt: string;
        revision: number;
      };
    }>("/capture/commands", {
      body: { type: "acceptCapture", mediaId },
      csrfToken,
      key,
      signal,
    }),
};

export const MAX_CLASSROOM_IMAGE_BYTES = 10_000_000;
export const MAX_PRODUCT_BYTES = 20_000_000;
export const MAX_PRODUCT_IMAGES = 4;
const MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type MediaMime = (typeof MIME_TYPES)[number];
type UploadReceipt = {
  id: string;
  state: "pending" | "uploaded" | "finalized";
};
export type DraftImage = { requestId: string; file: File };

export function classroomImages(files: readonly File[]): DraftImage[] {
  if (files.length > MAX_PRODUCT_IMAGES)
    throw new Error("Chọn tối đa 4 ảnh cho mỗi bài nộp.");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_PRODUCT_BYTES)
    throw new Error("Tổng dung lượng ảnh tối đa 20 MB.");
  return files.map((file) => {
    if (
      !MIME_TYPES.includes(file.type as MediaMime) ||
      !file.size ||
      file.size > MAX_CLASSROOM_IMAGE_BYTES
    )
      throw new Error("Chọn ảnh JPEG, PNG hoặc WebP không quá 10 MB mỗi ảnh.");
    return { file, requestId: crypto.randomUUID() };
  });
}

export async function uploadClassroomImage(
  scope: "participant" | "capture",
  image: DraftImage,
  csrfToken: string,
  progress: (sent: number) => void,
  signal?: AbortSignal,
) {
  const { file, requestId } = image;
  const route = "/" + scope + "/media";
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const { id, state } = await classroomRequest<UploadReceipt>(route, {
    body: { requestId, bytes: file.size, mime: file.type, sha256 },
    csrfToken,
    signal,
  });
  const item = route + "/" + encodeURIComponent(id);
  if (state === "pending")
    await sendBytes(item, file, csrfToken, progress, signal);
  progress(file.size);
  if (state !== "finalized") {
    await classroomRequest<UploadReceipt>(
      item + "/finalize",
      { body: {}, csrfToken, signal },
      AbortSignal.timeout(35_000),
    );
  }
  return id;
}

function sendBytes(
  path: string,
  file: File,
  csrfToken: string,
  progress: (sent: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open("PUT", classroomApiPrefix + path);
    request.timeout = 60_000;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("x-classroom-csrf", csrfToken);
    request.upload.onprogress = (event) => progress(event.loaded);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else {
        let code = "upload";
        try {
          code = JSON.parse(request.responseText).error ?? code;
        } catch {
          /* A gateway may send HTML. */
        }
        reject(new ClassroomError(request.status, code));
      }
    };
    request.onerror = request.ontimeout = () =>
      reject(new ClassroomError(0, "upload"));
    request.onabort = () =>
      reject(
        signal?.reason ?? new DOMException("Upload cancelled.", "AbortError"),
      );
    request.onloadend = () => signal?.removeEventListener("abort", abort);
    signal?.addEventListener("abort", abort, { once: true });
    request.send(file);
  });
}

export function privateMediaUrl(value: string) {
  if (!value.startsWith(classroomApiPrefix + "/") || value.includes("\\"))
    return undefined;
  const url = new URL(value, location.origin);
  return url.origin === location.origin &&
    url.pathname.startsWith(classroomApiPrefix + "/")
    ? url.href
    : undefined;
}

export function externalSubmissionUrl(value: string | null) {
  if (!value || value.length > 2000) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.href;
  } catch {
    /* Keep unsupported links inert. */
  }
  return undefined;
}
