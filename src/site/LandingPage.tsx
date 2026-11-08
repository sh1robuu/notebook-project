import { useEffect } from "react";
import { product } from "../config/product.ts";
import { Showcase } from "./Showcase.tsx";
import { SiteLayout, EditorAction, Arrow } from "./SiteLayout.tsx";
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
              Bảng viết
              <br />
              cho bài giảng.
            </h1>
          </div>
          <div className="hero-intro">
            <p>
              Viết bài, mở tài liệu và giải thích ngay trên bảng. Có thêm khung
              nháp bên cạnh khi cần tính toán hoặc thử cách giải khác.
            </p>
            <div className="hero-actions">
              <EditorAction available={editorAvailable} />
              <a className="text-link" href="#tinh-nang">
                Xem tính năng <Arrow />
              </a>
            </div>
          </div>
          <figure className="hero-picture" data-ui>
            <div className="product-window">
              <div className="product-window-bar" aria-hidden="true">
                <span />
                <span />
                <span />
                <p>{product.name} · Bảng giảng</p>
              </div>
              <ProductImage
                name="overview"
                hero
                alt="Bảng Lessonboard với hình tam giác, công thức diện tích và nét viết giải thích."
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
              Các công cụ cho bài giảng.
            </h2>
            <p data-arrive>
              Viết tay, ghi chú tài liệu hoặc trình chiếu slide mà không cần rời
              bảng.
            </p>
          </div>
          <Showcase />
        </section>

        <section className="scratch-section" aria-labelledby="scratch-title">
          <div className="site-frame scratch-inner">
            <div className="scratch-copy">
              <h2 id="scratch-title" data-arrive>
                Mở thêm
                <br />
                bảng nháp.
              </h2>
              <p data-arrive>
                Để bài giảng ở bảng chính, dùng nháp cho phép tính phụ hoặc một
                cách giải khác.
              </p>
              <p className="small-copy" data-arrive>
                Phóng to, hoàn tác và xóa nháp riêng mà không ảnh hưởng đến bảng
                chính.
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
                Đổi trang bài giảng vẫn giữ nguyên phần nháp.
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
              Dùng ngay tài liệu đã có.
            </h2>
            <p data-arrive>
              Mở PDF, Word hoặc PowerPoint, rồi thêm ghi chú và lời giải của
              bạn.
            </p>
          </div>
          <div className="document-row">
            <figure data-ui data-arrive>
              <ProductImage
                name="pdf"
                alt="Tài liệu PDF trong Lessonboard với nét viết chú thích trên trang."
              />
            </figure>
            <div className="document-copy">
              <h3 data-arrive>Viết trực tiếp trên PDF</h3>
              <p data-arrive>
                Đánh dấu đề bài, ghi chú bên lề hoặc viết lời giải lên trang.
                Bạn có thể sửa phần viết thêm mà không đổi tài liệu gốc.
              </p>
              <p className="small-copy" data-arrive>
                Chọn và sao chép chữ trong PDF có văn bản.
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
                Sửa văn bản, bảng và công thức trong tài liệu Word. Chia bài
                thành từng phần để lần lượt hiện khi giảng.
              </p>
            </article>
            <article data-arrive>
              <h3>PowerPoint từng bước</h3>
              <p>
                Chuyển slide, hiện nội dung từng bước và ghi chú ngay khi trình
                chiếu. Các nét viết được lưu cùng bài giảng.
              </p>
            </article>
          </div>
        </section>

        <section className="closing-section" aria-labelledby="closing-title">
          <div className="site-frame closing-inner">
            <h2 id="closing-title" data-arrive>
              Mở bảng.
              <br />
              Giảng bài.
            </h2>
            <div>
              <p data-arrive>
                Bài giảng tự động lưu trong trình duyệt. Tải một bản sao để mở
                lại trên máy khác hoặc xuất PNG, PDF để gửi cho học sinh.
              </p>
              <EditorAction available={editorAvailable} />
            </div>
          </div>
        </section>
      </main>
    </SiteLayout>
  );
}
