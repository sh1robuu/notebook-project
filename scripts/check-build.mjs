import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { gzipSync, brotliCompressSync } from "node:zlib";
import path from "node:path";
async function walk(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory()
          ? walk(path.join(dir, e.name))
          : [path.join(dir, e.name)],
      ),
    )
  ).flat();
}
const files = await walk("dist"),
  html = await readFile("dist/index.html", "utf8");
const invalid = files.filter(
  (f) =>
    /\.(map|zip|teachboard|docx|pdf|log|ts|tsx)$/.test(f) ||
    /(^|[\\/])(tests|experiments|docs|\.recovery|\.env[^\\/]*)[\\/]/.test(f),
);
if (invalid.length)
  throw new Error("Development/private output present: " + invalid.join(","));
if (!html.includes('data-prerender="landing"') || !html.includes("Giảng theo"))
  throw new Error("Landing HTML was not prerendered");
const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
if (!entry) throw new Error("No built landing entry");
const bytes = await readFile("dist" + entry);
if (/EditorEntry/.test(html))
  throw new Error("Editor was preloaded by landing HTML");
const workers = files.filter((f) => /worker.*\.(mjs|js)$/.test(f));
if (workers.length < 5) throw new Error("Required document workers missing");
for (const file of [
  "dist/pdfjs/wasm/qcms_bg.wasm",
  "dist/pdfjs/wasm/openjpeg.wasm",
  "dist/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
  "dist/product/overview.webp",
])
  await stat(file);
const config = JSON.parse(await readFile("vercel.json", "utf8"));
if (config.rewrites.some((r) => !["/app", "/app/:path*"].includes(r.source)))
  throw new Error("Unexpected broad route rewrite");
const result = {
  distFiles: files.length,
  totalDistBytes: (await Promise.all(files.map((f) => stat(f)))).reduce(
    (s, f) => s + f.size,
    0,
  ),
  landingEntry: {
    file: entry,
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    brotliBytes: brotliCompressSync(bytes).length,
  },
  workerFiles: workers.map((f) => f.replaceAll("\\", "/")),
  sourceMaps: 0,
  privateOrDevelopmentOutputs: invalid,
  prerendered: true,
  domainKnown: /rel="canonical"/.test(html),
  note: "File/bundle measurements, not CDN transfer or physical-device performance. The heavy editor remains lazy, not removed.",
};
await writeFile(
  "docs/verification/deploy-01/build-audit.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
