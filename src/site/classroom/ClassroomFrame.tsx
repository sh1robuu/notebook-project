import type { ReactNode } from "react";
import { product } from "../../config/product.ts";
import type { RoomMode, RoomState } from "../../modules/classroom/api.ts";
import type { RoomConnection } from "../../modules/classroom/events.ts";

export const roomState: Record<RoomState, string> = {
  draft: "Bản nháp",
  open: "Đang nhận người tham gia",
  locked: "Đã khóa tham gia",
  ended: "Đã kết thúc",
  archived: "Đã lưu trữ",
};
export const roomMode: Record<RoomMode, string> = {
  individual: "Cá nhân",
  group: "Theo nhóm",
};
const connectionLabel: Record<RoomConnection, string> = {
  connecting: "Đang kết nối",
  live: "Đang đồng bộ",
  reconnecting: "Đang kết nối lại",
};

export function ClassroomFrame({
  student = false,
  account,
  children,
}: {
  student?: boolean;
  account?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="classroom" data-ui>
      <a className="skip-link" href="#classroom-main">
        Đến nội dung
      </a>
      <header className="classroom-bar">
        <a className="wordmark" href="/">
          <img src="/mark.svg" width={30} height={30} alt="" />
          {product.name}
        </a>
        {(!student || account) && (
          <nav aria-label="Lối tắt">
            {!student && <a href="/app">Bảng giảng</a>}
            {account}
          </nav>
        )}
      </header>
      <main id="classroom-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

export function RoomConnectionStatus({ state }: { state: RoomConnection }) {
  return (
    <p className="classroom-connection" role="status">
      <span aria-hidden="true" data-live={state === "live"} />
      {connectionLabel[state]}
    </p>
  );
}

export function CommandNotice({
  error,
  busy,
  committed,
  retry,
}: {
  error: string;
  busy: boolean;
  committed?: boolean;
  retry?: () => void;
}) {
  if (busy)
    return (
      <p role="status" className="classroom-muted">
        Đang gửi yêu cầu…
      </p>
    );
  if (!error)
    return committed ? (
      <p role="status" className="classroom-muted">
        Đã lưu thay đổi.
      </p>
    ) : null;
  return (
    <div className="classroom-notice">
      <p role="alert">{error}</p>
      {retry && (
        <button type="button" onClick={retry}>
          Gửi lại yêu cầu
        </button>
      )}
    </div>
  );
}
