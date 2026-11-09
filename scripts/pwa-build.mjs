import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { build as viteBuild } from "vite";
import { offlineAssetGroup } from "../src/modules/pwa/policy.ts";
import { APP_VERSION, WORKSPACE_SCHEMA_VERSION } from "../src/config/version.ts";

const root = path.resolve(process.argv[2] ?? "dist");
const editorFile = path.join(root, "editor.html");
const workerSource = path.resolve("src/modules/pwa/sw.ts");
async function scan(directory, groups) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await scan(file, groups);
    else {
      const url = file === editorFile ? "/app" : "/" + path.relative(root, file).split(path.sep).join("/");
      const group = offlineAssetGroup(url);
      if (!group) continue;
      const data = await readFile(file);
      const hash = createHash("sha256").update(data).digest();
      groups[group].push({
        url,
        revision: hash.toString("hex"),
        integrity: "sha256-" + hash.toString("base64"),
        bytes: data.length,
      });
    }
  }
}
async function assets() {
  const groups = { core: [], pdf: [] };
  await scan(root, groups);
  for (const entries of Object.values(groups)) entries.sort((a, b) => a.url.localeCompare(b.url));
  return groups;
}
const total = (entries) => entries.reduce((sum, entry) => sum + entry.bytes, 0);
const html = (await readFile(editorFile, "utf8"))
  .replace(/<meta name="lessonboard-build" content="[a-f0-9]{20}">/g, "");
if (!html.includes("</head>")) throw new Error("Editor prerender is missing its HTML head.");
await writeFile(editorFile, html);
const buildId = createHash("sha256")
  .update(JSON.stringify([await assets(), APP_VERSION, WORKSPACE_SCHEMA_VERSION]))
  .update(await readFile(workerSource))
  .update(await readFile("src/modules/pwa/policy.ts"))
  .digest("hex").slice(0, 20);
await writeFile(editorFile, html.replace("</head>", `<meta name="lessonboard-build" content="${buildId}"></head>`));
const groups = await assets();
if (total(groups.core) > 25_000_000 || total(groups.pdf) > 12_000_000)
  throw new Error("Offline runtime assets exceed the reviewed cache budget.");
for (const url of ["/app", "/manifest.webmanifest", "/icons/app-192.png", "/icons/app-512.png", "/icons/app-maskable-512.png"]) {
  if (!groups.core.some((asset) => asset.url === url)) throw new Error(`Missing offline asset ${url}.`);
}
const workerUrls = groups.core.map((asset) => asset.url).filter((url) => url.startsWith("/app/runtime/"));
if (["pdf.worker", "archive.worker", "math.worker", "interactive-import.worker"].some((name) =>
      !workerUrls.some((url) => url.startsWith(`/app/runtime/${name}`))) ||
    groups.core.filter((asset) => asset.url.startsWith("/tldraw/fonts/")).length !== 16 ||
    ["cmaps", "standard_fonts", "wasm", "iccs"].some((directory) =>
      !groups.pdf.some((asset) => asset.url.startsWith(`/pdfjs/${directory}/`))))
  throw new Error("Missing offline fonts, PDF worker or resource directories.");
const metadata = {
  protocol: 1,
  buildId,
  appVersion: APP_VERSION,
  databaseVersion: WORKSPACE_SCHEMA_VERSION,
  coreBytes: total(groups.core),
  pdfBytes: total(groups.pdf),
  coreCount: groups.core.length,
  pdfCount: groups.pdf.length,
};
const bundle = await viteBuild({
  configFile: false,
  define: {
    __PWA_CORE_ASSETS__: JSON.stringify(groups.core),
    __PWA_PDF_ASSETS__: JSON.stringify(groups.pdf),
    __PWA_BUILD__: JSON.stringify(metadata),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    write: false,
    sourcemap: false,
    minify: true,
    lib: {
      entry: workerSource,
      name: "LessonboardOffline",
      formats: ["iife"],
      fileName: () => "sw.js",
    },
  },
});
const output = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const worker = output.find((entry) => entry.type === "chunk" && entry.fileName === "sw.js");
if (!worker) throw new Error("Offline service worker build did not emit sw.js.");
await writeFile(path.join(root, "sw.js"), worker.code);
await writeFile(path.join(root, "offline-build.json"), JSON.stringify(metadata) + "\n");
console.log(`Offline build ${buildId}: core ${metadata.coreBytes} bytes, PDF resources ${metadata.pdfBytes} bytes.`);
