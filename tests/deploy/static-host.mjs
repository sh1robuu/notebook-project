// Local verification adapter for the declared static Vercel configuration.
// It is not a Vercel emulator, HTTPS deployment or production server.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("dist"),
  config = JSON.parse(await readFile("vercel.json", "utf8"));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".icc": "application/vnd.iccprofile",
};
function matches(pattern, pathname) {
  if (pattern === "/(.*)") return true;
  if (pattern.endsWith("/:path*"))
    return pathname.startsWith(pattern.slice(0, -7) + "/");
  if (pattern === "/pdfjs/wasm/(.*\\.wasm)")
    return pathname.startsWith("/pdfjs/wasm/") && pathname.endsWith(".wasm");
  if (pattern.endsWith("/(.*)"))
    return pathname.startsWith(pattern.slice(0, -5) + "/");
  return pattern === pathname;
}
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    for (const rule of config.headers ?? [])
      if (matches(rule.source, pathname))
        for (const header of rule.headers)
          res.setHeader(header.key, header.value);
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      return res.end();
    }
    if (
      pathname.includes("\\") ||
      pathname.split("/").some((part) => part.startsWith("."))
    ) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    let file = path.resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(404);
      return res.end();
    }
    let exists = await stat(file)
      .then((s) => s.isFile())
      .catch(() => false);
    if (!exists) {
      const rewrite = config.rewrites.find((rule) =>
        matches(rule.source, pathname),
      );
      if (rewrite) {
        file = path.join(root, rewrite.destination);
        exists = true;
      }
    }
    if (!exists) {
      if (
        /^\/(api|assets|pdfjs|product|fonts|src|tests|docs|experiments)(\/|$)/.test(
          pathname,
        )
      ) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("Not found");
      }
      file = path.join(root, "404.html");
      res.statusCode = 404;
    }
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] ?? "application/octet-stream",
    );
    if (req.method === "HEAD") return res.end();
    createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
  }
}).listen(5186, "127.0.0.1", () =>
  console.log("Local static configuration check: http://127.0.0.1:5186"),
);
