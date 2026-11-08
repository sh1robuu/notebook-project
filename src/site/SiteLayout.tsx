import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { product } from "../config/product.ts";

export function Arrow() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

export function EditorAction({
  available,
  small = false,
}: {
  available: boolean;
  small?: boolean;
}) {
  return (
    <a
      className={small ? "site-button small-button" : "site-button"}
      href="/app"
    >
      {available ? "Mở bảng giảng" : "Xem trạng thái bảng giảng"} <Arrow />
    </a>
  );
}

export function SiteLayout({
  children,
  available,
  home = false,
}: {
  children: ReactNode;
  available: boolean;
  home?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  return (
    <div className={home ? "site landing" : "site public-page"}>
      <a className="skip-link" href="#noi-dung">
        Đến nội dung chính
      </a>
      <header className="site-header site-frame">
        <a
          className="wordmark"
          href="/"
          aria-label={product.name + " — Trang chủ"}
        >
          <img src="/mark.svg" alt="" width="32" height="32" />
          <span translate="no">{product.name}</span>
        </a>
        <button
          className="menu-toggle"
          ref={menuButton}
          aria-expanded={menuOpen}
          aria-controls="site-navigation"
          aria-label={menuOpen ? "Đóng trình đơn" : "Mở trình đơn"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? "Đóng" : "Trình đơn"}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path
              d={menuOpen ? "m6 6 12 12M6 18 18 6" : "M4 7h16M4 12h16M4 17h16"}
            />
          </svg>
        </button>
        <nav
          id="site-navigation"
          className={menuOpen ? "site-nav is-open" : "site-nav"}
          aria-label="Điều hướng chính"
        >
          <a href="/#tinh-nang" onClick={() => setMenuOpen(false)}>
            Tính năng
          </a>
          <a href="/help" onClick={() => setMenuOpen(false)}>
            Cách sử dụng
          </a>
          <EditorAction available={available} small />
        </nav>
      </header>
      {children}
      <footer className="site-footer site-frame">
        <div className="footer-top">
          <div>
            <a className="wordmark" href="/">
              <img src="/mark.svg" width="28" height="28" alt="" />
              {product.name}
            </a>
            <p>Bảng viết, tài liệu và nháp cho mỗi buổi dạy.</p>
          </div>
          <nav aria-label="Liên kết cuối trang">
            <a href="/#tinh-nang">Tính năng</a>
            <a href="/help">Bắt đầu sử dụng</a>
            <a href="/privacy">Dữ liệu & quyền riêng tư</a>
          </nav>
        </div>
        <div className="footer-bottom">
          <p>{product.name}</p>
          <p>Bài giảng tự động lưu trong trình duyệt.</p>
        </div>
      </footer>
    </div>
  );
}
