import type { Lesson } from "../workspace/model.ts";
import type { Paper } from "../workspace/lesson-view.ts";
import type { Slide, SlideElement, SlideText } from "./model.ts";
import { readImageHeader } from "../media/image-format.ts";

type Ink = CanvasRenderingContext2D;
type Sources = Record<string, { bytes: Uint8Array; mime: string }>;
type Run = SlideText["paragraphs"][number]["runs"][number];
type Word = { run: Run; value: string; width: number };

export function slideForPaper(lesson: Lesson, paper: Paper) {
  if (paper.kind !== "pptx") return;
  const deck = lesson.pptxDecks[paper.sourceId!];
  const slide = deck?.slides.find((s) => s.id === paper.slideId);
  if (deck && slide) return { deck, slide };
}

function font(run: Run, families?: string) {
  const family = run.fontFamily.replace(/["\\\r\n]/g, "");
  return (
    (run.italic ? "italic " : "") +
    (run.bold ? "bold " : "") +
    run.fontSize +
    "px " +
    (families ?? '"' + family + '", Arial, sans-serif')
  );
}

export function missingSlideFonts(slide: Slide) {
  const ctx = document.createElement("canvas").getContext("2d")!;
  const fonts = new Set<string>();
  const measure = "mWiIễự239";
  const checked = new Set<string>();
  function inspect(text: SlideText | undefined) {
    for (const p of text?.paragraphs ?? [])
      for (const run of p.runs) {
        if (checked.has(run.fontFamily)) continue;
        checked.add(run.fontFamily);
        if (
          !run.fontFamily ||
          /^(serif|sans-serif|monospace|system-ui)$/i.test(run.fontFamily)
        )
          continue;
        const family = run.fontFamily.replace(/["\\\r\n]/g, "");
        if (
          ["monospace", "serif"].every((base) => {
            ctx.font = font(run, base);
            const fallback = ctx.measureText(measure).width;
            ctx.font = font(run, '"' + family + '", ' + base);
            return ctx.measureText(measure).width === fallback;
          })
        )
          fonts.add(run.fontFamily);
      }
  }
  function visit(elements: SlideElement[]) {
    for (const element of elements) {
      if (element.kind === "shape") inspect(element.text);
      if (element.kind === "group") visit(element.children);
      if (element.kind === "table")
        for (const row of element.rows)
          for (const cell of row.cells) inspect(cell.text);
    }
  }
  visit(slide.elements);
  return [...fonts];
}

function drawText(ctx: Ink, text: SlideText, width: number, height: number) {
  const [top, right, bottom, left] = text.inset;
  if (width <= left + right || height <= top + bottom) return;
  const lines: {
    y: number;
    height: number;
    words: Word[];
    x: number;
    available: number;
    align: SlideText["paragraphs"][number]["align"];
    justify: boolean;
  }[] = [];
  let y = 0;
  for (const paragraph of text.paragraphs) {
    y += paragraph.spaceBefore;
    let words: Word[] = [],
      lineWidth = 0,
      lineHeight = 0;
    const indent = left + paragraph.marginLeft;
    let x = indent + paragraph.indent;
    let available = Math.max(1, width - right - x);
    function line(justify = false) {
      while (/^[ \t]+$/.test(words.at(-1)?.value ?? "")) words.pop();
      const height =
        (lineHeight || paragraph.runs[0]?.fontSize || 16) *
        (paragraph.lineHeight ?? 1.18);
      lines.push({
        y,
        height,
        words,
        x,
        available,
        align: paragraph.align,
        justify,
      });
      y += height;
      words = [];
      lineWidth = lineHeight = 0;
      x = indent;
      available = Math.max(1, width - right - x);
    }
    function add(run: Run, value: string) {
      const width = ctx.measureText(value).width;
      words.push({ run, value, width });
      lineWidth += width;
      lineHeight = Math.max(lineHeight, run.fontSize);
    }
    if (paragraph.bullet && paragraph.runs[0]) {
      ctx.font = font(paragraph.runs[0]);
      add(paragraph.runs[0], paragraph.bullet + " ");
    }
    for (const run of paragraph.runs) {
      ctx.font = font(run);
      for (const token of run.text.match(/\r\n|\n|\r|[^\S\r\n]+|\S+/gu) ?? []) {
        if (/^[\r\n]/.test(token)) {
          line();
          continue;
        }
        const whitespace = /^[^\S\r\n]+$/u.test(token);
        const size = ctx.measureText(token).width;
        if (text.wrap && lineWidth + size > available && words.length)
          line(true);
        if (whitespace && !words.length) continue;
        if (text.wrap && size > available && !whitespace) {
          for (const character of token) {
            if (
              lineWidth + ctx.measureText(character).width > available &&
              words.length
            )
              line();
            add(run, character);
          }
        } else add(run, token);
      }
    }
    line();
    y += paragraph.spaceAfter;
  }
  const gap = Math.max(0, height - top - bottom - y);
  const anchor =
    top +
    (text.align === "bottom" ? gap : text.align === "middle" ? gap / 2 : 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width - left - right, height - top - bottom);
  ctx.clip();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const line of lines) {
    const contentWidth = line.words.reduce((sum, w) => sum + w.width, 0);
    const slack = Math.max(0, line.available - contentWidth);
    const spaces =
      line.align === "justify" && line.justify
        ? line.words.filter(({ value }) => /^\s+$/u.test(value)).length
        : 0;
    let x =
      line.x +
      (line.align === "right"
        ? slack
        : line.align === "center"
          ? slack / 2
          : 0);
    for (const { run, value, width } of line.words) {
      ctx.font = font(run);
      ctx.fillStyle = run.color;
      const baseline = anchor + line.y + line.height / 2 + run.fontSize * 0.32;
      ctx.fillText(value, x, baseline);
      if (run.underline)
        ctx.fillRect(
          x,
          baseline + run.fontSize * 0.09,
          width,
          Math.max(0.5, run.fontSize / 18),
        );
      x += width + (spaces && /^\s+$/u.test(value) ? slack / spaces : 0);
    }
  }
  ctx.restore();
}

function polygon(ctx: Ink, w: number, h: number, points: readonly number[][]) {
  for (const [index, [x, y]] of points.entries())
    if (index) ctx.lineTo(w * x, h * y);
    else ctx.moveTo(w * x, h * y);
  ctx.closePath();
}

const polygons: Record<string, number[][]> = {
  triangle: [
    [0.5, 0],
    [1, 1],
    [0, 1],
  ],
  diamond: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  hexagon: [
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ],
  chevron: [
    [0, 0],
    [0.65, 0],
    [1, 0.5],
    [0.65, 1],
    [0, 1],
    [0.35, 0.5],
  ],
};
const arrow = [
  [0, 0.25],
  [0.55, 0.25],
  [0.55, 0],
  [1, 0.5],
  [0.55, 1],
  [0.55, 0.75],
  [0, 0.75],
];

function drawShape(ctx: Ink, e: Extract<SlideElement, { kind: "shape" }>) {
  const { width: w, height: h, shape, fill, stroke, strokeWidth } = e;
  ctx.beginPath();
  if (shape === "line") {
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
  } else if (shape === "ellipse")
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (shape === "roundRect") ctx.roundRect(0, 0, w, h, Math.min(w, h) / 6);
  else if (polygons[shape]) polygon(ctx, w, h, polygons[shape]);
  else if (shape.endsWith("Arrow")) {
    const points = arrow.map(([x, y]) =>
      shape === "leftArrow"
        ? [1 - x, y]
        : shape === "upArrow"
          ? [y, 1 - x]
          : shape === "downArrow"
            ? [y, x]
            : [x, y],
    );
    polygon(ctx, w, h, points);
  } else ctx.rect(0, 0, w, h);
  if (shape !== "line" && fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke && strokeWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
    if (shape === "line") {
      const angle = Math.atan2(h, w);
      const size = Math.max(5, strokeWidth * 4);
      ctx.fillStyle = stroke;
      for (const start of [true, false]) {
        if (!(start ? e.arrowStart : e.arrowEnd)) continue;
        ctx.save();
        ctx.translate(start ? 0 : w, start ? 0 : h);
        ctx.rotate(start ? angle + Math.PI : angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-size, size / 2);
        ctx.lineTo(-size, -size / 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
  if (e.text) drawText(ctx, e.text, w, h);
}

function drawTable(ctx: Ink, e: Extract<SlideElement, { kind: "table" }>) {
  let y = 0;
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const scaleX = e.width / (sum(e.columns) || 1);
  const scaleY = e.height / (sum(e.rows.map((r) => r.height)) || 1);
  for (const [rowIndex, row] of e.rows.entries()) {
    let x = 0;
    for (const [columnIndex, cell] of row.cells.entries()) {
      if (!cell.merged) {
        const w =
          scaleX *
          sum(e.columns.slice(columnIndex, columnIndex + cell.colSpan));
        const h =
          scaleY *
          sum(
            e.rows
              .slice(rowIndex, rowIndex + cell.rowSpan)
              .map((r) => r.height),
          );
        if (cell.fill) {
          ctx.fillStyle = cell.fill;
          ctx.fillRect(x, y, w, h);
        }
        if (cell.stroke) {
          ctx.strokeStyle = cell.stroke;
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, w, h);
        }
        ctx.save();
        ctx.translate(x, y);
        drawText(ctx, cell.text, w, h);
        ctx.restore();
      }
      x += (e.columns[columnIndex] ?? 0) * scaleX;
    }
    y += row.height * scaleY;
  }
}

// Image objects outlive object URLs only while referenced by this bounded LRU or a paint.
const cache = new Map<
  string,
  { promise: Promise<HTMLImageElement>; pixels: number }
>();
let cachedPixels = 0;
function localImage(id: string, sources: Sources) {
  const cached = cache.get(id);
  if (cached) {
    cache.delete(id);
    cache.set(id, cached);
    return cached.promise;
  }
  const source = sources[id];
  if (!source) throw new Error("A PowerPoint picture is missing.");
  const header = readImageHeader(source.bytes);
  if (header.mime !== source.mime)
    throw new Error("Invalid PowerPoint picture type.");
  const pixels = header.width * header.height;
  while (cache.size >= 24 || cachedPixels + pixels > 20_000_000) {
    const oldest = cache.keys().next().value!;
    cachedPixels -= cache.get(oldest)!.pixels;
    cache.delete(oldest);
  }
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(source.bytes).buffer], { type: header.mime }),
  );
  const image = new Image();
  image.src = url;
  const promise = image
    .decode()
    .then(() => image)
    .finally(() => URL.revokeObjectURL(url));
  cache.set(id, { promise, pixels });
  cachedPixels += pixels;
  return promise;
}

export async function paintSlide(
  ctx: Ink,
  slide: Slide,
  width: number,
  height: number,
  sources: Sources,
  hidden: ReadonlySet<string>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.fillStyle = slide.background;
    ctx.fillRect(0, 0, width, height);
    async function draw(elements: SlideElement[]) {
      for (const e of elements) {
        signal.throwIfAborted();
        if (e.hidden || hidden.has(e.id)) continue;
        ctx.save();
        try {
          ctx.translate(e.x + e.width / 2, e.y + e.height / 2);
          ctx.rotate((e.rotation * Math.PI) / 180);
          ctx.scale(e.flipX ? -1 : 1, e.flipY ? -1 : 1);
          ctx.translate(-e.width / 2, -e.height / 2);
          if (e.kind === "group") {
            const [x, y, w, h] = e.childBox;
            ctx.scale(e.width / w, e.height / h);
            ctx.translate(-x, -y);
            await draw(e.children);
          } else if (e.kind === "shape") drawShape(ctx, e);
          else if (e.kind === "table") drawTable(ctx, e);
          else if (e.kind === "image") {
            const image = await localImage(e.assetId, sources);
            signal.throwIfAborted();
            const [l, t, r, b] = e.crop;
            ctx.drawImage(
              image,
              image.width * l,
              image.height * t,
              image.width * (1 - l - r),
              image.height * (1 - t - b),
              0,
              0,
              e.width,
              e.height,
            );
          } else if (e.width && e.height) {
            ctx.fillStyle = "#f2f4f4";
            ctx.fillRect(0, 0, e.width, e.height);
            ctx.strokeStyle = "#899799";
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(0, 0, e.width, e.height);
            ctx.fillStyle = "#314447";
            ctx.font = "12px Arial, sans-serif";
            ctx.fillText(
              "Unsupported: " + e.name,
              5,
              Math.min(16, e.height),
              Math.max(1, e.width - 10),
            );
          }
        } finally {
          ctx.restore();
        }
      }
    }
    await draw(slide.elements);
  } finally {
    ctx.restore();
  }
}
