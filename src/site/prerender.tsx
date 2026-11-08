import { renderToString } from "react-dom/server";
import { LandingPage } from "./LandingPage.tsx";
import { InfoPage } from "./InfoPage.tsx";
import { isPublicPath } from "./content.ts";
import { RouteNotice } from "./RouteNotice.tsx";
export function renderLanding(editorAvailable: boolean) {
  return renderToString(<LandingPage editorAvailable={editorAvailable} />);
}
export function renderSite(path: string, editorAvailable: boolean) {
  if (path === "/") return renderLanding(editorAvailable);
  if (isPublicPath(path) && path !== "/")
    return renderToString(<InfoPage path={path} available={editorAvailable} />);
  if (path === "/app" && editorAvailable)
    return renderToString(
      <main className="route-notice" lang="vi">
        <h1>Đang mở bảng giảng…</h1>
        <p role="status">Đang tải không gian của bạn.</p>
      </main>,
    );
  return renderToString(
    <RouteNotice kind={path === "/app" ? "unavailable" : "not-found"} />,
  );
}
