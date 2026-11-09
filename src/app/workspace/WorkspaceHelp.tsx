import { useState } from "react";
import type { CommandRegistry } from "../commands.ts";

const topics = [
  [
    "Chuẩn bị bài",
    "Tạo bài mới trong Bài giảng. Dùng bút, bút tô hoặc tẩy, rồi chuyển sang Select để kéo, đổi kích thước và nhóm đối tượng. Dùng các nút trang để tách nội dung theo tiết học.",
  ],
  [
    "Bảng nháp và trình chiếu",
    "Mở Scratchpad để tính nháp mà không thay đổi trang chính. Present ẩn công cụ viết. Dùng laser để chỉ bài. Các dấu laser không xuất hiện trong bản in.",
  ],
  [
    "Tài liệu và công cụ toán",
    "Nhập PDF, DOCX hoặc PPTX từ thanh công cụ. Word Terminal hỗ trợ phần cấu trúc và phương trình đã nhận diện. Một số MathType, định dạng Word và hiệu ứng PowerPoint chỉ có bản xem gần đúng. Math tools có đồ thị, bảng biến thiên cho các họ hàm hỗ trợ và máy tính DEG/RAD.",
  ],
  [
    "Mô phỏng và dự đoán",
    "Gói HTML có thể dùng tài nguyên cục bộ và thanh trượt khai báo. JavaScript của gói bị tắt. Tệp GGB được giữ để tải xuống và mở trong GeoGebra. Hoạt động dự đoán dùng số lượt do giáo viên nhập.",
  ],
  [
    "Sao lưu và phục hồi",
    "Download lesson tạo tệp .teachboard. Kiểm tra tệp đã tải rồi giữ ở một nơi khác. Khi lỗi lưu, thử lại hoặc tải bản phục hồi trước khi đóng tab. Dùng Open lesson để kiểm tra và nhập tệp thành một bài mới.",
  ],
  [
    "Cài ứng dụng và dùng ngoại tuyến",
    "Mở Ngoại tuyến, tải bộ tệp cần dùng khi có mạng, rồi thử mở lại trước buổi dạy. Trên Chrome hoặc Edge dùng mục cài ứng dụng trong trình duyệt. Trên iPad Safari dùng Chia sẻ rồi Thêm vào màn hình chính nếu có.",
  ],
  [
    "Chuyển thiết bị",
    "Dùng tệp .teachboard khi đổi trình duyệt, hồ sơ hoặc tên miền. Xóa dữ liệu trang web có thể xóa bài trên thiết bị. Tùy chọn thiết bị được lưu riêng với bài giảng.",
  ],
] as const;

const shortcutLabels: Record<string, string> = {
  undo: "Hoàn tác",
  redo: "Làm lại",
  select: "Chọn",
  pen: "Bút",
  highlight: "Bút tô",
  erase: "Tẩy cả nét",
  partial: "Tẩy một phần",
  hand: "Di chuyển bảng",
  text: "Văn bản",
  shapes: "Hình",
  copy: "Sao chép",
  cut: "Cắt",
  paste: "Dán",
  duplicate: "Nhân bản",
  delete: "Xóa",
  all: "Chọn tất cả",
  escape: "Bỏ chọn hoặc thoát",
  group: "Nhóm",
  ungroup: "Bỏ nhóm",
  equation: "Sửa phương trình",
  "math-figure": "Sửa đối tượng toán",
  download: "Tải bản sao bài giảng",
};

function displayShortcut(chord: string) {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const apple = /Mac|iPhone|iPad/i.test(platform);
  const display: Record<string, string> = {
    mod: apple ? "⌘" : "Ctrl",
    shift: "Shift",
    alt: "Alt",
  };
  return chord
    .split("+")
    .map(
      (part) =>
        display[part] ?? (part.length === 1 ? part.toUpperCase() : part),
    )
    .join("+");
}

export function WorkspaceHelp({ commands }: { commands: CommandRegistry }) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase("vi");
  const shortcuts = commands
    .shortcuts()
    .map((item) => ({
      ...item,
      title: shortcutLabels[item.id] ?? item.label,
      combinations: item.keys.map(displayShortcut),
    }))
    .filter((item) =>
      [item.title, ...item.combinations]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(term),
    );
  return (
    <section aria-label="Trợ giúp và phím tắt">
      <h3>Hướng dẫn sử dụng</h3>
      <div className="workspace-help">
        {topics.map(([title, content]) => (
          <details key={title}>
            <summary>{title}</summary>
            <p>{content}</p>
          </details>
        ))}
      </div>
      <h3>Phím tắt</h3>
      <label className="workspace-search">
        Tìm phím tắt
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <p>
        Khi đang nhập văn bản hoặc dùng bộ gõ, phím tắt của bảng nhường chỗ cho
        thao tác nhập.
      </p>
      <dl className="workspace-shortcuts">
        {shortcuts.map((item) => (
          <div key={item.id}>
            <dt>{item.title}</dt>
            <dd>
              {item.combinations.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      {!shortcuts.length ? <p>Không tìm thấy phím tắt phù hợp.</p> : null}
    </section>
  );
}
