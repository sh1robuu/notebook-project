import { product } from "../config/product.ts";
export function RouteNotice({
  kind,
}: {
  kind: "unavailable" | "not-found" | "load-error";
}) {
  return (
    <main className="route-notice" lang="vi">
      <a className="wordmark" href="/">
        <img src="/mark.svg" width={32} height={32} alt="" />
        {product.name}
      </a>
      <h1>
        {kind === "unavailable"
          ? "Bảng giảng chưa mở"
          : kind === "not-found"
            ? "Không tìm thấy trang"
            : "Chưa tải được bảng giảng"}
      </h1>
      <p>
        {kind === "unavailable"
          ? "Bản công khai đang chờ kích hoạt giấy phép trình biên tập. Các hình ảnh trên trang giới thiệu được chụp từ bản phát triển đang hoạt động."
          : kind === "not-found"
            ? "Địa chỉ này chưa có nội dung. Bạn có thể trở lại phần giới thiệu hoặc mở bảng giảng."
            : "Kiểm tra kết nối rồi tải lại trang. Dữ liệu bài giảng đã lưu trong trình duyệt được giữ nguyên."}
      </p>
      {kind === "unavailable" && (
        <p>
          Bài giảng đã lưu không bị thay đổi. Chuyển sang tên miền khác cần khôi
          phục từ tệp bài giảng; dữ liệu không tự đồng bộ.
        </p>
      )}
      <div className="notice-actions">
        <a className="site-button" href="/">
          Về trang giới thiệu
        </a>
        <a href="/help">Hướng dẫn sử dụng</a>
        <a href="/privacy">Dữ liệu & quyền riêng tư</a>
        {kind === "not-found" && <a href="/app">Mở bảng giảng</a>}
        {kind === "load-error" && (
          <button onClick={() => location.reload()}>Tải lại</button>
        )}
      </div>
    </main>
  );
}
