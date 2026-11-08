import { product } from "../config/product.ts";

export const publicPaths = ["/", "/updates", "/help", "/privacy"] as const;
export type PublicPath = (typeof publicPaths)[number];
export const pageContent = {
  "/": {
    title: product.title,
    description: product.description,
  },
  "/updates": {
    title: `Cập nhật — ${product.name}`,
    description:
      "Các tính năng mới của Lessonboard cho việc soạn bài và giảng dạy.",
  },
  "/help": {
    title: `Bắt đầu sử dụng — ${product.name}`,
    description:
      "Hướng dẫn viết, mở nháp, nhập tài liệu, sao lưu và khôi phục bài giảng trong Lessonboard.",
  },
  "/privacy": {
    title: `Dữ liệu & quyền riêng tư — ${product.name}`,
    description:
      "Cách Lessonboard lưu bài giảng trong trình duyệt, xử lý tài liệu và sử dụng tài nguyên bên thứ ba.",
  },
} satisfies Record<PublicPath, { title: string; description: string }>;

export function isPublicPath(path: string): path is PublicPath {
  return (publicPaths as readonly string[]).includes(path);
}

export type ProductUpdate = {
  date: string;
  dateLabel: string;
  title: string;
  summary: string;
  changes: readonly string[];
  limitation: string;
};
export const updates: readonly ProductUpdate[] = [
  {
    date: "2026-11-08",
    dateLabel: "8 tháng 11, 2026",
    title: "Thêm PowerPoint vào bài giảng",
    summary: "Nhập PPTX cục bộ, giữ bản gốc và ghi chú trên từng slide.",
    changes: [
      "Xem trước nội dung được hỗ trợ và các cảnh báo trước khi nhập.",
      "Hiện nội dung từng bước theo thứ tự được hỗ trợ trong slide.",
      "Giữ nét viết chỉnh sửa được khi lưu bài và xuất PNG/PDF.",
    ],
    limitation:
      "Biểu đồ, SmartArt, âm thanh, video và một số phông chữ hoặc hiệu ứng chưa được hỗ trợ đầy đủ. Kiểm tra bản xem trước trước khi đưa vào bài giảng.",
  },
  {
    date: "2026-11-05",
    dateLabel: "5 tháng 11, 2026",
    title: "Lưu bài để dùng lại",
    summary: "Tiếp tục bài đã lưu hoặc mang bài giảng sang máy khác.",
    changes: [
      "Tự động lưu bài trong trình duyệt đang dùng.",
      "Tải tệp .teachboard để sao lưu và tiếp tục chỉnh sửa.",
      "Xuất PNG hoặc PDF để chia sẻ bài giảng.",
    ],
    limitation:
      "Dữ liệu trình duyệt gắn với từng địa chỉ website. Cần sao lưu khi chuyển sang tên miền khác.",
  },
] as const;
