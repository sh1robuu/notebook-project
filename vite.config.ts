import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  build: {
    sourcemap: false,
    rolldownOptions: { output: {
      assetFileNames: ({ names }) => names.includes("pdf.worker.min.mjs")
        ? "app/runtime/[name]-[hash][extname]"
        : "assets/[name]-[hash][extname]",
    } },
  },
  worker: { rolldownOptions: { output: {
    entryFileNames: "app/runtime/[name]-[hash].js",
    chunkFileNames: "app/runtime/[name]-[hash].js",
  } } },
  plugins: [react(), {
    name: "lessonboard-preview-editor-route",
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?", 1)[0];
        if (pathname && /^\/app(?:\/|$)/.test(pathname) && !pathname.startsWith("/app/runtime/"))
          request.url = "/editor.html";
        if (pathname === "/sw.js") {
          response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          response.setHeader("Service-Worker-Allowed", "/app");
        }
        next();
      });
    },
  }],
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "tldraw",
      "@tldraw/tlschema",
      "dexie",
      "fflate",
      "dompurify",
      "katex",
      "pdfjs-dist",
      "@cantoo/pdf-lib",
      "svg-pathdata",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        "**/docs/verification/**",
        "**/test-results/**",
        "**/.playwright-cli/**",
        "**/.taste-skill/**",
      ],
    },
  },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
});
