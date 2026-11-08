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
      "Những thay đổi đã có trong Lessonboard và giới hạn của bản giới thiệu hiện tại.",
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

export const questions = [
  {
    title: "Tôi có cần tạo tài khoản?",
    answer:
      "Bản phát triển hiện tại mở bài giảng trực tiếp trong trình duyệt, chưa có tài khoản hoặc đồng bộ đám mây. Editor công khai chỉ mở khi hoàn tất giấy phép. Trạng thái này được hiển thị rõ khi bạn vào bảng giảng.",
  },
  {
    title: "Bài giảng được lưu ở đâu?",
    answer:
      "Bài giảng được tự động lưu trong bộ nhớ của trình duyệt trên thiết bị đang dùng. Đổi trình duyệt, hồ sơ, thiết bị hoặc địa chỉ website sẽ tạo vùng lưu trữ khác. Hãy tải tệp .teachboard để giữ một bản sao.",
  },
  {
    title: "Tôi có thể dùng khi mất mạng?",
    answer:
      "Khi editor và các tài nguyên cần thiết đã được tải, nhiều thao tác chạy ngay trên thiết bị. Bản hiện tại chưa có chế độ cài đặt ngoại tuyến được kiểm chứng. Bạn vẫn cần mạng để mở website và tải những tài nguyên chưa có.",
  },
  {
    title: "Những định dạng nào được hỗ trợ?",
    answer:
      "PDF có thể làm nền để ghi chú và xuất lại trong phạm vi hỗ trợ. DOCX và PPTX có luồng nhập kèm xem trước và cảnh báo. Bố cục Word, MathType cũ, phông chữ và một số đối tượng hoặc hiệu ứng PowerPoint còn giới hạn. Tệp .doc, .ppt cũ và tài liệu có macro chưa được hỗ trợ.",
  },
  {
    title: "Bút cảm ứng có dùng được không?",
    answer:
      "Editor nhận đầu vào bút, chuột và cảm ứng từ trình duyệt. Trải nghiệm lực nhấn, chống chạm lòng bàn tay và bộ gõ còn phụ thuộc thiết bị. Các lượt kiểm tra trên máy tính chưa thay thế cho kiểm thử bút thật trên iPad, Surface và Android.",
  },
  {
    title: "Làm sao để sao lưu bài giảng?",
    answer:
      "Chọn Download lesson để tải tệp .teachboard. Tệp này giữ dữ liệu có thể chỉnh sửa và tài liệu nguồn được hỗ trợ. Chọn Open lesson để kiểm tra rồi khôi phục. PNG/PDF phù hợp để chia sẻ bản trình bày, còn .teachboard dùng để tiếp tục chỉnh sửa.",
  },
  {
    title: "Ứng dụng có miễn phí không?",
    answer:
      "Hiện chưa công bố bảng giá hay chính sách sử dụng thương mại. Website giới thiệu có thể truy cập công khai. Việc mở editor production phụ thuộc giấy phép SDK hợp lệ và trạng thái phát hành được hiển thị trên website.",
  },
] as const;

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
      "Trình bày từng build theo metadata nguồn, gồm một số build tự động.",
      "Giữ nét viết chỉnh sửa được khi lưu bài và xuất PNG/PDF.",
    ],
    limitation:
      "Đang thử nghiệm trong bản phát triển. Chart, SmartArt, media, phông chữ và các hiệu ứng phức tạp còn giới hạn. Chưa đạt độ tương đương đầy đủ với PowerPoint.",
  },
  {
    date: "2026-11-05",
    dateLabel: "5 tháng 11, 2026",
    title: "Một địa chỉ cho bài giảng",
    summary:
      "Tách phần giới thiệu khỏi editor và chuẩn bị luồng phát hành website.",
    changes: [
      "Trang giới thiệu bằng tiếng Việt, dùng ảnh chụp từ ứng dụng.",
      "Editor được tải riêng tại /app.",
      "Thêm trạng thái giấy phép để thông báo đúng khả năng mở editor công khai.",
    ],
    limitation:
      "Dữ liệu trình duyệt gắn với từng địa chỉ website. Cần sao lưu khi chuyển sang tên miền khác.",
  },
] as const;
