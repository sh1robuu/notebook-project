/** Central public identity. The existing brand is preserved across site and editor. */
const name = "Lessonboard";
export const product = {
  name,
  siteUrl: "https://noteboardbymaikhuyen.vercel.app",
  title: `${name} — Bảng giảng theo mạch riêng`,
  description:
    "Không gian giảng dạy số với bảng viết, tài liệu được hỗ trợ và khung nháp độc lập. Bài giảng lưu trên trình duyệt của bạn.",
} as const;
