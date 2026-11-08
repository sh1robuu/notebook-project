import { Component, Suspense, lazy, useEffect } from "react";
import type { ReactNode } from "react";
import { LandingPage } from "./LandingPage.tsx";
import { RouteNotice } from "./RouteNotice.tsx";
import { product } from "../config/product.ts";
import { editorReleaseState } from "../config/release.ts";
import { isPublicPath, pageContent } from "./content.ts";
import { InfoPage } from "./InfoPage.tsx";
const Editor = lazy(() => import("../app/EditorEntry.tsx"));

export function SiteRouter() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const app = path === "/app";
  const state = editorReleaseState({
    production: import.meta.env.PROD,
    enabled: import.meta.env.VITE_EDITOR_RELEASE_ENABLED,
    licenseKey: import.meta.env.VITE_TLDRAW_LICENSE_KEY,
  });
  useEffect(() => {
    document.documentElement.lang = app ? "en" : "vi";
    document.title = isPublicPath(path)
      ? pageContent[path].title
      : app
        ? `${product.name} — Bảng giảng`
        : `${product.name} — Không tìm thấy trang`;
    if (!isPublicPath(path))
      document
        .querySelector('meta[name="robots"]')
        ?.setAttribute("content", "noindex, nofollow, noarchive");
  }, [path, app]);
  if (path === "/")
    return <LandingPage editorAvailable={state !== "unavailable"} />;
  if (isPublicPath(path) && path !== "/")
    return <InfoPage path={path} available={state !== "unavailable"} />;
  if (!app) return <RouteNotice kind="not-found" />;
  if (state === "unavailable") return <RouteNotice kind="unavailable" />;
  return (
    <LoadBoundary>
      <Suspense
        fallback={
          <main className="route-notice" lang="vi">
            <h1>Đang mở bảng giảng…</h1>
            <p role="status">Đang tải không gian của bạn.</p>
          </main>
        }
      >
        <Editor />
      </Suspense>
    </LoadBoundary>
  );
}
class LoadBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <RouteNotice kind="load-error" />
    ) : (
      this.props.children
    );
  }
}
