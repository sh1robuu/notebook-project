import type { ReactNode } from "react";
import { product } from "../config/product.ts";
import { updates } from "./content.ts";
import type { PublicPath } from "./content.ts";
import {
  SiteLayout,
  AvailabilityNote,
  EditorAction,
  Arrow,
} from "./SiteLayout.tsx";

const helpSections = [
  {
    id: "mo-bang",
    title: "Mở đúng không gian",
    text: "Chọn Mở bảng giảng khi editor đã được kích hoạt. Nếu website hiển thị trạng thái chờ giấy phép, editor công khai chưa sẵn sàng. Bài giảng của bản phát triển được lưu theo địa chỉ website và hồ sơ trình duyệt đang dùng.",
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
      "Bản hiện tại giới hạn 200 trang chính và 20.000 đối tượng trên hai mặt bảng.",
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
    title: "Kiểm tra tài liệu trước khi nhập",
    text: "Import PDF, Import DOCX và Import PowerPoint mở luồng kiểm tra và xem trước. Đọc các cảnh báo rồi xác nhận đưa vào bài. Tài liệu nguồn được xử lý tại thiết bị và giữ trong tệp bài giảng được hỗ trợ.",
    items: [
      "PDF dùng làm nền cho chú thích. Bản quét chưa có OCR. PDF mã hóa cần mở khóa trong phiên làm việc.",
      "DOCX/OMML dùng mô hình nội dung được hỗ trợ. Word Terminal sửa nguồn và biên soạn thành các khối để giảng. Chưa bảo toàn mọi bố cục Word hoặc chuyển MathType cũ thành công thức chỉnh sửa được.",
      "PPTX giữ slide và một số thứ tự build theo nguồn. Các hiệu ứng được hỗ trợ có thể được đơn giản hóa thành hiện nội dung. Chart, SmartArt, video/audio và nhiều kiểu chữ hoặc hiệu ứng còn giới hạn.",
      "Chưa hỗ trợ .doc/.ppt cũ hoặc tài liệu chứa macro. DOCX và PPTX giới hạn 50 MB mỗi tệp, cùng các giới hạn giải nén và tài nguyên.",
    ],
  },
  {
    id: "sao-luu",
    title: "Giữ bản sao có thể mở lại",
    text: "Chọn Download lesson để tải tệp .teachboard. Đây là bản sao dùng để tiếp tục chỉnh sửa. Chọn Open lesson, đợi kiểm tra rồi chọn Open checked lesson để khôi phục.",
    items: [
      "Lưu trữ của trình duyệt có thể bị xóa, mất quyền ghi hoặc hết dung lượng. Tải bản sao định kỳ, nhất là trước khi dọn dữ liệu trình duyệt.",
      "Cửa sổ riêng tư và thiết bị dùng chung cần được cân nhắc trước khi lưu tài liệu.",
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
                Từng bước,
                <br />
                thêm cách giảng.
              </h1>
              <p>
                Những thay đổi đã có trong mã nguồn hiện tại. Trạng thái mở
                editor được hiển thị riêng.
              </p>
              <AvailabilityNote available={available} />
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
              <h2>Xem rõ bản hiện tại.</h2>
              <p>
                Hướng dẫn mô tả cách dùng và giới hạn của các định dạng tài
                liệu.
              </p>
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
                Mở bài.
                <br />
                Tiếp mạch giảng.
              </h1>
              <p>
                Một hướng dẫn ngắn cho các công cụ đã có. Một số tên nút trong
                editor hiện dùng tiếng Anh.
              </p>
              <AvailabilityNote available={available} />
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
              <h2>Trạng thái của bảng giảng.</h2>
              <AvailabilityNote available={available} />
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
                Cách {product.name} xử lý dữ liệu trong bản hiện tại, cùng những
                điều cần biết trước khi đưa tài liệu vào trình duyệt.
              </p>
              <p className="info-date">Cập nhật ngày 8 tháng 11, 2026</p>
            </header>
            <div className="privacy-content">
              <Article id="luu-tru" title="Lưu trong trình duyệt">
                <p>
                  Editor dùng IndexedDB để lưu bài giảng, tài liệu nguồn và hình
                  ảnh trên thiết bị. Mã nguồn hiện tại chưa có tài khoản, kho
                  bài giảng đám mây hoặc đồng bộ giữa các máy.
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
                  Luồng nhập PDF, DOCX và PPTX đọc tệp cục bộ trong trình duyệt
                  và các worker của ứng dụng. Bản hiện tại không gửi tệp bài
                  giảng đến dịch vụ chuyển đổi hoặc AI. Các liên kết tài nguyên
                  ngoài trong tài liệu nhập bị chặn trong luồng được hỗ trợ.
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
                  Khi editor được mở, SDK tldraw có thể tải tài nguyên hoặc kiểm
                  tra giấy phép qua hạ tầng của tldraw. Hành vi phụ thuộc loại
                  giấy phép. Mã SDK đang dùng có thể gửi phiên bản SDK, loại/mã
                  giấy phép và URL trang cho một số trạng thái giấy phép.
                </p>
                <p>
                  Trang giới thiệu dùng ảnh và phông chữ lưu cùng website. Mã
                  nguồn hiện tại chưa tích hợp dịch vụ phân tích truy cập, quảng
                  cáo hoặc AI Tutor.
                </p>
                <p>
                  <a href="https://vercel.com/legal/privacy-policy">
                    Chính sách của Vercel
                  </a>{" "}
                  ·{" "}
                  <a href="https://tldraw.dev/sdk-features/license-key">
                    Thông tin giấy phép tldraw
                  </a>
                </p>
              </Article>
              <Article id="bao-ve" title="Chủ động giữ bài giảng">
                <p>
                  Tải bản sao trước khi dọn dữ liệu trình duyệt, đổi thiết bị
                  hoặc chuyển tên miền. Nếu dùng chung máy, cân nhắc ai có thể
                  mở lại hồ sơ trình duyệt đó. Ứng dụng hiện chưa có tài khoản
                  để phân quyền truy cập bài lưu cục bộ.
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
              <p className="info-note">
                Trang này mô tả cách xử lý dữ liệu của bản hiện tại. Chính sách
                pháp lý và điều khoản phát hành cần được chủ sản phẩm rà soát
                khi mở rộng dịch vụ.
              </p>
            </div>
          </>
        )}
      </main>
    </SiteLayout>
  );
}
