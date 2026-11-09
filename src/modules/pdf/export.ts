import { Box } from "tldraw";
import type { Editor, TLPageId, TLShapeId } from "tldraw";
import type { Lesson } from "../workspace/model.ts";
import { hydrateSurface } from "../workspace/model.ts";
import { validatePaper } from "../workspace/lesson-view.ts";
import { paperColors } from "../board/pages.ts";
import { exportEditor } from "./export-editor.tsx";
import { checkAbort, abortError, PdfRuntime, pdfTask } from "./runtime.ts";
import { parsePageRange, rasterSize } from "./geometry.ts";
import { normalizedPath } from "./paths.ts";
import { paintSlide, slideForPaper } from "../pptx/render.ts";
import { InteractiveExportWarning } from "./export-contract.ts";
import type {
  ExportBounds,
  ExportPage,
  PdfExportJob,
  ExportLayer,
} from "./export-contract.ts";
export type ExportOptions = {
  allowInteractivePlaceholders?: boolean;
  format: "png" | "pdf";
  scope: "current" | "all" | "range" | "scratchpad" | "selection" | "region";
  range: string;
  includeScratch: boolean;
  background: boolean;
  annotations: boolean;
  scale: number;
  region: ExportBounds;
  selected: TLShapeId[];
  slideFrame?: { pageId: string; hiddenIds: string[] };
};
const pngBytes = async (canvas: HTMLCanvasElement) =>
  new Uint8Array(
    await (
      await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("PNG encoding failed.")),
          "image/png",
        ),
      )
    ).arrayBuffer(),
  );
function untilAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason instanceof Error ? signal.reason : abortError());
    signal.addEventListener("abort", abort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
function selectedBounds(editor: Editor, ids: TLShapeId[]) {
  let result: Box | undefined;
  for (const id of ids) {
    const b = editor.getShapePageBounds(id);
    if (b) result = result ? result.union(b) : b.clone();
  }
  if (!result)
    throw new Error(
      "Select at least one object before exporting selected objects.",
    );
  return result.expandBy(4);
}
function safeVector(svg: string) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const dashed = [...doc.querySelectorAll("*")].some((element) => {
    const style = (element as SVGElement).style;
    const dash = (
      element.getAttribute("stroke-dasharray") ||
      style?.getPropertyValue("stroke-dasharray") ||
      ""
    ).trim();
    const offset = (
      element.getAttribute("stroke-dashoffset") ||
      style?.getPropertyValue("stroke-dashoffset") ||
      ""
    ).trim();
    return (
      (dash !== "" && dash !== "none" && dash !== "0") ||
      (offset !== "" && Number.parseFloat(offset) !== 0)
    );
  });
  // Narrow verified subset. HTML text, equations, images, masks, filters and
  // patterns use native SVG-to-PNG instead of silently losing their appearance.
  return (
    !doc.querySelector(
      "parsererror,foreignObject,text,image,mask,filter,pattern,use,style",
    ) &&
    !/url\(|var\(/.test(svg) &&
    !dashed
  );
}
function normalizedSvg(svg: string) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  for (const path of doc.querySelectorAll("path[d]"))
    path.setAttribute("d", normalizedPath(path.getAttribute("d")!));
  return new XMLSerializer().serializeToString(doc);
}
function worker(
  job: PdfExportJob,
  signal: AbortSignal,
  progress: (s: string) => void,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./export.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      w.terminate();
    };
    const abort = () => {
      finish();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      finish();
      reject(
        new Error(
          "PDF export exceeded its 180 second deadline. Try a smaller range.",
        ),
      );
    }, 180000);
    signal.addEventListener("abort", abort, { once: true });
    w.onmessage = (ev) => {
      if (ev.data.progress) {
        progress(`Writing PDF page ${ev.data.progress} of ${ev.data.total}…`);
        return;
      }
      finish();
      ev.data.ok ? resolve(ev.data.bytes) : reject(new Error(ev.data.error));
    };
    w.onerror = () => {
      finish();
      reject(new Error("The PDF writer worker could not finish."));
    };
    try {
      w.postMessage(job);
    } catch (e) {
      finish();
      reject(e);
    }
  });
}
export async function createExport(
  lesson: Lesson,
  options: ExportOptions,
  passwords: Record<string, string>,
  signal: AbortSignal,
  progress: (s: string) => void,
) {
  const lifetime = new AbortController(),
    cancel = () => lifetime.abort(signal.reason);
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () =>
      lifetime.abort(
        new Error(
          "Export exceeded its 180 second deadline. Use a smaller range or resolution.",
        ),
      ),
    180000,
  );
  try {
    return await createExportJob(
      lesson,
      options,
      passwords,
      lifetime.signal,
      progress,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
async function createExportJob(
  lesson: Lesson,
  options: ExportOptions,
  passwords: Record<string, string>,
  signal: AbortSignal,
  progress: (s: string) => void,
): Promise<{
  bytes: Uint8Array;
  mime: string;
  extension: string;
  rasterLayers: number;
}> {
  checkAbort(signal);
  if (!options.background && !options.annotations)
    throw new Error("Choose the page background, annotations, or both.");
  const runtime = new PdfRuntime();
  for (const [id, p] of Object.entries(passwords)) runtime.setPassword(id, p);
  let main: Awaited<ReturnType<typeof exportEditor>> | undefined,
    scratch: typeof main;
  let allocatedPixels = 0,
    rasterLayers = 0;
  const reserve = (w: number, h: number, scale: number) => {
    const size = rasterSize(w, h, scale);
    allocatedPixels += size.width * size.height;
    if (allocatedPixels > 200_000_000)
      throw new Error(
        "Export raster workload exceeds 200 million pixels. Use a smaller range.",
      );
    return size;
  };
  async function editorFor(surface: "main" | "scratchpad") {
    if (surface === "main")
      return (main ??= await exportEditor(
        hydrateSurface(lesson, "main"),
        signal,
        lesson.wordSources,
        lesson.interactiveSources,
      )).editor;
    return (scratch ??= await exportEditor(
      hydrateSurface(lesson, "scratchpad"),
      signal,
      lesson.wordSources,
      lesson.interactiveSources,
    )).editor;
  }
  async function annotationsImage(
    editor: Editor,
    ids: TLShapeId[],
    bounds: Box,
    scale: number,
  ) {
    reserve(bounds.w, bounds.h, scale);
    checkAbort(signal);
    const { blob } = await untilAbort(
      editor.toImage(ids, {
        bounds,
        scale: 1,
        pixelRatio: scale,
        padding: 0,
        background: false,
        format: "png",
        darkMode: false,
      }),
      signal,
    );
    checkAbort(signal);
    return new Uint8Array(await blob.arrayBuffer());
  }
  try {
    const e = await editorFor(
      options.scope === "scratchpad" ? "scratchpad" : "main",
    );
    const pages = e.getPages();
    const chosen =
      options.scope === "all"
        ? pages.map((_, i) => i)
        : options.scope === "range"
          ? parsePageRange(options.range, pages.length)
          : [
              pages.findIndex(
                (p) =>
                  p.id ===
                  (options.scope === "scratchpad"
                    ? lesson.scratchpad.pageId
                    : lesson.pageId),
              ),
            ];
    const requests = chosen.map((i) => ({
      surface:
        options.scope === "scratchpad"
          ? ("scratchpad" as const)
          : ("main" as const),
      id: pages[i].id,
    }));
    if (
      options.format === "pdf" &&
      options.includeScratch &&
      options.scope !== "scratchpad"
    )
      requests.push({
        surface: "scratchpad",
        id: lesson.scratchpad.pageId as TLPageId,
      });
    const output: ExportPage[] = [];
    const usedSources: PdfExportJob["sources"] = {};
    if (options.annotations && !options.allowInteractivePlaceholders) {
      const missing: string[] = [];
      for (const request of requests) {
        const editor = await editorFor(request.surface);
        const ids =
          options.scope === "selection"
            ? editor.getShapeAndDescendantIds(options.selected)
            : editor.getPageShapeIds(request.id);
        for (const id of ids) {
          const shape = editor.getShape(id);
          if (shape?.type !== "interactive" || shape.props.material.snapshotId)
            continue;
          if (options.scope === "region") {
            const bounds = editor.getShapePageBounds(shape);
            const region = options.region;
            if (
              !bounds ||
              bounds.maxX < region.x ||
              bounds.maxY < region.y ||
              bounds.x > region.x + region.w ||
              bounds.y > region.y + region.h
            )
              continue;
          }
          missing.push(shape.props.material.title);
        }
      }
      if (missing.length) throw new InteractiveExportWarning(missing);
    }
    for (let n = 0; n < requests.length; n++) {
      checkAbort(signal);
      progress(
        `Preparing page ${n + 1} of ${requests.length} from captured snapshot…`,
      );
      const req = requests[n],
        editor = await editorFor(req.surface);
      editor.setCurrentPage(req.id);
      const paper = validatePaper(editor.getPage(req.id)!.meta.paper),
        source = lesson.pdfSources[paper.sourceId ?? ""],
        slide = options.background
          ? slideForPaper(lesson, paper)?.slide
          : undefined;
      const hidden = new Set(
        options.slideFrame?.pageId === req.id
          ? options.slideFrame.hiddenIds
          : [],
      );
      if (options.background && paper.kind === "pptx" && !slide)
        throw new Error("PowerPoint slide source is unavailable.");
      let ids = [...editor.getPageShapeIds(req.id)],
        bounds = new Box(0, 0, paper.width, paper.height);
      if (options.scope === "selection") {
        ids = options.selected.filter((id) => editor.getShape(id));
        bounds = selectedBounds(editor, ids);
      }
      if (options.scope === "region") {
        const b = options.region;
        if (
          ![b.x, b.y, b.w, b.h].every(Number.isFinite) ||
          Math.abs(b.x) > 1_000_000 ||
          Math.abs(b.y) > 1_000_000 ||
          b.w <= 0 ||
          b.h <= 0
        )
          throw new Error(
            "Enter finite region coordinates and positive dimensions.",
          );
        bounds = new Box(b.x, b.y, b.w, b.h);
      }
      if (options.format === "png") {
        const size = reserve(bounds.w, bounds.h, options.scale),
          canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        try {
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = options.background
            ? paperColors[paper.color]
            : "#ffffff";
          ctx.fillRect(0, 0, size.width, size.height);
          if (options.background && source) {
            const bg = await untilAbort(
              runtime.paint(
                source,
                paper.pageIndex!,
                options.scale,
                signal,
                true,
              ),
              signal,
            );
            ctx.drawImage(
              bg,
              -bounds.x * options.scale,
              -bounds.y * options.scale,
              paper.width * options.scale,
              paper.height * options.scale,
            );
          }
          if (slide) {
            ctx.save();
            try {
              ctx.setTransform(
                options.scale,
                0,
                0,
                options.scale,
                -bounds.x * options.scale,
                -bounds.y * options.scale,
              );
              await untilAbort(
                paintSlide(
                  ctx,
                  slide,
                  paper.width,
                  paper.height,
                  lesson.pptxSources,
                  hidden,
                  signal,
                ),
                signal,
              );
            } finally {
              ctx.restore();
            }
          }
          if (options.annotations && ids.length) {
            const bytes = await annotationsImage(
                editor,
                ids,
                bounds,
                options.scale,
              ),
              bitmap = await untilAbort(
                createImageBitmap(
                  new Blob([new Uint8Array(bytes).buffer], {
                    type: "image/png",
                  }),
                ).then((image) => {
                  if (signal.aborted) {
                    image.close();
                    checkAbort(signal);
                  }
                  return image;
                }),
                signal,
              );
            try {
              checkAbort(signal);
              ctx.drawImage(bitmap, 0, 0, size.width, size.height);
            } finally {
              bitmap.close();
            }
          }
          checkAbort(signal);
          const bytes = await untilAbort(pngBytes(canvas), signal);
          checkAbort(signal);
          return {
            bytes,
            mime: "image/png",
            extension: "png",
            rasterLayers: ids.length ? 1 : 0,
          };
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      const page: ExportPage = {
        width: paper.width,
        height: paper.height,
        unit: paper.kind === "pdf" ? 1 : 0.75,
        color: options.background ? paperColors[paper.color] : "#ffffff",
        layers: [],
      };
      if (options.background && source) {
        if (source.pages[paper.pageIndex!].rasterOnly) {
          reserve(paper.width, paper.height, 2);
          const image = await untilAbort(
              runtime.paint(source, paper.pageIndex!, 2, signal, true),
              signal,
            ),
            canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          try {
            canvas.getContext("2d")!.drawImage(image, 0, 0);
            page.backgroundPng = await untilAbort(pngBytes(canvas), signal);
            rasterLayers++;
          } finally {
            canvas.width = canvas.height = 0;
          }
        } else {
          page.pdf = { sourceId: source.id, index: paper.pageIndex! };
          usedSources[source.id] = source;
        }
      }
      if (slide) {
        const scale = 2;
        const size = reserve(paper.width, paper.height, scale);
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        try {
          const ctx = canvas.getContext("2d")!;
          ctx.scale(canvas.width / paper.width, canvas.height / paper.height);
          await untilAbort(
            paintSlide(
              ctx,
              slide,
              paper.width,
              paper.height,
              lesson.pptxSources,
              hidden,
              signal,
            ),
            signal,
          );
          page.backgroundPng = await untilAbort(pngBytes(canvas), signal);
          rasterLayers++;
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      if (options.annotations && ids.length) {
        // Preserve root stacking/group semantics; each unsupported root becomes
        // one transparent 144 dpi (PDF) / 192 dpi (blank-paper) native layer.
        const roots = editor.getSortedChildIdsForParent(req.id);
        for (const id of roots) {
          checkAbort(signal);
          const b = editor.getShapePageBounds(id);
          if (!b) throw new Error("An annotation has no exportable bounds.");
          if (!b.collides(new Box(0, 0, paper.width, paper.height))) continue;
          const bounds = b.clone().expandBy(4),
            svg = await untilAbort(
              editor.getSvgString([id], {
                bounds,
                padding: 0,
                scale: 1,
                background: false,
                darkMode: false,
              }),
              signal,
            );
          if (!svg) throw new Error("An annotation could not be exported.");
          const layer: ExportLayer = {
            bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
          };
          if (safeVector(svg.svg)) layer.svg = normalizedSvg(svg.svg);
          else {
            layer.png = await annotationsImage(editor, [id], bounds, 2);
            rasterLayers++;
          }
          page.layers.push(layer);
        }
      }
      output.push(page);
    }
    checkAbort(signal);
    const bytes = await worker(
      { pages: output, sources: usedSources, passwords },
      signal,
      progress,
    );
    checkAbort(signal);
    progress("Reopening generated PDF to check page count and dimensions…");
    const reopen = pdfTask(bytes);
    const cancel = () => void reopen.destroy();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const pdf = await reopen.promise;
      if (pdf.numPages !== output.length)
        throw new Error("Generated PDF page count differs.");
      for (let i = 0; i < output.length; i++) {
        checkAbort(signal);
        const v = (await pdf.getPage(i + 1)).getViewport({ scale: 1 }),
          p = output[i];
        if (
          Math.abs(v.width - p.width * p.unit) > 0.01 ||
          Math.abs(v.height - p.height * p.unit) > 0.01
        )
          throw new Error("Generated PDF page dimensions differ.");
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      await reopen.destroy();
    }
    return { bytes, mime: "application/pdf", extension: "pdf", rasterLayers };
  } finally {
    main?.close();
    scratch?.close();
    runtime.close();
  }
}
