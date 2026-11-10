import { Component, Suspense, lazy, useEffect } from "react";
import type { ReactNode } from "react";
import { LandingPage } from "./LandingPage.tsx";
import { RouteNotice } from "./RouteNotice.tsx";
import { product } from "../config/product.ts";
import { editorReleaseState, getEditorLicenseKey } from "../config/release.ts";
import { isPublicPath, pageContent } from "./content.ts";
import { InfoPage } from "./InfoPage.tsx";
import { classroomEnabled } from "../config/classroom.ts";
const Editor = lazy(() => import("../app/EditorEntry.tsx"));
const Classroom = lazy(() => import("./classroom/ClassroomRoute.tsx"));

export function SiteRouter() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const app = path === "/app";
  const classroom =
    classroomEnabled && (path === "/classroom" || path === "/join");
  const state = editorReleaseState({
    production: import.meta.env.PROD,
    licenseKey: getEditorLicenseKey(import.meta.env.VITE_TLDRAW_LICENSE_KEY),
  });
  useEffect(() => {
    document.documentElement.lang = app ? "en" : "vi";
    document.title = isPublicPath(path)
      ? pageContent[path].title
      : classroom
        ? `${product.name} — ${path === "/join" ? "Tham gia lớp học" : "GroupHub"}`
        : app
          ? `${product.name} — Bảng giảng`
          : `${product.name} — Không tìm thấy trang`;
    if (!isPublicPath(path))
      document
        .querySelector('meta[name="robots"]')
        ?.setAttribute("content", "noindex, nofollow, noarchive");
  }, [path, app, classroom]);
  if (path === "/")
    return <LandingPage editorAvailable={state !== "unavailable"} />;
  if (isPublicPath(path) && path !== "/")
    return <InfoPage path={path} available={state !== "unavailable"} />;
  if (classroom) {
    return (
      <LoadBoundary>
        <Suspense
          fallback={
            <main className="route-notice" lang="vi">
              <h1>Đang mở GroupHub…</h1>
            </main>
          }
        >
          <Classroom student={path === "/join"} />
        </Suspense>
      </LoadBoundary>
    );
  }
  if (!app) return <RouteNotice kind="not-found" />;
  if (state === "unavailable") return <RouteNotice kind="unavailable" />;
  return (
    <LoadBoundary>
      <Suspense
        fallback={
          <main className="route-notice" lang="vi">
            <h1>Đang mở bảng giảng…</h1>
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
