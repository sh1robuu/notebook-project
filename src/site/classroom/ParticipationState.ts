import { useCallback, useEffect, useRef, useState } from "react";
import { ClassroomError, classroomError } from "../../modules/classroom/api.ts";

type Versioned = { revision: number; serverTime: string };
type ReadResult<T> = { participation: T; csrfToken?: string };
export function useParticipation<T extends Versioned>(
  read: (signal: AbortSignal) => Promise<ReadResult<T>>,
  roomRevision: number,
  onDenied: () => void,
) {
  const [data, setData] = useState<ReadResult<T>>();
  const [error, setError] = useState("");
  const [unsupported, setUnsupported] = useState(false);
  const [retry, setRetry] = useState(0);
  const clock = useRef({ serverTime: 0, observedAt: 0 });
  const apply = useCallback((next: ReadResult<T>) => {
    setData((previous) => {
      if (
        previous &&
        previous.participation.revision > next.participation.revision
      )
        return previous;
      return { csrfToken: previous?.csrfToken, ...next };
    });
    const serverTime = Date.parse(next.participation.serverTime);
    if (serverTime >= clock.current.serverTime)
      clock.current = { serverTime, observedAt: performance.now() };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        setError("");
        setUnsupported(false);
        apply(next);
      },
      (failure) => {
        if (controller.signal.aborted) return;
        if (failure instanceof ClassroomError && failure.status === 404) {
          setUnsupported(true);
          setData(undefined);
        } else if (failure instanceof ClassroomError && failure.unauthorized) {
          setData(undefined);
          onDenied();
        } else setError(classroomError(failure));
      },
    );
    return () => controller.abort();
  }, [read, roomRevision, retry, apply, onDenied]);
  return {
    data,
    error,
    unsupported,
    apply,
    clock,
    refresh: () => setRetry((v) => v + 1),
  };
}

export function participationError(error: unknown) {
  if (error instanceof ClassroomError) {
    switch (error.code) {
      case "submission_locked":
      case "task_locked":
        return "Bài tập đã khóa nộp. Bản nháp vẫn còn trên thiết bị.";
      case "stale_task":
      case "stale_revision":
        return "Giáo viên vừa cập nhật bài tập. Xem nội dung mới trước khi gửi lại.";
      case "media_disabled":
      case "storage_unavailable":
        return "Kho ảnh chưa sẵn sàng. Bạn có thể giữ bản nháp hoặc nộp liên kết nếu bài tập cho phép.";
      case "media_busy":
        return "Kho ảnh đang xử lý tệp khác. Bản nháp đã được giữ để thử lại.";
      case "media_quota":
        return "Đã đến giới hạn ảnh. Bạn có thể nộp liên kết nếu bài tập cho phép.";
      case "media_expired":
        return "Phiên tải ảnh đã hết hạn. Chọn lại ảnh để gửi.";
      case "insertion_target":
        return "Trang đích đã đổi. Mở lại hoạt động từ đúng trang bảng để chèn.";
      case "invalid_image":
      case "media_invalid":
        return "Không đọc được ảnh. Hãy chọn một tệp JPEG, PNG hoặc WebP khác.";
    }
    return classroomError(error);
  }
  return error instanceof Error
    ? error.message
    : "Chưa hoàn tất thao tác. Hãy thử lại.";
}
