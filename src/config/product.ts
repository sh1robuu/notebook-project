/** Central public identity. The existing brand is preserved across site and editor. */
const name = "Lessonboard";
export const product = {
  name,
  siteUrl: "https://noteboardbymaikhuyen.vercel.app",
  title: `${name} — Bảng viết cho mỗi buổi dạy`,
  description:
    "Viết bài, ghi chú trên PDF, mở tài liệu Word và PowerPoint. Có khung nháp riêng và tự động lưu bài trong trình duyệt.",
} as const;
