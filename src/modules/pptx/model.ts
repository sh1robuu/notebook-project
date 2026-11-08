export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const MAX_PPTX_BYTES = 50_000_000;
export const MAX_PPTX_SLIDES = 200;
export const MAX_PPTX_ELEMENTS = 16_000;
export const MAX_PPTX_SLIDE_ELEMENTS = 1_000;
export const MAX_PPTX_TEXT = 1_000_000;
export const MAX_PPTX_BUILDS = 1_000;
export const MAX_PPTX_DIAGNOSTICS = 3_000;
export const MAX_PPTX_COORD = 100_000;
export const MAX_PPTX_TIME = 60_000;
export const MIN_SOURCE_SLIDE_ID = 256;
export const MAX_SOURCE_SLIDE_ID = 2_147_483_647;

export type PptxSource = {
  sourceVersion: 1;
  id: string;
  sha256: string;
  name: string;
  mime: string;
  size: number;
  bytes: Uint8Array;
};
export type PptxSources = Record<string, PptxSource>;

export type SlideRun = {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};
export type SlideParagraph = {
  align: "left" | "center" | "right" | "justify";
  marginLeft: number;
  indent: number;
  spaceBefore: number;
  spaceAfter: number;
  lineHeight?: number;
  bullet?: string;
  runs: SlideRun[];
};
export type SlideText = {
  paragraphs: SlideParagraph[];
  inset: [top: number, right: number, bottom: number, left: number];
  align: "top" | "middle" | "bottom";
  wrap: boolean;
};
export const SLIDE_SHAPES = [
  "rect",
  "roundRect",
  "ellipse",
  "triangle",
  "diamond",
  "line",
  "rightArrow",
  "leftArrow",
  "upArrow",
  "downArrow",
  "hexagon",
  "chevron",
] as const;
export type SlideShapeKind = (typeof SLIDE_SHAPES)[number];
export type SlideElementBase = {
  id: string;
  sourceId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  hidden: boolean;
};
export type SlideTableCell = {
  text: SlideText;
  fill: string | null;
  stroke: string | null;
  colSpan: number;
  rowSpan: number;
  merged: boolean;
};
export type SlideElement = SlideElementBase &
  (
    | {
        kind: "shape";
        shape: SlideShapeKind;
        fill: string | null;
        stroke: string | null;
        strokeWidth: number;
        text?: SlideText;
        arrowStart?: boolean;
        arrowEnd?: boolean;
      }
    | { kind: "image"; assetId: string; crop: [number, number, number, number] }
    | {
        kind: "group";
        children: SlideElement[];
        childBox: [number, number, number, number];
      }
    | {
        kind: "table";
        columns: number[];
        rows: { height: number; cells: SlideTableCell[] }[];
      }
    | { kind: "unsupported"; reason: string }
  );
export type SlideBuild = {
  id: string;
  targetElementIds: string[];
  trigger: "onClick" | "withPrevious" | "afterPrevious";
  delayMs: number;
  durationMs: number;
  effect: "appear" | "fallback";
  presetId?: string;
  presetClass?: string;
  /** 0 runs on entry, positive groups advance manually. */
  group?: number;
  /** Milliseconds from the group's activation. */
  startMs?: number;
};
export type SlideDiagnostic = {
  code: string;
  message: string;
  slideId?: string;
  elementId?: string;
};
export type Slide = {
  id: string;
  sourcePart: string;
  title: string;
  layoutPart?: string;
  themePart?: string;
  notesPart?: string;
  hidden: boolean;
  background: string;
  elements: SlideElement[];
  builds: SlideBuild[];
};
export type SlideDocument = {
  schemaVersion: 1;
  id: string;
  sourceId: string;
  name: string;
  width: number;
  height: number;
  slides: Slide[];
  diagnostics: SlideDiagnostic[];
};
export type PptxImportResult = {
  document: SlideDocument;
  sources: PptxSources;
};

const paint = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const validId = /^[\w:.-]{1,180}$/;
const validPart =
  /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^:\\\u0000-\u001f?#]{1,512}$/;

function check(ok: unknown, context: string): asserts ok {
  if (!ok) throw new Error(`Invalid PowerPoint ${context}.`);
}

function record(value: unknown): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value), "record");
  return value as Record<string, unknown>;
}

function list(value: unknown, maximum: number): unknown[] {
  check(
    Array.isArray(value) && value.length <= maximum,
    "collection or resource budget",
  );
  for (let i = 0; i < value.length; i++)
    check(Object.hasOwn(value, i), "sparse collection");
  return value;
}

function number(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function color(value: unknown, nullable = false): boolean {
  return (
    (nullable && value === null) ||
    (typeof value === "string" && paint.test(value))
  );
}

function part(value: unknown): boolean {
  return typeof value === "string" && validPart.test(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && validId.test(value);
}

/** Validate persisted or worker-provided scene values before a renderer sees them. */
export function validateSlideDocument(
  input: unknown,
  sources: PptxSources,
): SlideDocument {
  const deck = record(input);
  check(
    deck.schemaVersion === 1 &&
      typeof deck.sourceId === "string" &&
      /^pptx:[0-9a-f]{64}$/.test(deck.sourceId) &&
      deck.id === deck.sourceId &&
      Object.hasOwn(sources, deck.sourceId) &&
      sources[deck.sourceId].mime === PPTX_MIME &&
      text(deck.name, 180) &&
      number(deck.width, 1, 8_192) &&
      number(deck.height, 1, 8_192),
    "deck",
  );

  let totalElements = 0;
  let totalText = 0;
  let totalTableCells = 0;
  const validateText = (value: unknown) => {
    const body = record(value);
    const inset = list(body.inset, 4);
    check(
      inset.length === 4 &&
        inset.every((i) => number(i, 0, MAX_PPTX_COORD)) &&
        ["top", "middle", "bottom"].includes(String(body.align)) &&
        typeof body.wrap === "boolean",
      "text box",
    );
    for (const rawParagraph of list(body.paragraphs, 2_000)) {
      const paragraph = record(rawParagraph);
      check(
        ["left", "center", "right", "justify"].includes(
          String(paragraph.align),
        ) &&
          number(paragraph.marginLeft, 0, MAX_PPTX_COORD) &&
          number(paragraph.indent, -MAX_PPTX_COORD, MAX_PPTX_COORD) &&
          number(paragraph.spaceBefore, 0, MAX_PPTX_COORD) &&
          number(paragraph.spaceAfter, 0, MAX_PPTX_COORD) &&
          (paragraph.lineHeight === undefined ||
            number(paragraph.lineHeight, 0.1, 10)) &&
          (paragraph.bullet === undefined || text(paragraph.bullet, 80)),
        "paragraph",
      );
      for (const rawRun of list(paragraph.runs, 2_000)) {
        const run = record(rawRun);
        check(
          text(run.text, 64_000) &&
            text(run.fontFamily, 120) &&
            /^[\p{L}\p{M}\p{N} ._'\u2019-]{1,120}$/u.test(run.fontFamily) &&
            number(run.fontSize, 0.1, 2_000) &&
            color(run.color) &&
            typeof run.bold === "boolean" &&
            typeof run.italic === "boolean" &&
            typeof run.underline === "boolean",
          "text run",
        );
        totalText += run.text.length + 1;
        check(totalText <= MAX_PPTX_TEXT, "deck text budget");
      }
    }
  };

  const slideIds = new Set<string>();
  const slideParts = new Set<string>();
  const slides = list(deck.slides, MAX_PPTX_SLIDES);
  check(slides.length > 0, "slide count");
  for (const rawSlide of slides) {
    const slide = record(rawSlide);
    check(
      identifier(slide.id) &&
        /^slide:[1-9][0-9]{2,9}$/.test(slide.id) &&
        number(
          Number(slide.id.slice(6)),
          MIN_SOURCE_SLIDE_ID,
          MAX_SOURCE_SLIDE_ID,
        ) &&
        !slideIds.has(slide.id) &&
        typeof slide.sourcePart === "string" &&
        part(slide.sourcePart) &&
        !slideParts.has(slide.sourcePart) &&
        (slide.layoutPart === undefined || part(slide.layoutPart)) &&
        (slide.themePart === undefined || part(slide.themePart)) &&
        (slide.notesPart === undefined || part(slide.notesPart)) &&
        text(slide.title, 300) &&
        typeof slide.hidden === "boolean" &&
        color(slide.background),
      "slide",
    );
    slideIds.add(slide.id);
    slideParts.add(slide.sourcePart);

    const elementIds = new Set<string>();
    const validateElements = (value: unknown, depth: number) => {
      check(depth <= 24, "group nesting depth");
      for (const rawElement of list(value, MAX_PPTX_SLIDE_ELEMENTS)) {
        const element = record(rawElement);
        check(
          identifier(element.id) &&
            !elementIds.has(element.id) &&
            identifier(element.sourceId) &&
            text(element.name, 180) &&
            number(element.x, -MAX_PPTX_COORD, MAX_PPTX_COORD) &&
            number(element.y, -MAX_PPTX_COORD, MAX_PPTX_COORD) &&
            number(element.width, 0, MAX_PPTX_COORD) &&
            number(element.height, 0, MAX_PPTX_COORD) &&
            number(element.rotation, -360, 360) &&
            typeof element.flipX === "boolean" &&
            typeof element.flipY === "boolean" &&
            typeof element.hidden === "boolean",
          "element geometry",
        );
        elementIds.add(element.id);
        check(
          ++totalElements <= MAX_PPTX_ELEMENTS &&
            elementIds.size <= MAX_PPTX_SLIDE_ELEMENTS,
          "element budget",
        );
        switch (element.kind) {
          case "group": {
            const childBox = list(element.childBox, 4);
            check(
              childBox.length === 4 &&
                childBox.every((item, index) =>
                  number(
                    item,
                    index < 2 ? -MAX_PPTX_COORD : 0.001,
                    MAX_PPTX_COORD,
                  ),
                ),
              "group geometry",
            );
            validateElements(element.children, depth + 1);
            break;
          }
          case "image": {
            const crop = list(element.crop, 4);
            check(
              crop.length === 4 &&
                crop.every((item) => number(item, 0, 0.999)) &&
                Number(crop[0]) + Number(crop[2]) < 1 &&
                Number(crop[1]) + Number(crop[3]) < 1 &&
                typeof element.assetId === "string" &&
                /^pptx-image:[a-f0-9]{64}$/.test(element.assetId) &&
                Object.hasOwn(sources, element.assetId) &&
                ["image/jpeg", "image/png"].includes(
                  sources[element.assetId].mime,
                ),
              "image or missing asset",
            );
            break;
          }
          case "table": {
            const columns = list(element.columns, 100);
            check(
              columns.length &&
                columns.every((item) => number(item, 0.001, MAX_PPTX_COORD)),
              "table columns",
            );
            const rows = list(element.rows, 150);
            check(rows.length > 0, "table rows");
            totalTableCells += rows.length * columns.length;
            check(totalTableCells <= 10_000, "table cell budget");
            for (const rawRow of rows) {
              const row = record(rawRow);
              check(
                number(row.height, 0.001, MAX_PPTX_COORD),
                "table row height",
              );
              const cells = list(row.cells, columns.length);
              check(cells.length === columns.length, "table cells");
              for (const rawCell of cells) {
                const cell = record(rawCell);
                check(
                  color(cell.fill, true) &&
                    color(cell.stroke, true) &&
                    number(cell.colSpan, 1, columns.length) &&
                    Number.isInteger(cell.colSpan) &&
                    number(cell.rowSpan, 1, rows.length) &&
                    Number.isInteger(cell.rowSpan) &&
                    typeof cell.merged === "boolean",
                  "table cell style",
                );
                validateText(cell.text);
              }
            }
            break;
          }
          case "shape":
            check(
              (SLIDE_SHAPES as readonly string[]).includes(
                String(element.shape),
              ) &&
                color(element.fill, true) &&
                color(element.stroke, true) &&
                number(element.strokeWidth, 0, 2_000) &&
                (element.arrowStart === undefined ||
                  typeof element.arrowStart === "boolean") &&
                (element.arrowEnd === undefined ||
                  typeof element.arrowEnd === "boolean"),
              "shape style",
            );
            if (element.text !== undefined) validateText(element.text);
            break;
          case "unsupported":
            check(text(element.reason, 300), "unsupported element");
            break;
          default:
            check(false, "element type");
        }
      }
    };
    validateElements(slide.elements, 0);
    const buildIds = new Set<string>();
    for (const rawBuild of list(slide.builds, MAX_PPTX_BUILDS)) {
      const build = record(rawBuild);
      const targets = list(build.targetElementIds, MAX_PPTX_SLIDE_ELEMENTS);
      check(
        identifier(build.id) &&
          !buildIds.has(build.id) &&
          ["onClick", "withPrevious", "afterPrevious"].includes(
            String(build.trigger),
          ) &&
          ["appear", "fallback"].includes(String(build.effect)) &&
          (targets.length > 0 || build.effect === "fallback") &&
          targets.every(
            (target) => typeof target === "string" && elementIds.has(target),
          ) &&
          number(build.delayMs, 0, MAX_PPTX_TIME) &&
          number(build.durationMs, 0, MAX_PPTX_TIME) &&
          (build.group === undefined ||
            (number(build.group, 0, MAX_PPTX_BUILDS) &&
              Number.isInteger(build.group))) &&
          (build.startMs === undefined ||
            number(build.startMs, 0, MAX_PPTX_TIME)) &&
          (build.presetId === undefined || text(build.presetId, 40)) &&
          (build.presetClass === undefined || text(build.presetClass, 40)),
        "build timeline",
      );
      buildIds.add(build.id);
    }
  }
  for (const rawDiagnostic of list(deck.diagnostics, MAX_PPTX_DIAGNOSTICS)) {
    const diagnostic = record(rawDiagnostic);
    check(
      identifier(diagnostic.code) &&
        text(diagnostic.message, 500) &&
        (diagnostic.slideId === undefined ||
          (typeof diagnostic.slideId === "string" &&
            slideIds.has(diagnostic.slideId))) &&
        (diagnostic.elementId === undefined ||
          identifier(diagnostic.elementId)),
      "diagnostic",
    );
  }
  return input as SlideDocument;
}
