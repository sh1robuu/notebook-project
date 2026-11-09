import { useState, useSyncExternalStore } from "react";
import { offlineWorkspace } from "../../modules/pwa/client.ts";
import { prepareWorkspaceForNavigation } from "../../modules/workspace/activity.ts";
import type { LessonSession } from "../../modules/board/lesson-session.ts";

export function formatStorage(bytes?: number) {
  if (bytes === undefined || !Number.isFinite(bytes)) return "Không có số liệu";
  return (
    new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(
      bytes / 1_000_000,
    ) + " MB"
  );
}

export function WorkspaceOffline({
  session,
  dialog,
}: {
  session: LessonSession;
  dialog: HTMLDialogElement | null;
}) {
  const offline = useSyncExternalStore(
    offlineWorkspace.subscribe,
    offlineWorkspace.getSnapshot,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const updating =
    offline.update === "preparing" || offline.update === "activating";
  const waiting = offline.update === "available" || offline.update === "error";
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Thao tác ngoại tuyến chưa hoàn tất.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Sử dụng ngoại tuyến">
      <h3>Sử dụng ngoại tuyến</h3>
      <dl className="workspace-facts">
        <dt>Kết nối</dt>
        <dd>
          {offline.network ? "Trình duyệt báo có mạng" : "Đang ngoại tuyến"}
        </dd>
        <dt>Bảng và công cụ</dt>
        <dd>
          {offline.coreReady
            ? "Sẵn sàng"
            : offline.phase === "preparing"
              ? "Đang tải"
              : "Chưa sẵn sàng"}
          {offline.coreBytes ? " · " + formatStorage(offline.coreBytes) : ""}
        </dd>
        <dt>Tài nguyên PDF bổ sung</dt>
        <dd>
          {offline.pdfReady ? "Sẵn sàng" : "Cần chuẩn bị"}
          {offline.pdfBytes ? " · " + formatStorage(offline.pdfBytes) : ""}
        </dd>
      </dl>
      <p>
        Chuẩn bị khi có mạng để mở lại bảng, bài đã lưu và công cụ cục bộ. Tệp
        bài giảng được lưu riêng trên thiết bị.
      </p>
      {offline.phase === "unsupported" ? (
        <p>
          Chế độ ngoại tuyến cần bản triển khai HTTPS hoặc bản xem trước cục bộ
          được hỗ trợ.
        </p>
      ) : null}
      <button
        type="button"
        disabled={!offline.supported || busy || updating || !offline.network}
        onClick={() => void run(offlineWorkspace.prepareOffline)}
      >
        {offline.phase === "preparing"
          ? "Đang chuẩn bị…"
          : "Chuẩn bị dùng ngoại tuyến"}
      </button>
      <h3>Cài ứng dụng</h3>
      {offline.installed ? (
        <p>Ứng dụng đã được cài hoặc đang mở ở cửa sổ riêng.</p>
      ) : offline.installAvailable ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(offlineWorkspace.install)}
        >
          Cài Lessonboard
        </button>
      ) : (
        <p>
          Mở menu trình duyệt và chọn Cài ứng dụng nếu có. Trên iPad, dùng Chia
          sẻ rồi Thêm vào màn hình chính.
        </p>
      )}
      <h3>Cập nhật</h3>
      <p role="status">
        {offline.update === "checking"
          ? "Đang kiểm tra phiên bản…"
          : updating
            ? "Đang chuẩn bị cập nhật và kiểm tra bản lưu…"
            : offline.update === "available"
              ? "Có bản cập nhật. Hãy lưu bài và đóng các tab bảng khác."
              : offline.update === "error"
                ? "Chưa hoàn tất kiểm tra hoặc cập nhật."
                : "Đang dùng bản hiện tại."}
      </p>
      <div className="workspace-row">
        <button
          type="button"
          disabled={!offline.supported || busy || updating || !offline.network}
          onClick={() => void run(offlineWorkspace.checkForUpdate)}
        >
          Kiểm tra cập nhật
        </button>
        {waiting ? (
          <button
            className="primary"
            type="button"
            disabled={busy || updating || !offline.network}
            onClick={() =>
              void run(() =>
                offlineWorkspace.activateUpdate(() =>
                  prepareWorkspaceForNavigation(session, {
                    ignoreDialog: dialog ?? undefined,
                  }),
                ),
              )
            }
          >
            Lưu và cập nhật
          </button>
        ) : null}
      </div>
      {error || offline.updateError || offline.error ? (
        <p className="dialog-error" role="alert">
          {error || offline.updateError || offline.error}
        </p>
      ) : null}
    </section>
  );
}
