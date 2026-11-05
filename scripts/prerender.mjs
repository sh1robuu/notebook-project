// Build-time HTML only. No editor, lesson database or browser session is opened.
import { createServer, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, writeFile } from "node:fs/promises";
import { product } from "../src/config/product.ts";
import { editorReleaseState } from "../src/config/release.ts";
const env = loadEnv("production", process.cwd(), "VITE_");
const available =
  editorReleaseState({
    production: true,
    enabled: env.VITE_EDITOR_RELEASE_ENABLED,
    licenseKey: env.VITE_TLDRAW_LICENSE_KEY,
  }) === "enabled";
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
try {
  const { renderLanding } = await server.ssrLoadModule(
    "/src/site/prerender.tsx",
  );
  let html = await readFile("dist/index.html", "utf8");
  html = html.replace(
    /<div id="root">.*?<\/div>/s,
    `<div id="root" data-prerender="landing">${renderLanding(available)}</div>`,
  );
  html = html.replace(
    /<title>.*?<\/title>/,
    `<title>${escape(product.title)}</title>`,
  );
  html = html.replace(
    /(<meta\s+name="description"\s+content=")[^"]*(")/s,
    `$1${escape(product.description)}$2`,
  );
  html = html.replace(
    /(<meta\s+property="og:title"\s+content=")[^"]*(")/s,
    `$1${escape(product.title)}$2`,
  );
  let origin;
  try {
    const url = new URL(env.VITE_SITE_URL);
    if (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    )
      origin = url.origin;
  } catch {
    /* Final domain is optional, never guessed. */
  }
  if (origin) {
    html = html
      .replace(
        "</head>",
        `<link rel="canonical" href="${origin}/"><meta property="og:url" content="${origin}/"></head>`,
      )
      .replace(
        'content="/product/overview.webp"',
        `content="${origin}/product/overview.webp"`,
      );
    await writeFile(
      "dist/sitemap.xml",
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>`,
    );
    const robots = await readFile("dist/robots.txt", "utf8");
    await writeFile(
      "dist/robots.txt",
      robots + `\nSitemap: ${origin}/sitemap.xml\n`,
    );
  }
  await writeFile("dist/index.html", html);
  const notFound = await readFile("dist/404.html", "utf8");
  await writeFile(
    "dist/404.html",
    notFound.replaceAll("Lessonboard", escape(product.name)),
  );
  console.log(
    "Prerendered Vietnamese landing; canonical/sitemap " +
      (origin ? "configured" : "omitted (domain unknown)") +
      ".",
  );
} finally {
  await server.close();
}
