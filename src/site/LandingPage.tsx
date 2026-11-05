import { useEffect, useRef, useState } from "react";
import { product } from "../config/product.ts";
import { Showcase } from "./Showcase.tsx";

export function LandingPage({ editorAvailable }: { editorAvailable: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
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
    <div className="landing">
      <a className="skip-link" href="#noi-dung">
        Đến nội dung chính
      </a>
      <header className="site-header site-frame">
        <a
          href="/"
          className="wordmark"
          aria-label={`${product.name} — Trang chủ`}
        >
          <img src="/mark.svg" alt="" width={32} height={32} />
          <span translate="no">{product.name}</span>
        </a>
        <button
          className="menu-toggle"
          ref={menuButton}
          aria-expanded={menuOpen}
          aria-controls="site-navigation"
          aria-label={menuOpen ? "Đóng trình đơn" : "Mở trình đơn"}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "Đóng" : "Trình đơn"}
        </button>
        <nav
          id="site-navigation"
          aria-label="Điều hướng chính"
          className={menuOpen ? "site-nav is-open" : "site-nav"}
        >
          <a href="#tinh-nang" onClick={() => setMenuOpen(false)}>
            Tính năng
          </a>
          <a href="#cach-dung" onClick={() => setMenuOpen(false)}>
            Cách dùng
          </a>
          <a href="#lo-trinh" onClick={() => setMenuOpen(false)}>
            Lộ trình
          </a>
          <a className="site-button small-button" href="/app">
            Mở bảng giảng
          </a>
        </nav>
      </header>
      <main id="noi-dung">
        <section className="hero site-frame" aria-labelledby="hero-title">
          <div className="hero-heading">
            <h1 id="hero-title">
              Giảng theo
              <br />
              mạch riêng
            </h1>
          </div>
          <div className="hero-intro">
            <p>
              Bảng viết để phát triển lời giải, ghi chú trên tài liệu và giữ
              nháp bên cạnh bài giảng.
            </p>
            <a className="site-button" href="/app">
              Mở bảng giảng <Arrow />
            </a>
            <a className="quiet-link" href="#tinh-nang">
              Khám phá tính năng
            </a>
            <p className="release-note">
              {editorAvailable
                ? "Bản phát triển hiện tại. Bài giảng lưu trên trình duyệt của bạn."
                : "Bản giới thiệu hiện tại. Bảng giảng công khai đang chờ kích hoạt giấy phép."}
            </p>
          </div>
          <figure className="hero-picture" data-ui>
            <img
              src="/product/overview.webp"
              alt={`Bảng ${product.name} thực tế: hình tam giác, công thức diện tích và nét viết chú thích.`}
              width={1440}
              height={900}
              fetchPriority="high"
            />
            <figcaption>
              Một mặt bảng cho hình vẽ, công thức và lời giải của bạn.
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
              Một bài, nhiều cách giảng
            </h2>
            <p data-arrive>
              Chọn một góc nhìn để khám phá những gì bảng giảng hiện đã làm
              được.
            </p>
          </div>
          <Showcase />
        </section>
        <section
          className="scratch-section site-frame"
          aria-labelledby="scratch-title"
        >
          <div className="scratch-copy">
            <h2 id="scratch-title" data-arrive>
              Giữ mạch,
              <br />
              mở thêm nháp
            </h2>
            <p data-arrive>
              Bảng chính giữ bài giảng. Khung nháp có góc nhìn và lịch sử riêng
              để thử một hướng giải khác.
            </p>
            <p className="small-copy" data-arrive>
              Chuyển giữa hai mặt bảng, đổi vị trí hoặc điều chỉnh phần chia.
              Khi cần, dọn riêng khung nháp.
            </p>
          </div>
          <figure data-ui data-arrive>
            <img
              src="/product/scratchpad.webp"
              width={1440}
              height={900}
              loading="lazy"
              decoding="async"
              alt="Bảng chính giữ phép biến đổi, khung nháp bên phải có công thức và nét viết riêng."
            />
            <figcaption>
              Bài giảng và nháp độc lập, cùng trong tầm nhìn.
            </figcaption>
          </figure>
        </section>
        <section
          className="documents-section site-frame"
          aria-labelledby="documents-title"
        >
          <div className="section-heading">
            <h2 id="documents-title" data-arrive>
              Tài liệu thành bài giảng
            </h2>
            <p data-arrive>
              Bắt đầu từ tài liệu đã có. Thêm nét viết và lời giải theo cách bạn
              muốn trình bày.
            </p>
          </div>
          <div className="document-row">
            <figure data-ui data-arrive>
              <img
                src="/product/pdf.webp"
                width={1440}
                height={900}
                loading="lazy"
                decoding="async"
                alt="Trang PDF thật được mở trong ứng dụng với nét viết màu đỏ."
              />
            </figure>
            <div>
              <h3 data-arrive>Viết trực tiếp trên PDF</h3>
              <p data-arrive>
                Nhập các trang, ghi chú lên nền tài liệu và chọn văn bản nguồn
                khi PDF có lớp chữ. Bản quét chưa có nhận dạng chữ.
              </p>
              <p className="small-copy">
                Xuất trang, vùng hoặc bài giảng ra PNG/PDF trong phạm vi được hỗ
                trợ.
              </p>
            </div>
          </div>
          <div className="document-row word-row">
            <figure data-ui data-arrive>
              <img
                src="/product/word.webp"
                width={1440}
                height={900}
                loading="lazy"
                decoding="async"
                alt="Tài liệu Word đã biên soạn với công thức OMML và công cụ giảng từng khối."
              />
            </figure>
            <div>
              <h3 data-arrive>Chỉnh nguồn, rồi trình bày</h3>
              <p data-arrive>
                Word Terminal cho phép sửa văn bản, bảng và công thức OMML được
                hỗ trợ. Biên soạn thành từng khối, rồi lần lượt hé lộ khi giảng.
              </p>
              <p className="small-copy">
                Bố cục Word chưa được giữ hoàn toàn. MathType cũ chưa chuyển
                thành công thức chỉnh sửa được.
              </p>
            </div>
          </div>
        </section>
        <section
          className="workflow-section"
          id="cach-dung"
          aria-labelledby="workflow-title"
        >
          <div className="site-frame workflow-inner">
            <h2 id="workflow-title" data-arrive>
              Từ ý tưởng
              <br />
              đến buổi sau
            </h2>
            <ol className="workflow-list">
              <li data-arrive>
                <h3>Mở không gian</h3>
                <p>
                  Vào bảng giảng trong trình duyệt. Bài đã lưu trên cùng thiết
                  bị được khôi phục tại đây.
                </p>
              </li>
              <li data-arrive>
                <h3>Chuẩn bị chất liệu</h3>
                <p>
                  Tạo trang mới, nhập PDF hoặc kiểm tra một DOCX trước khi đưa
                  vào bài.
                </p>
              </li>
              <li data-arrive>
                <h3>Viết và giải thích</h3>
                <p>
                  Viết tay, đánh dấu, thêm hình và công thức. Mở nháp khi cần
                  thử một ý khác.
                </p>
              </li>
              <li data-arrive>
                <h3>Giữ một bản riêng</h3>
                <p>
                  Lưu trên thiết bị hoặc tải tệp bài giảng để sao lưu. PNG/PDF
                  là bản trình bày để chia sẻ.
                </p>
              </li>
              <li data-arrive>
                <h3>Mở lại, tiếp tục</h3>
                <p>
                  Trở lại cùng trình duyệt, hoặc khôi phục tệp bài giảng khi
                  chuyển máy hay đổi địa chỉ website.
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
          <div className="section-heading">
            <h2 id="status-title" data-arrive>
              Đang làm đến đâu?
            </h2>
            <p data-arrive>
              Một sản phẩm đang được hoàn thiện, với phạm vi hiện tại được nói
              rõ.
            </p>
          </div>
          <div className="status-columns">
            <div data-arrive>
              <h3>Đã có trong bản phát triển</h3>
              <ul>
                <li>Viết, xóa, chọn và chỉnh đối tượng</li>
                <li>Trang bài giảng và nháp độc lập</li>
                <li>Ghi chú PDF, Word/OMML được hỗ trợ</li>
                <li>Lưu cục bộ, tệp bài giảng và xuất ảnh/PDF</li>
              </ul>
            </div>
            <div data-arrive>
              <h3>Đang hoàn thiện</h3>
              <ul>
                <li>Bố cục Word và phương trình cũ</li>
                <li>Kiểm thử bút, cảm ứng và bộ gõ trên thiết bị thật</li>
                <li>Bộ nhớ khi mở lại bài lớn nhiều lần</li>
                <li>Giấy phép cho bảng giảng công khai</li>
              </ul>
            </div>
            <div data-arrive>
              <h3>Trong lộ trình</h3>
              <ul>
                <li>PowerPoint và công cụ đồ thị</li>
                <li>GeoGebra và mô phỏng</li>
                <li>GroupHub, Live Quiz và tương tác lớp học</li>
                <li>AI Tutor và các quy trình đánh giá</li>
              </ul>
            </div>
          </div>
          <div className="storage-note">
            <p>
              Bài giảng hiện lưu trong trình duyệt, chưa đồng bộ đám mây. Hãy
              tải tệp bài giảng để giữ bản sao; đổi trình duyệt hoặc tên miền
              không tự chuyển dữ liệu.
            </p>
          </div>
        </section>
        <section
          className="closing-section site-frame"
          aria-labelledby="closing-title"
        >
          <h2 id="closing-title" data-arrive>
            Bắt đầu từ
            <br />
            một nét viết
          </h2>
          <div>
            <p data-arrive>
              Chuẩn bị chất liệu, để phần giảng giải thuộc về bạn.
            </p>
            <a className="site-button" href="/app">
              Mở bảng giảng <Arrow />
            </a>
            {!editorAvailable && (
              <p className="small-copy">
                Bảng giảng công khai sẽ mở sau khi hoàn tất kích hoạt giấy phép.
                Hiện bạn có thể xem các tính năng ở trên.
              </p>
            )}
          </div>
        </section>
      </main>
      <footer className="site-footer site-frame">
        <div>
          <a href="#tinh-nang">Khám phá tính năng</a>
          <a href="#lo-trinh">Trạng thái sản phẩm</a>
          <a href="/fonts/OFL.txt">Giấy phép phông chữ</a>
        </div>
        <p>Công cụ giảng dạy đang phát triển. Lưu trên thiết bị của bạn.</p>
        <p className="footer-name" translate="no">
          {product.name}
        </p>
      </footer>
    </div>
  );
}
function Arrow() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M4 12h15M13 5l7 7-7 7" />
    </svg>
  );
}
