import {
  getDocument,
  GlobalWorkerOptions,
  OPS,
  PasswordResponses,
} from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { digest } from "../workspace/model.ts";
import { WorkspaceError, MAX_PAGES } from "../workspace/contracts.ts";
import { MAX_PDF_BYTES, verifySources } from "./sources.ts";
import type { PdfSource, PdfPageInfo } from "./sources.ts";
import { rasterSize, MAX_RASTER_PIXELS } from "./geometry.ts";
import { checkPdfResources } from "./source-check.ts";
GlobalWorkerOptions.workerSrc = workerUrl;
const settings = {
  enableXfa: false,
  stopAtErrors: true,
  cMapUrl: "/pdfjs/cmaps/",
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
  canvasMaxAreaInBytes: 64_000_000,
};
export function pdfTask(bytes: Uint8Array, password?: string) {
  // PDF.js transfers data to its worker. Never transfer the preserved original.
  return getDocument({ ...settings, data: bytes.slice(), password });
}
export function abortError() {
  return new DOMException(
    "Operation cancelled. Current lesson is unchanged.",
    "AbortError",
  );
}
export function checkAbort(signal: AbortSignal) {
  if (signal.aborted)
    throw signal.reason instanceof Error ? signal.reason : abortError();
}
export type PasswordPrompt = (wrong: boolean) => Promise<string>;
export async function inspectPdf(
  file: File,
  signal: AbortSignal,
  progress: (value: string) => void,
  password: PasswordPrompt,
  initialPassword?: string,
): Promise<{ source: PdfSource; password?: string }> {
  if (file.size > MAX_PDF_BYTES || file.size < 8)
    throw new WorkspaceError(
      "limit",
      "PDF files must be no larger than 50 MB.",
    );
  checkAbort(signal);
  progress(
    "Reading " + file.name + " (" + file.size.toLocaleString() + " bytes)…",
  );
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkAbort(signal);
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-"))
    throw new WorkspaceError("pdf", "This file has no valid PDF header.");
  const task = pdfTask(bytes, initialPassword);
  let secret: string | undefined = initialPassword;
  const cancel = () => void task.destroy();
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 120000);
  task.onPassword = (update: (value: string) => void, reason: number) => {
    void password(reason === PasswordResponses.INCORRECT_PASSWORD)
      .then((value) => {
        checkAbort(signal);
        secret = value;
        update(value);
      })
      .catch(() => {
        void task.destroy();
      });
  };
  try {
    const pdf = await task.promise;
    checkAbort(signal);
    progress("Checking PDF resource limits…");
    await checkPdfResources(bytes, secret, signal);
    if (pdf.numPages > MAX_PAGES)
      throw new WorkspaceError(
        "limit",
        "A PDF can contain at most 200 lesson pages.",
      );
    if (pdf.isPureXfa)
      throw new WorkspaceError(
        "unsupported",
        "XFA-only forms are unsupported. Print a static PDF in the original application first.",
      );
    const pages: PdfPageInfo[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      checkAbort(signal);
      progress("Checking page " + i + " of " + pdf.numPages + "…");
      const p = await pdf.getPage(i),
        v = p.getViewport({ scale: 1 });
      if (
        ![v.width, v.height].every(
          (n) => Number.isFinite(n) && n >= 1 && n <= 100000,
        )
      )
        throw new WorkspaceError("limit", "Unsafe PDF page dimensions.");
      const operators = await p.getOperatorList();
      if (operators.fnArray.length > 2_000_000)
        throw new WorkspaceError(
          "limit",
          "PDF page exceeds the two million drawing operation limit.",
        );
      let pixels = 0;
      for (let j = 0; j < operators.fnArray.length; j++) {
        const op = operators.fnArray[j],
          args = operators.argsArray[j];
        if (op === OPS.paintImageXObject)
          pixels += Number(args[1]) * Number(args[2]);
        if (op === OPS.paintInlineImageXObject)
          pixels += Number(args[0]?.width) * Number(args[0]?.height);
        if (pixels > 64_000_000)
          throw new WorkspaceError(
            "limit",
            "PDF page exceeds 64 million decoded image pixels.",
          );
      }
      const annotations = await p.getAnnotations({ intent: "display" }),
        text = await p.getTextContent();
      if (annotations.some((a) => a.subtype !== "Link" && !a.hasAppearance))
        throw new WorkspaceError(
          "unsupported",
          "A PDF annotation has no supported static appearance. Flatten annotations in the original application before importing.",
        );
      pages.push({
        width: v.width,
        height: v.height,
        rotation: p.rotate,
        userUnit: p.userUnit,
        viewBox: [...p.view],
        transform: [...v.transform],
        rasterOnly: annotations.some((a) => a.hasAppearance),
        hasText: text.items.some((x) => "str" in x && x.str.trim().length > 0),
      });
      p.cleanup();
    }
    checkAbort(signal);
    const sha256 = await digest(bytes);
    const source: PdfSource = {
      sourceVersion: 1,
      id: "pdf:" + sha256,
      sha256,
      name: file.name.slice(0, 180),
      size: bytes.length,
      bytes,
      encrypted: secret !== undefined,
      pages,
    };
    await verifySources({ [source.id]: source });
    return { source, password: secret };
  } catch (e) {
    if (signal.aborted) throw abortError();
    throw new WorkspaceError(
      "pdf",
      e instanceof Error ? e.message : "The PDF could not be checked.",
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    await task.destroy();
  }
}
type Entry = {
  task: PDFDocumentLoadingTask;
  promise: Promise<PDFDocumentProxy>;
};
/** Per lesson lifetime. At most two parsed PDFs, four raster pages / 64 MB. */
export class PdfRuntime {
  #docs = new Map<string, Entry>();
  #images = new Map<string, ImageBitmap>();
  #passwords = new Map<string, string>();
  #closed = false;
  stats = {
    parses: 0,
    renders: 0,
    cacheBytes: 0,
    cacheEntries: 0,
    cancelled: 0,
  };
  setPassword(id: string, password?: string) {
    if (password !== undefined) this.#passwords.set(id, password);
  }
  password(id: string) {
    return this.#passwords.get(id);
  }
  async document(source: PdfSource): Promise<PDFDocumentProxy> {
    if (this.#closed) throw abortError();
    let entry = this.#docs.get(source.id);
    if (!entry) {
      const task = pdfTask(source.bytes, this.#passwords.get(source.id));
      this.stats.parses++;
      task.onPassword = () => {
        void task.destroy();
      };
      entry = { task, promise: task.promise };
      this.#docs.set(source.id, entry);
      while (this.#docs.size > 2) {
        const [id, old] = this.#docs.entries().next().value!;
        this.#docs.delete(id);
        void old.task.destroy();
      }
      entry.promise.catch(() => {
        if (this.#docs.get(source.id) === entry) this.#docs.delete(source.id);
      });
    } else {
      this.#docs.delete(source.id);
      this.#docs.set(source.id, entry);
    }
    return entry.promise;
  }
  async paint(
    source: PdfSource,
    index: number,
    scale: number,
    signal: AbortSignal,
    strict = false,
  ): Promise<ImageBitmap> {
    checkAbort(signal);
    const info = source.pages[index];
    // Visible rendering may downsample to fit the cap; export refuses instead.
    let safeScale = strict
      ? scale
      : Math.min(
          scale,
          Math.sqrt(MAX_RASTER_PIXELS / (info.width * info.height)),
          16384 / info.width,
          16384 / info.height,
        );
    if (!strict)
      while (
        Math.ceil(info.width * safeScale) * Math.ceil(info.height * safeScale) >
          MAX_RASTER_PIXELS ||
        Math.ceil(info.width * safeScale) > 16384 ||
        Math.ceil(info.height * safeScale) > 16384
      )
        safeScale *= 0.999;
    const size = rasterSize(info.width, info.height, safeScale),
      key = source.id + ":" + index + ":" + size.width + "x" + size.height;
    const cached = this.#images.get(key);
    if (cached) {
      this.#images.delete(key);
      this.#images.set(key, cached);
      return cached;
    }
    const pdf = await this.document(source);
    checkAbort(signal);
    const page = await pdf.getPage(index + 1);
    checkAbort(signal);
    const actual = page.getViewport({ scale: 1 });
    if (
      Math.abs(actual.width - info.width) > 1e-8 ||
      Math.abs(actual.height - info.height) > 1e-8 ||
      page.rotate !== info.rotation ||
      page.userUnit !== info.userUnit ||
      actual.transform.some((n, i) => Math.abs(n - info.transform[i]) > 1e-8)
    )
      throw new WorkspaceError(
        "integrity",
        "PDF page geometry differs from its saved source mapping. Keep the original archive.",
      );
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const task = page.render({
      canvas,
      viewport: page.getViewport({ scale: safeScale }),
    });
    task.onContinue = (resume: () => void) => {
      setTimeout(resume, 0);
    };
    const cancel = () => {
      task.cancel();
      this.stats.cancelled++;
    };
    signal.addEventListener("abort", cancel, { once: true });
    const deadline = setTimeout(cancel, 30000);
    try {
      await task.promise;
      checkAbort(signal);
      const image = await createImageBitmap(canvas);
      if (signal.aborted || this.#closed) {
        image.close();
        throw abortError();
      }
      this.stats.renders++;
      const existing = this.#images.get(key);
      if (existing) {
        // Independent callers may finish the same cold render concurrently.
        // Keep the first cache-owned bitmap and release the redundant result.
        image.close();
        this.#images.delete(key);
        this.#images.set(key, existing);
        return existing;
      }
      this.#images.set(key, image);
      this.stats.cacheBytes += image.width * image.height * 4;
      while (this.#images.size > 4 || this.stats.cacheBytes > 64_000_000) {
        const [k, old] = this.#images.entries().next().value!;
        this.#images.delete(k);
        this.stats.cacheBytes -= old.width * old.height * 4;
        old.close();
      }
      this.stats.cacheEntries = this.#images.size;
      return image;
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", cancel);
      canvas.width = canvas.height = 0;
    }
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const e of this.#docs.values()) void e.task.destroy();
    this.#docs.clear();
    for (const image of this.#images.values()) image.close();
    this.#images.clear();
    this.#passwords.clear();
    this.stats.cacheBytes = 0;
    this.stats.cacheEntries = 0;
  }
}
