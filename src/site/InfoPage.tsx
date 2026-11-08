import type { ReactNode } from "react";
import { product } from "../config/product.ts";
import { updates } from "./content.ts";
import type { PublicPath } from "./content.ts";
import { SiteLayout, EditorAction, Arrow } from "./SiteLayout.tsx";

const helpSections = [
  {
    id: "mo-bang",
    title: "Mở bảng giảng",
    text: "Chọn Mở bảng giảng để bắt đầu. Bài đã lưu sẽ mở lại khi bạn dùng cùng trình duyệt và địa chỉ website.",
    items: [
      "Trở lại đúng trình duyệt và địa chỉ đã dùng để tìm bài cũ.",
      "Khi chuyển sang địa chỉ khác, tải tệp .teachboard từ địa chỉ cũ trước rồi khôi phục tại địa chỉ mới.",
    ],
  },
  {
    id: "viet-ve",
    title: "Viết, chọn và chỉnh",
    text: "Chọn Pen để viết hoặc Highlighter để đánh dấu. Dùng Select để di chuyển, đổi kích thước và chỉnh các đối tượng. Màu, độ dày, hình, văn bản và công thức nằm trong thanh công cụ.",
    items: [
      "Undo và Redo áp dụng trên mặt bảng đang hoạt động.",
      "Whole stroke eraser xóa nét hoặc đối tượng phù hợp. Partial eraser cắt phần nét viết được hỗ trợ.",
      "Dùng Pan và các nút zoom để thay đổi góc nhìn mà không đổi vị trí nội dung.",
    ],
  },
  {
    id: "trang",
    title: "Chia bài giảng thành trang",
    text: "Dùng Add page để tạo trang và Show page list để xem các bản thu nhỏ. Page settings cho phép nhân bản, sắp xếp hoặc xóa trang khi đang chỉnh sửa.",
    items: [
      "Thay màu, kích thước và hướng giấy cho trang trắng.",
      "Trang PDF và PowerPoint giữ kích thước nguồn. Phần chú thích có thể chỉnh sửa riêng.",
      "Mỗi bài có tối đa 200 trang chính và 20.000 đối tượng trên hai mặt bảng.",
    ],
  },
  {
    id: "nhap",
    title: "Mở thêm nháp độc lập",
    text: "Chọn Open scratchpad để giữ nháp cạnh bài giảng. Nhấn vào mặt bảng muốn thao tác. Mỗi bên có nội dung, góc nhìn và lịch sử hoàn tác riêng.",
    items: [
      "Điều chỉnh phần chia hoặc đổi vị trí khung nháp theo màn hình.",
      "Chuyển trang chính vẫn giữ phần nháp.",
      "Khi xuất, nháp chỉ được thêm nếu bạn chọn rõ trong tùy chọn xuất.",
    ],
  },
  {
    id: "tai-lieu",
    title: "Nhập tài liệu",
    text: "Chọn Import PDF, Import DOCX hoặc Import PowerPoint. Xem trước tài liệu và đọc thông báo trước khi thêm vào bài. Tài liệu được xử lý trên thiết bị và lưu cùng tệp bài giảng.",
    items: [
      "PDF dùng làm nền cho chú thích. Bản quét chưa có OCR. PDF mã hóa cần mở khóa trong phiên làm việc.",
      "Với DOCX, dùng Word Terminal để sửa văn bản, bảng và công thức Word (OMML), rồi chia thành từng phần để trình bày. Một số bố cục Word và công thức MathType cũ có thể hiển thị khác bản gốc hoặc không chỉnh sửa được.",
      "Với PPTX, bạn có thể chuyển slide và hiện nội dung từng bước. Một số hiệu ứng được chuyển thành thao tác hiện nội dung đơn giản. Biểu đồ, SmartArt, âm thanh, video và một số phông chữ hoặc hiệu ứng chưa được hỗ trợ đầy đủ.",
      "Chưa hỗ trợ .doc/.ppt cũ hoặc tài liệu chứa macro. Mỗi tệp DOCX hoặc PPTX có dung lượng tối đa 50 MB.",
    ],
  },
  {
    id: "sao-luu",
    title: "Giữ bản sao có thể mở lại",
    text: "Chọn Download lesson để tải tệp .teachboard. Đây là bản sao dùng để tiếp tục chỉnh sửa. Chọn Open lesson, đợi kiểm tra rồi chọn Open checked lesson để khôi phục.",
    items: [
      "Lưu trữ của trình duyệt có thể bị xóa, mất quyền ghi hoặc hết dung lượng. Tải bản sao định kỳ, nhất là trước khi dọn dữ liệu trình duyệt.",
      "Không giữ bản duy nhất trong cửa sổ riêng tư vì dữ liệu có thể bị xóa khi đóng cửa sổ.",
      "Export tạo PNG/PDF trình bày. Bản xuất này có thể dùng lớp ảnh cho một số nội dung và không thay thế tệp .teachboard.",
      "Khi khôi phục lỗi, giữ tệp gốc và đọc thông báo. Tránh xóa bài hiện tại để thử lại.",
    ],
  },
] as const;

function Article({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="help-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function InfoPage({
  path,
  available,
}: {
  path: Exclude<PublicPath, "/">;
  available: boolean;
}) {
  return (
    <SiteLayout available={available}>
      <main id="noi-dung" className="info-main site-frame">
        {path === "/updates" ? (
          <>
            <header className="info-heading">
              <p className="section-topic">Cập nhật sản phẩm</p>
              <h1>
                Có gì mới
                <br />
                trên bảng giảng?
              </h1>
              <p>Các tính năng mới giúp bạn soạn bài và trình bày trên bảng.</p>
            </header>
            <div className="update-list">
              {updates.map((update) => (
                <article className="update-entry" key={update.date}>
                  <time dateTime={update.date}>{update.dateLabel}</time>
                  <div>
                    <h2>{update.title}</h2>
                    <p>{update.summary}</p>
                    <ul>
                      {update.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                    <p className="info-note">{update.limitation}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="info-callout">
              <h2>Cần hướng dẫn sử dụng?</h2>
              <p>Xem cách viết trên bảng, nhập tài liệu và lưu bài giảng.</p>
              <a className="text-link" href="/help">
                Đọc hướng dẫn <Arrow />
              </a>
            </div>
          </>
        ) : path === "/help" ? (
          <>
            <header className="info-heading">
              <p className="section-topic">Bắt đầu sử dụng</p>
              <h1>
                Bắt đầu với
                <br />
                bảng giảng.
              </h1>
              <p>
                Cách viết, mở tài liệu và lưu lại bài giảng. Tên nút trong hướng
                dẫn được giữ như trên thanh công cụ.
              </p>
            </header>
            <div className="help-layout">
              <nav className="help-index" aria-label="Mục lục hướng dẫn">
                {helpSections.map((section) => (
                  <a key={section.id} href={"#" + section.id}>
                    {section.title}
                  </a>
                ))}
              </nav>
              <div>
                {helpSections.map((section) => (
                  <Article
                    id={section.id}
                    title={section.title}
                    key={section.id}
                  >
                    <p>{section.text}</p>
                    <ul>
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </Article>
                ))}
              </div>
            </div>
            <div className="info-callout">
              <h2>Sẵn sàng bắt đầu bài giảng?</h2>
              <EditorAction available={available} />
            </div>
          </>
        ) : (
          <>
            <header className="info-heading">
              <p className="section-topic">Dữ liệu & quyền riêng tư</p>
              <h1>
                Bài giảng ở<br />
                thiết bị của bạn.
              </h1>
              <p>
                Cách {product.name} lưu bài giảng và xử lý tài liệu của bạn.
              </p>
              <p className="info-date">Cập nhật ngày 8 tháng 11, 2026</p>
            </header>
            <div className="privacy-content">
              <Article id="luu-tru" title="Lưu trong trình duyệt">
                <p>
                  Bài giảng, tài liệu và hình ảnh được lưu trong trình duyệt
                  trên thiết bị của bạn. Ứng dụng không đồng bộ bài giảng giữa
                  các máy và không yêu cầu tài khoản.
                </p>
                <p>
                  Dữ liệu thuộc từng địa chỉ website và hồ sơ trình duyệt. Mở
                  bằng tên miền khác, hồ sơ khác hoặc chế độ riêng tư không tự
                  chuyển bài giảng. Trình duyệt hoặc người dùng có thể xóa vùng
                  lưu này. Tệp .teachboard là cách giữ bản sao riêng.
                </p>
              </Article>
              <Article id="tai-lieu" title="Tài liệu được xử lý thế nào?">
                <p>
                  PDF, DOCX và PPTX được đọc và xử lý trong trình duyệt. Ứng
                  dụng không gửi tệp của bạn đến dịch vụ chuyển đổi hoặc AI. Tài
                  nguyên từ liên kết bên ngoài trong tài liệu nhập bị chặn.
                </p>
                <p>
                  Tài liệu gốc và ảnh nhúng có thể nằm trong bản sao
                  .teachboard. PNG/PDF xuất ra và tệp bài giảng tải xuống không
                  được mã hóa bởi ứng dụng. Hãy kiểm tra nội dung trước khi chia
                  sẻ.
                </p>
              </Article>
              <Article id="ket-noi" title="Những kết nối vẫn có thể xảy ra">
                <p>
                  Website và tài nguyên của ứng dụng được phân phối qua Vercel.
                  Nhà cung cấp hạ tầng có thể xử lý thông tin yêu cầu mạng để
                  phục vụ và vận hành website theo chính sách của họ.
                </p>
                <p>
                  Khi mở bảng, thư viện vẽ tldraw có thể tải tài nguyên và gửi
                  phiên bản thư viện, mã giấy phép cùng địa chỉ trang đến tldraw
                  để thống kê sử dụng. Nội dung bảng và tài liệu của bạn không
                  nằm trong thông tin này.
                </p>
                <p>
                  Trang giới thiệu dùng ảnh và phông chữ lưu cùng website. Trang
                  này không dùng quảng cáo hoặc công cụ phân tích truy cập.
                </p>
                <p>
                  <a href="https://vercel.com/legal/privacy-policy">
                    Chính sách của Vercel
                  </a>{" "}
                  ·{" "}
                  <a href="https://tldraw.dev/sdk-features/license-key">
                    Thông tin dữ liệu từ tldraw
                  </a>
                </p>
              </Article>
              <Article id="bao-ve" title="Chủ động giữ bài giảng">
                <p>
                  Tải bản sao trước khi dọn dữ liệu trình duyệt, đổi thiết bị
                  hoặc chuyển tên miền. Nếu dùng chung máy, người khác dùng cùng
                  hồ sơ trình duyệt có thể mở lại bài đã lưu.
                </p>
                <p>
                  Bạn có thể xóa dữ liệu website trong cài đặt trình duyệt sau
                  khi đã kiểm tra bản sao. Việc xóa này không xóa các tệp đã tải
                  xuống hoặc đã chia sẻ.
                </p>
                <a className="text-link" href="/help#sao-luu">
                  Cách sao lưu và khôi phục <Arrow />
                </a>
              </Article>
            </div>
          </>
        )}
      </main>
    </SiteLayout>
  );
}
