import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  build: { sourcemap: false },
  plugins: [react()],
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
