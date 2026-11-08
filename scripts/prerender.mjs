// Static HTML only. The drawing engine and lesson storage never run at build time.
import { createServer, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, writeFile } from "node:fs/promises";
import { product } from "../src/config/product.ts";
import { editorReleaseState } from "../src/config/release.ts";
import { publicPaths, pageContent } from "../src/site/content.ts";
const env = {
  ...loadEnv("production", process.cwd(), "VITE_"),
  ...process.env,
};
const available =
  editorReleaseState({
    production: true,
    enabled: env.VITE_EDITOR_RELEASE_ENABLED,
    licenseKey: env.VITE_TLDRAW_LICENSE_KEY,
  }) === "enabled";
const preview = env.VERCEL_ENV === "preview";
const server = await createServer({
  configFile: false,
  plugins: [react()],
  mode: "production",
  server: { middlewareMode: true },
  appType: "custom",
});
const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
function siteOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    )
      return url.origin;
  } catch {
    /* Invalid configured origins do not become canonical URLs. */
  }
}
try {
  const { renderSite } = await server.ssrLoadModule("/src/site/prerender.tsx");
  const template = await readFile("dist/index.html", "utf8");
  const origin = siteOrigin(env.VITE_SITE_URL || product.siteUrl);
  for (const path of [...publicPaths, "/app", "/404"]) {
    const isPublic = publicPaths.includes(path);
    const metadata = isPublic
      ? pageContent[path]
      : {
          title:
            path === "/app"
              ? product.name + " — Bảng giảng"
              : "Không tìm thấy trang — " + product.name,
          description:
            path === "/app"
              ? "Trạng thái mở bảng giảng Lessonboard."
              : "Địa chỉ này chưa có nội dung.",
        };
    const robots =
      isPublic && !preview ? "index, follow" : "noindex, nofollow, noarchive";
    const canonical =
      isPublic && origin ? origin + (path === "/" ? "/" : path) : undefined;
    let html = template
      .replace(
        /<div id="root">.*?<\/div>/s,
        '<div id="root" data-prerender-path="' +
          path +
          '">' +
          renderSite(path, available) +
          "</div>",
      )
      .replace(
        /<title>.*?<\/title>/,
        "<title>" + escape(metadata.title) + "</title>",
      )
      .replace(
        /(<meta\s+name="description"\s+content=")[^"]*(")/s,
        "$1" + escape(metadata.description) + "$2",
      )
      .replace(
        /(<meta\s+name="robots"\s+content=")[^"]*(")/s,
        "$1" + robots + "$2",
      )
      .replace(
        /(<meta\s+property="og:title"\s+content=")[^"]*(")/s,
        "$1" + escape(metadata.title) + "$2",
      )
      .replace(
        /(<meta\s+property="og:description"\s+content=")[^"]*(")/s,
        "$1" + escape(metadata.description) + "$2",
      );
    if (origin)
      html = html.replace(
        'content="/product/overview.webp"',
        'content="' + origin + '/product/overview.webp"',
      );
    if (canonical)
      html = html.replace(
        "</head>",
        '<link rel="canonical" href="' +
          escape(canonical) +
          '"><meta property="og:url" content="' +
          escape(canonical) +
          '"></head>',
      );
    const file =
      path === "/" ? "index" : path === "/app" ? "editor" : path.slice(1);
    await writeFile("dist/" + file + ".html", html);
  }
  await writeFile(
    "dist/robots.txt",
    "User-agent: *\nAllow: /\nDisallow: /app\n" +
      (origin && !preview ? "\nSitemap: " + origin + "/sitemap.xml\n" : ""),
  );
  if (origin)
    await writeFile(
      "dist/sitemap.xml",
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        publicPaths
          .map(
            (path) =>
              "<url><loc>" +
              escape(origin + (path === "/" ? "/" : path)) +
              "</loc></url>",
          )
          .join("") +
        "</urlset>",
    );
  console.log(
    "Prerendered four public pages, editor status and 404; production origin " +
      (origin || "omitted") +
      ".",
  );
} finally {
  await server.close();
}
