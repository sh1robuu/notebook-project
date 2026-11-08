import { useEffect } from "react";
import { product } from "../config/product.ts";
import { questions } from "./content.ts";
import { Showcase } from "./Showcase.tsx";
import {
  SiteLayout,
  EditorAction,
  AvailabilityNote,
  Arrow,
} from "./SiteLayout.tsx";
import { ProductImage } from "./ProductImage.tsx";

export function LandingPage({ editorAvailable }: { editorAvailable: boolean }) {
  useEffect(() => {
    if (
      !("IntersectionObserver" in window) ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("arrived");
            observer.unobserve(entry.target);
          }
      },
      { threshold: 0.08 },
    );
    document
      .querySelectorAll("[data-arrive]")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return (
    <SiteLayout available={editorAvailable} home>
      <main id="noi-dung">
        <section className="hero site-frame" aria-labelledby="hero-title">
          <div className="hero-heading">
            <h1 id="hero-title">
              Giảng theo
              <br />
              mạch riêng.
            </h1>
          </div>
          <div className="hero-intro">
            <p>
              Một bảng viết để giảng bài, ghi chú tài liệu và mở thêm nháp. Giữ
              mọi ý tưởng trong một bài giảng của bạn.
            </p>
            <div className="hero-actions">
              <EditorAction available={editorAvailable} />
              <a className="text-link" href="#tinh-nang">
                Khám phá tính năng <Arrow />
              </a>
            </div>
            <AvailabilityNote available={editorAvailable} />
          </div>
          <figure className="hero-picture" data-ui>
            <div className="product-window">
              <div className="product-window-bar" aria-hidden="true">
                <span />
                <span />
                <span />
                <p>{product.name} · Không gian bài giảng</p>
              </div>
              <ProductImage
                name="overview"
                hero
                alt="Bảng Lessonboard thực tế với hình tam giác, công thức diện tích và nét viết giải thích."
              />
            </div>
            <figcaption>
              Hình vẽ, công thức và nét viết cùng trên một mặt bảng.
            </figcaption>
          </figure>
        </section>

        <section
          className="showcase-section site-frame"
          id="tinh-nang"
          aria-labelledby="showcase-title"
        >
          <div className="section-heading">
            <h2 id="showcase-title" data-arrive>
              Một bài, nhiều cách giảng.
            </h2>
            <p data-arrive>
              Chọn một góc nhìn từ ứng dụng đang hoạt động. Mỗi công cụ có chỗ
              trong mạch giải thích.
            </p>
          </div>
          <Showcase />
        </section>

        <section className="scratch-section" aria-labelledby="scratch-title">
          <div className="site-frame scratch-inner">
            <div className="scratch-copy">
              <h2 id="scratch-title" data-arrive>
                Giữ mạch.
                <br />
                Thêm nháp.
              </h2>
              <p data-arrive>
                Giữ nội dung chính trong tầm nhìn, rồi thử một hướng giải khác
                ngay bên cạnh.
              </p>
              <p className="small-copy" data-arrive>
                Khung nháp có góc nhìn và lịch sử hoàn tác riêng. Điều chỉnh
                phần chia hoặc dọn riêng nháp khi cần.
              </p>
              <a className="text-link" href="/help#nhap" data-arrive>
                Cách dùng khung nháp <Arrow />
              </a>
            </div>
            <figure data-ui data-arrive>
              <ProductImage
                name="scratchpad"
                alt="Bảng chính và nháp độc lập được mở cạnh nhau, mỗi bên có nội dung toán học và nét viết riêng."
              />
              <figcaption>
                Hai mặt bảng, hai cách triển khai một lời giải.
              </figcaption>
            </figure>
          </div>
        </section>

        <section
          className="documents-section site-frame"
          aria-labelledby="documents-title"
        >
          <div className="section-heading">
            <h2 id="documents-title" data-arrive>
              Bắt đầu từ tài liệu.
            </h2>
            <p data-arrive>
              Đưa nội dung đã có vào buổi học. Kiểm tra phần được hỗ trợ, rồi
              viết tiếp lời giải lên trên.
            </p>
          </div>
          <div className="document-row">
            <figure data-ui data-arrive>
              <ProductImage
                name="pdf"
                alt="Tài liệu PDF thực tế trong Lessonboard với nét viết chú thích trên trang."
              />
            </figure>
            <div className="document-copy">
              <h3 data-arrive>Đọc, đánh dấu, giải thích.</h3>
              <p data-arrive>
                Nhập PDF làm nền và dùng các công cụ viết quen thuộc. Tài liệu
                gốc và phần chú thích được giữ riêng.
              </p>
              <p className="small-copy" data-arrive>
                Chọn văn bản khi PDF có lớp chữ. Bản quét chưa có OCR; các thành
                phần tương tác không được giữ trong bản xuất.
              </p>
              <a className="text-link" href="/help#tai-lieu" data-arrive>
                Xem định dạng hỗ trợ <Arrow />
              </a>
            </div>
          </div>
          <div className="format-notes">
            <article data-arrive>
              <h3>Word & công thức</h3>
              <p>
                Word Terminal chỉnh văn bản, bảng và công thức OMML được hỗ trợ.
                Biên soạn thành từng khối để hé lộ khi giảng.
              </p>
              <p className="small-copy">
                Bố cục Word và MathType cũ còn giới hạn.
              </p>
            </article>
            <article data-arrive>
              <h3>PowerPoint từng bước</h3>
              <p>
                Nhập PPTX, giữ thứ tự slide và trình bày các build được hỗ trợ.
                Nét viết trên slide tiếp tục chỉnh sửa được.
              </p>
              <p className="small-copy">
                Bản thử nghiệm. Phông chữ, media và hiệu ứng phức tạp có cảnh
                báo.
              </p>
            </article>
          </div>
        </section>

        <section
          className="workflow-section"
          id="cach-dung"
          aria-labelledby="workflow-title"
        >
          <div className="site-frame workflow-inner">
            <div>
              <h2 id="workflow-title" data-arrive>
                Chuẩn bị một lần.
                <br />
                Tiếp tục buổi sau.
              </h2>
              <p data-arrive>
                Editor hiện lưu ngay trong trình duyệt. Tệp bài giảng giúp bạn
                giữ một bản riêng để mở lại.
              </p>
              <a className="text-link" href="/help" data-arrive>
                Hướng dẫn bắt đầu <Arrow />
              </a>
            </div>
            <ol className="workflow-list">
              <li data-arrive>
                <h3>Mở không gian</h3>
                <p>
                  Trở lại bài đã lưu trên cùng trình duyệt hoặc mở một tệp
                  .teachboard.
                </p>
              </li>
              <li data-arrive>
                <h3>Thêm chất liệu</h3>
                <p>
                  Tạo trang, thêm hình và công thức hoặc xem trước tài liệu muốn
                  nhập.
                </p>
              </li>
              <li data-arrive>
                <h3>Viết & trình bày</h3>
                <p>
                  Phát triển lời giải, mở nháp và chuyển giữa các trang theo
                  nhịp giảng.
                </p>
              </li>
              <li data-arrive>
                <h3>Giữ một bản riêng</h3>
                <p>
                  Tải tệp bài giảng để sao lưu. Dùng PNG/PDF khi muốn chia sẻ
                  bản trình bày.
                </p>
              </li>
            </ol>
          </div>
        </section>

        <section
          className="status-section site-frame"
          id="lo-trinh"
          aria-labelledby="status-title"
        >
          <div className="release-status-heading">
            <h2 id="status-title" data-arrive>
              Đang mở từng phần.
            </h2>
            <p data-arrive>
              Preview Release. Lessonboard được phát triển và phát hành từng
              bước. Bạn có thể xem rõ những gì đã có và giới hạn của từng phần.
            </p>
          </div>
          <div className="release-state" data-arrive>
            <span className="status-indicator" aria-hidden="true" />
            <div>
              <h3>
                {editorAvailable
                  ? "Bảng giảng đang mở"
                  : "Website đã mở. Editor đang chuẩn bị."}
              </h3>
              <p>
                {editorAvailable
                  ? "Các công cụ hiện có chạy trong trình duyệt. Một số định dạng tài liệu vẫn ở mức thử nghiệm."
                  : "Ảnh trên website được chụp từ bản phát triển. Editor công khai cần giấy phép hợp lệ trước khi có thể mở."}
              </p>
              <a className="text-link" href="/updates">
                Theo dõi cập nhật <Arrow />
              </a>
            </div>
          </div>
          <div className="storage-note" data-arrive>
            <p>
              Bài giảng lưu tại thiết bị, chưa đồng bộ đám mây. Đổi trình duyệt,
              thiết bị hoặc tên miền cần khôi phục bằng tệp bài giảng.
            </p>
            <a className="text-link" href="/privacy">
              Tìm hiểu về dữ liệu <Arrow />
            </a>
          </div>
        </section>

        <section
          className="faq-section site-frame"
          id="cau-hoi"
          aria-labelledby="faq-title"
        >
          <div className="faq-heading">
            <h2 id="faq-title" data-arrive>
              Trước khi bắt đầu.
            </h2>
            <p data-arrive>Một vài điều về cách dùng và dữ liệu của bạn.</p>
            <a className="text-link" href="/help">
              Đọc hướng dẫn <Arrow />
            </a>
          </div>
          <div className="faq-list">
            {questions.map((q) => (
              <details key={q.title}>
                <summary>
                  {q.title}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{q.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="closing-section" aria-labelledby="closing-title">
          <div className="site-frame closing-inner">
            <h2 id="closing-title" data-arrive>
              Bắt đầu từ
              <br />
              một nét viết.
            </h2>
            <div>
              <p data-arrive>
                Chuẩn bị chất liệu, để phần giảng giải thuộc về bạn.
              </p>
              <EditorAction available={editorAvailable} />
              <AvailabilityNote available={editorAvailable} />
            </div>
          </div>
        </section>
      </main>
    </SiteLayout>
  );
}
