import {
  attribute,
  child,
  descendants,
  elements,
  M,
  R,
  type XmlElement,
} from "../documents/package.ts";
import {
  MAX_PPTX_COORD,
  MAX_PPTX_ELEMENTS,
  MAX_PPTX_SLIDE_ELEMENTS,
  MAX_PPTX_TEXT,
  SLIDE_SHAPES,
  type SlideElement,
  type SlideElementBase,
  type SlideParagraph,
  type SlideRun,
  type SlideShapeKind,
  type SlideText,
} from "./model.ts";
import {
  a,
  A,
  as,
  attr,
  boundedText,
  MC,
  numeric,
  off,
  on,
  p,
  P,
  percent,
  px,
} from "./xml.ts";

type Layer = { root: XmlElement; part: string };
type Report = (code: string, message: string, elementId?: string) => void;
export type SceneBudget = { elements: number; text: number; cells: number };
type SceneOptions = {
  slideId: string;
  slide: Layer;
  layout?: Layer;
  master?: Layer;
  theme?: XmlElement;
  defaultTextStyle?: XmlElement;
  budget: SceneBudget;
  report: Report;
  image(part: string, relationId: string, linked: boolean): Promise<string>;
};

const defaultColors: Record<string, string> = {
  dk1: "#000000",
  lt1: "#ffffff",
  dk2: "#1f497d",
  lt2: "#eeece1",
  accent1: "#4472c4",
  accent2: "#ed7d31",
  accent3: "#a5a5a5",
  accent4: "#ffc000",
  accent5: "#5b9bd5",
  accent6: "#70ad47",
  hlink: "#0563c1",
  folHlink: "#954f72",
};
const defaultColorMap: Record<string, string> = {
  bg1: "lt1",
  tx1: "dk1",
  bg2: "lt2",
  tx2: "dk2",
};
const validFont = /^[\p{L}\p{M}\p{N} ._'\u2019-]{1,120}$/u;
const normalizeHex = (value: string) =>
  /^[a-f\d]{6}$/i.test(value) ? `#${value.toLowerCase()}` : undefined;

function commonRoot(layer: Layer | undefined) {
  return p(layer?.root, "cSld");
}

function shapeTree(layer: Layer | undefined) {
  const tree = p(commonRoot(layer), "spTree");
  return tree ? elements(tree) : [];
}

function colorContext({ theme, slide, layout, master }: SceneOptions) {
  const themeElements = a(theme, "themeElements");
  const colors = { ...defaultColors };
  const scheme = a(themeElements, "clrScheme");
  if (scheme) {
    for (const node of elements(scheme)) {
      const name = node.localName ?? "";
      if (!Object.hasOwn(defaultColors, name)) continue;
      const hex = normalizeHex(
        attr(a(node, "srgbClr"), "val") || attr(a(node, "sysClr"), "lastClr"),
      );
      if (hex) colors[name] = hex;
    }
  }
  const map = { ...defaultColorMap };
  for (const mapping of [
    p(master?.root, "clrMap"),
    a(p(layout?.root, "clrMapOvr"), "overrideClrMapping"),
    a(p(slide.root, "clrMapOvr"), "overrideClrMapping"),
  ]) {
    for (const key of [
      ...Object.keys(defaultColors),
      ...Object.keys(defaultColorMap),
    ]) {
      const value = attr(mapping, key);
      if (value && Object.hasOwn(colors, value)) map[key] = value;
    }
  }
  const fonts = a(themeElements, "fontScheme");
  const family = (kind: "majorFont" | "minorFont") =>
    attr(a(a(fonts, kind), "latin"), "typeface");
  return {
    colors,
    map,
    major: family("majorFont"),
    minor: family("minorFont"),
    styles: a(themeElements, "fmtScheme"),
  };
}
type ColorContext = ReturnType<typeof colorContext>;

function schemeColor(value: string, theme: ColorContext) {
  const key = Object.hasOwn(theme.map, value) ? theme.map[value] : value;
  return Object.hasOwn(theme.colors, key) ? theme.colors[key] : undefined;
}

function colorFrom(
  owner: XmlElement | undefined,
  theme: ColorContext,
  placeholder?: string,
  report?: (message: string) => void,
): string | undefined {
  if (!owner) return undefined;
  const color = elements(owner).find(
    (node) =>
      node.namespaceURI === A &&
      ["srgbClr", "sysClr", "schemeClr", "scrgbClr"].includes(
        node.localName ?? "",
      ),
  );
  if (!color) return undefined;
  const val = attr(color, "val");
  let hex: string | undefined;
  if (color.localName === "schemeClr")
    hex = val === "phClr" ? placeholder : schemeColor(val, theme);
  else if (color.localName === "scrgbClr") {
    const gamma = (linear: number) =>
      linear <= 0.0031308
        ? linear * 12.92
        : 1.055 * linear ** (1 / 2.4) - 0.055;
    hex =
      "#" +
      ["r", "g", "b"]
        .map((channel) => byte(gamma(percent(attr(color, channel))) * 255))
        .join("");
  } else
    hex = normalizeHex(
      color.localName === "sysClr" ? attr(color, "lastClr") : val,
    );
  if (!hex) return undefined;
  let rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  let opacity = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1;
  for (const modifier of elements(color)) {
    if (modifier.namespaceURI !== A) continue;
    const amount = percent(attr(modifier, "val"));
    switch (modifier.localName) {
      case "tint":
        rgb = rgb.map((v) => v * amount + 255 * (1 - amount));
        break;
      case "shade":
        rgb = rgb.map((v) => v * amount);
        break;
      case "lum":
        rgb = luminance(rgb, () => amount);
        break;
      case "lumMod":
        rgb = luminance(rgb, (light) => light * amount);
        break;
      case "lumOff":
        rgb = luminance(rgb, (light) => light + amount);
        break;
      case "alpha":
        opacity = amount;
        break;
      case "alphaMod":
        opacity *= amount;
        break;
      case "alphaOff":
        opacity += amount;
        break;
      default:
        report?.("An unsupported color modifier is ignored.");
        break;
    }
  }
  return `#${rgb.map(byte).join("")}${opacity < 1 ? byte(opacity * 255) : ""}`;
}

/** Change HSL luminance while preserving hue and saturation. */
function luminance(rgb: number[], change: (light: number) => number) {
  const channels = rgb.map((value) => Math.min(1, Math.max(0, value / 255)));
  const light = (Math.min(...channels) + Math.max(...channels)) / 2;
  const next = Math.min(1, Math.max(0, change(light)));
  const range = 1 - Math.abs(2 * light - 1);
  if (range === 0) return channels.map(() => next * 255);
  const scale = (1 - Math.abs(2 * next - 1)) / range;
  return channels.map((channel) => (next + (channel - light) * scale) * 255);
}

function byte(value: number) {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");
}

function fillFrom(
  owner: XmlElement | undefined,
  theme: ColorContext,
  report: (message: string) => void,
  placeholder?: string,
): string | null | undefined {
  if (a(owner, "noFill")) return null;
  const solid = a(owner, "solidFill");
  if (solid) {
    const resolved = colorFrom(solid, theme, placeholder, report);
    if (!resolved)
      report("The fill color is not recognized. A neutral fill is used.");
    return resolved ?? "#ededed";
  }
  const gradient = a(owner, "gradFill");
  if (gradient) {
    report("Gradient fill is approximated using its first color stop.");
    return (
      colorFrom(
        as(a(gradient, "gsLst"), "gs")[0],
        theme,
        placeholder,
        report,
      ) ?? "#ededed"
    );
  }
  if (a(owner, "pattFill") || a(owner, "blipFill") || a(owner, "grpFill")) {
    report("Pattern, picture or group fill is not rendered.");
    return null;
  }
  return undefined;
}

function referencedFill(
  ref: XmlElement | undefined,
  theme: ColorContext,
  report: (message: string) => void,
) {
  if (!ref) return undefined;
  const index = numeric(attr(ref, "idx"));
  if (index === 0 || index === 1_000) return null;
  const list =
    index > 1_000
      ? a(theme.styles, "bgFillStyleLst")
      : a(theme.styles, "fillStyleLst");
  const style =
    list && elements(list)[index > 1_000 ? index - 1_001 : index - 1];
  const placeholder = colorFrom(ref, theme, undefined, report);
  if (!style) return placeholder;
  if (style.localName === "solidFill")
    return colorFrom(style, theme, placeholder, report) ?? placeholder;
  if (style.localName === "noFill") return null;
  if (style.localName === "gradFill") {
    report("Theme gradient is approximated using its first color stop.");
    return (
      colorFrom(as(a(style, "gsLst"), "gs")[0], theme, placeholder, report) ??
      placeholder
    );
  }
  report("A theme picture or pattern fill is not rendered.");
  return placeholder;
}

function first<T>(values: Array<T | undefined>): T | undefined {
  return values.find((value): value is T => value !== undefined);
}

function firstAttr(nodes: (XmlElement | undefined)[], name: string): string {
  return (
    nodes.map((node) => attr(node, name)).find((value) => value !== "") ?? ""
  );
}

function dimensions(node: XmlElement | undefined, x: string, y: string) {
  return [px(attr(node, x)), px(attr(node, y))] as const;
}

function nonVisual(node: XmlElement) {
  return elements(node).find(
    (child) => child.namespaceURI === P && child.localName?.startsWith("nv"),
  );
}

function placeholder(node: XmlElement) {
  return p(p(nonVisual(node), "nvPr"), "ph");
}

function placeholderMatch(node: XmlElement, candidates: XmlElement[]) {
  const own = placeholder(node);
  if (!own) return undefined;
  const idx = attr(own, "idx");
  const type = attr(own, "type") || "obj";
  const title = type === "title" || type === "ctrTitle";
  const pairs = candidates.flatMap((candidate) => {
    const ph = placeholder(candidate);
    return ph ? [{ candidate, ph }] : [];
  });
  const byIndex = idx
    ? pairs.find(({ ph }) => attr(ph, "idx") === idx)
    : undefined;
  const byType = pairs.find(({ ph }) => {
    const value = attr(ph, "type") || "obj";
    return (
      value === type || (title && (value === "title" || value === "ctrTitle"))
    );
  });
  return byIndex?.candidate ?? byType?.candidate;
}

function shapeProperties(node: XmlElement | undefined) {
  return p(node, "spPr") ?? p(node, "grpSpPr");
}

function transform(node: XmlElement | undefined) {
  return a(shapeProperties(node), "xfrm") ?? p(node, "xfrm");
}

function readText(
  body: XmlElement,
  inherit: XmlElement[],
  theme: ColorContext,
  budget: SceneBudget,
  report: (message: string) => void,
  cell?: XmlElement,
): SlideText {
  const bp = [a(body, "bodyPr"), ...inherit.map((item) => a(item, "bodyPr"))];
  const listStyles = [
    a(body, "lstStyle"),
    ...inherit.map((item) => a(item, "lstStyle") ?? item),
  ];
  const inset = [
    px(firstAttr([cell, ...bp], cell ? "marT" : "tIns"), 4.8),
    px(firstAttr([cell, ...bp], cell ? "marR" : "rIns"), 9.6),
    px(firstAttr([cell, ...bp], cell ? "marB" : "bIns"), 4.8),
    px(firstAttr([cell, ...bp], cell ? "marL" : "lIns"), 9.6),
  ] as SlideText["inset"];
  const anchor = firstAttr([cell, ...bp], "anchor");
  const orientation = firstAttr([cell, ...bp], "vert");
  if (orientation && orientation !== "horz")
    report("Vertical text is laid out horizontally.");
  if (
    bp.some(
      (properties) =>
        a(properties, "normAutofit") || a(properties, "spAutoFit"),
    )
  )
    report(
      "PowerPoint text autofit is approximated using the stored text box.",
    );

  const counters = new Map<number, number>();
  const paragraphs = as(body, "p").map((paragraph): SlideParagraph => {
    const pp = a(paragraph, "pPr");
    const level = Math.min(8, Math.max(0, numeric(attr(pp, "lvl"))));
    const props = [
      pp,
      ...listStyles.map((style) => a(style, `lvl${level + 1}pPr`)),
      ...listStyles.map((style) => a(style, "defPPr")),
    ];
    const defaults = props.map((item) => a(item, "defRPr"));
    const align = firstAttr(props, "algn");
    const spacing = (tag: string) => {
      const container = first(props.map((style) => a(style, tag)));
      const points = attr(a(container, "spcPts"), "val");
      return numeric(points) / 75;
    };
    const line = first(props.map((style) => a(style, "lnSpc")));
    const multiplier = percent(attr(a(line, "spcPct"), "val"), 0);
    if (a(line, "spcPts"))
      report("Fixed line spacing is approximated using browser line height.");
    const bullet = first(
      props.map(
        (style) =>
          a(style, "buNone") ??
          a(style, "buChar") ??
          a(style, "buAutoNum") ??
          a(style, "buBlip"),
      ),
    );
    let marker: string | undefined;
    if (bullet?.localName === "buChar")
      marker = boundedText(attr(bullet, "char"), 80);
    if (bullet?.localName === "buBlip") {
      marker = "•";
      report("Image bullets are shown as text bullets.");
    }
    if (bullet?.localName === "buAutoNum") {
      const start = Math.max(1, numeric(attr(bullet, "startAt"), 1));
      const number = counters.get(level) ?? start;
      counters.set(level, number + 1);
      marker = `${number}.`;
      if (attr(bullet, "type") !== "arabicPeriod")
        report("This numbering format is displayed as Arabic numerals.");
    } else counters.delete(level);
    for (const deeper of counters.keys())
      if (deeper > level) counters.delete(deeper);
    const runs = elements(paragraph).flatMap((node): SlideRun[] => {
      if (
        node.namespaceURI !== A ||
        !["r", "fld", "br"].includes(node.localName ?? "")
      )
        return [];
      const rawText =
        node.localName === "br" ? "\n" : (a(node, "t")?.textContent ?? "");
      if (!rawText) return [];
      if (
        rawText.length > 64_000 ||
        (budget.text += rawText.length + 1) > MAX_PPTX_TEXT
      )
        throw new Error("PowerPoint deck text exceeds its resource budget.");
      const rpr = [a(node, "rPr"), ...defaults, a(paragraph, "endParaRPr")];
      const font = firstAttr(
        rpr.map((item) => a(item, "latin")),
        "typeface",
      );
      const resolved = font.startsWith("+mj")
        ? theme.major
        : font.startsWith("+mn")
          ? theme.minor
          : font || theme.minor;
      const underline = firstAttr(rpr, "u");
      const runPaint = first(rpr.map((item) => fillFrom(item, theme, report)));
      return [
        {
          text: boundedText(rawText, 64_000),
          fontFamily: validFont.test(resolved) ? resolved : "Arial",
          fontSize: numeric(firstAttr(rpr, "sz"), 1_800) / 75,
          color:
            runPaint === null
              ? "#00000000"
              : (runPaint ?? schemeColor("tx1", theme) ?? "#000000"),
          bold: on(firstAttr(rpr, "b")),
          italic: on(firstAttr(rpr, "i")),
          underline: !!underline && underline !== "none",
        },
      ];
    });
    return {
      align:
        align === "ctr"
          ? "center"
          : align === "r"
            ? "right"
            : ["just", "justLow", "dist", "thaiDist"].includes(align)
              ? "justify"
              : "left",
      marginLeft: Math.max(0, px(firstAttr(props, "marL"))),
      indent: px(firstAttr(props, "indent")),
      spaceBefore: spacing("spcBef"),
      spaceAfter: spacing("spcAft"),
      lineHeight:
        multiplier >= 0.1 && multiplier <= 10 ? multiplier : undefined,
      bullet: marker,
      runs,
    };
  });
  return {
    paragraphs,
    inset,
    align: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
    wrap: firstAttr(bp, "wrap") !== "none",
  };
}

export async function readSlideScene(options: SceneOptions) {
  const { budget, report, slide, layout, master, slideId } = options;
  const theme = colorContext(options);
  const layoutNodes = shapeTree(layout);
  const masterNodes = shapeTree(master);
  const localElementIds = new Map<string, string>();
  const seen = new Set<string>();
  let count = 0;
  let title = "";

  const readElement = async (
    node: XmlElement,
    layer: Layer,
    scope: "master" | "layout" | "slide",
    depth: number,
  ): Promise<SlideElement | undefined> => {
    if (
      node.namespaceURI === P &&
      ["nvGrpSpPr", "grpSpPr", "extLst"].includes(node.localName ?? "")
    )
      return;
    if (scope !== "slide" && placeholder(node)) return;
    if (
      ++budget.elements > MAX_PPTX_ELEMENTS ||
      ++count > MAX_PPTX_SLIDE_ELEMENTS ||
      depth > 24
    )
      throw new Error(
        "PowerPoint shapes exceed the slide/deck resource budget.",
      );
    const alternate =
      node.namespaceURI === MC && node.localName === "AlternateContent";
    const fallback = alternate ? child(node, MC, "Fallback") : undefined;
    const fallbackShape =
      fallback && elements(fallback).find((item) => item.namespaceURI === P);
    const choice = alternate ? child(node, MC, "Choice") : undefined;
    const choiceShape =
      choice && elements(choice).find((item) => item.namespaceURI === P);
    const geometryNode = fallbackShape ?? choiceShape ?? node;
    const nv = p(nonVisual(geometryNode), "cNvPr");
    const rawId = attr(nv, "id");
    const sourceId = /^\d{1,20}$/.test(rawId) ? rawId : `order-${count}`;
    const id = `${slideId}:${scope}:${sourceId}`;
    if (seen.has(id)) throw new Error("Duplicate PowerPoint shape identity.");
    seen.add(id);
    if (scope === "slide" && rawId) localElementIds.set(rawId, id);
    const localPlaceholder = placeholder(geometryNode);
    const fromLayout =
      scope === "slide" ? placeholderMatch(node, layoutNodes) : undefined;
    const fromMaster =
      scope === "slide"
        ? placeholderMatch(fromLayout ?? node, masterNodes)
        : undefined;
    const inherited = [fromLayout, fromMaster].filter(
      (item): item is XmlElement => !!item,
    );
    const chain = [geometryNode, ...inherited];
    const xfrms = chain.map(transform);
    const [x, y] = dimensions(
      first(xfrms.map((item) => a(item, "off"))),
      "x",
      "y",
    );
    const [width, height] = dimensions(
      first(xfrms.map((item) => a(item, "ext"))),
      "cx",
      "cy",
    );
    const rotation = (numeric(firstAttr(xfrms, "rot")) / 60_000) % 360;
    const base: SlideElementBase = {
      id,
      sourceId,
      x,
      y,
      width,
      height,
      rotation,
      name: boundedText(attr(nv, "name") || node.localName || "Shape", 180),
      flipX: on(firstAttr(xfrms, "flipH")),
      flipY: on(firstAttr(xfrms, "flipV")),
      hidden: on(attr(nv, "hidden")),
    };
    const unsupported = (code: string, reason: string): SlideElement => {
      report(code, reason, id);
      return { ...base, kind: "unsupported", reason };
    };
    if (
      [x, y, width, height].some((value) => Math.abs(value) > MAX_PPTX_COORD) ||
      width < 0 ||
      height < 0
    )
      throw new Error(
        "PowerPoint shape coordinates exceed the resource budget.",
      );
    const flagMath = descendants(node, M, "oMath").length > 0;
    const picture = async (
      fill: XmlElement | undefined,
    ): Promise<SlideElement> => {
      const blip = a(fill, "blip");
      const embedded = attribute(blip, R, "embed");
      const linked = attribute(blip, R, "link");
      const svg =
        blip &&
        descendants(
          blip,
          "http://schemas.microsoft.com/office/drawing/2016/SVG/main",
          "svgBlip",
        ).length > 0;
      if (!embedded && linked)
        return unsupported(
          "external-resource",
          "A linked picture was blocked. No external file was fetched.",
        );
      if (!embedded && svg)
        return unsupported(
          "image",
          "SVG pictures require an embedded PNG or JPEG fallback.",
        );
      if (!embedded)
        return unsupported("image", "A picture has no embedded image source.");
      let assetId: string;
      try {
        assetId = await options.image(layer.part, embedded, !!linked);
      } catch (error) {
        const reason =
          error instanceof Error
            ? boundedText(error.message, 300)
            : "Embedded picture is unavailable.";
        return unsupported("image", reason);
      }
      if (svg)
        report(
          "image-fallback",
          "The embedded raster fallback is used for this SVG picture.",
          id,
        );
      const srcRect = a(fill, "srcRect");
      let crop = ["l", "t", "r", "b"].map((side) =>
        percent(attr(srcRect, side)),
      ) as [number, number, number, number];
      if (
        crop.some((value) => value < 0 || value >= 1) ||
        crop[0] + crop[2] >= 1 ||
        crop[1] + crop[3] >= 1
      ) {
        report(
          "image-crop",
          "Extended or invalid picture crop is not supported. The image is shown uncropped.",
          id,
        );
        crop = [0, 0, 0, 0];
      }
      if (a(fill, "tile"))
        report(
          "image-fill",
          "Tiled picture fill is shown as a single image.",
          id,
        );
      const fillRect = a(a(fill, "stretch"), "fillRect");
      if (
        ["l", "t", "r", "b"].some((side) => percent(attr(fillRect, side)) !== 0)
      )
        report(
          "image-fill",
          "Picture fill insets are fitted to the stored shape bounds.",
          id,
        );
      return { ...base, kind: "image", assetId, crop };
    };
    if (alternate) {
      const safeImageFill =
        p(fallbackShape, "blipFill") ??
        a(shapeProperties(fallbackShape), "blipFill");
      if (flagMath && safeImageFill) {
        const image = await picture(safeImageFill);
        if (image.kind === "image") {
          report(
            "math-fallback",
            "The source equation uses its embedded picture. Native OMML remains in the original PPTX.",
            id,
          );
          return image;
        }
      }
      return unsupported(
        flagMath ? "math" : "alternate-content",
        flagMath
          ? "The source equation has no supported PNG/JPEG fallback."
          : "Alternate Office drawing content requires a supported source representation.",
      );
    }
    if (node.namespaceURI !== P)
      return unsupported(
        "element",
        "An unsupported extension element is present in the slide.",
      );
    if (flagMath && node.localName !== "grpSp")
      return unsupported(
        "math",
        "PowerPoint embedded equations are preserved in the source and are not rendered.",
      );

    if (node.localName === "grpSp") {
      const xf = transform(node);
      const [cx, cy] = dimensions(a(xf, "chOff"), "x", "y");
      const [cw, ch] = dimensions(a(xf, "chExt"), "cx", "cy");
      if (cw <= 0 || ch <= 0)
        return unsupported(
          "group",
          "A group has missing or invalid child coordinates.",
        );
      const children: SlideElement[] = [];
      for (const item of elements(node)) {
        const element = await readElement(item, layer, scope, depth + 1);
        if (element) children.push(element);
      }
      return { ...base, kind: "group", children, childBox: [cx, cy, cw, ch] };
    }
    if (node.localName === "pic") {
      const metadata = p(nonVisual(node), "nvPr");
      if (a(metadata, "videoFile") || a(metadata, "audioFile"))
        report(
          "media",
          "Embedded video or audio is not played. The poster image is used if available.",
          id,
        );
      return picture(p(node, "blipFill"));
    }
    if (node.localName === "graphicFrame") {
      const graphic = a(a(node, "graphic"), "graphicData");
      const table = a(graphic, "tbl");
      if (!table) {
        const uri = attr(graphic, "uri");
        if (uri.endsWith("/chart") || uri.endsWith("/chartex"))
          return unsupported(
            "chart",
            "PowerPoint charts are preserved in the source and are not rendered.",
          );
        if (descendants(node, P, "oleObj").length)
          return unsupported(
            "ole",
            "OLE objects are preserved in the source and are never executed.",
          );
        if (uri.endsWith("/diagram"))
          return unsupported(
            "smartart",
            "SmartArt is preserved in the source and is not rendered.",
          );
        return unsupported(
          "graphic",
          "This PowerPoint graphic frame is not supported.",
        );
      }
      const columns = as(a(table, "tblGrid"), "gridCol").map((column) =>
        px(attr(column, "w")),
      );
      const sourceRows = as(table, "tr");
      if (
        !columns.length ||
        columns.length > 100 ||
        !sourceRows.length ||
        sourceRows.length > 150 ||
        columns.some((value) => value <= 0)
      )
        return unsupported(
          "table",
          "The table dimensions are outside the supported subset.",
        );
      budget.cells += columns.length * sourceRows.length;
      if (budget.cells > 10_000)
        throw new Error(
          "PowerPoint table cells exceed the deck resource budget.",
        );
      if (
        sourceRows.some(
          (row) =>
            as(row, "tc").length !== columns.length || px(attr(row, "h")) <= 0,
        )
      )
        return unsupported(
          "table",
          "This table uses an unsupported cell grid.",
        );
      if (a(a(table, "tblPr"), "tableStyleId"))
        report(
          "table-style",
          "Theme table styles are approximated using direct cell formatting.",
          id,
        );
      const format = (message: string) => report("table-style", message, id);
      const rows = sourceRows.map((row, r) => ({
        height: px(attr(row, "h")),
        cells: as(row, "tc").map((cell, c) => {
          const properties = a(cell, "tcPr");
          const textBody = a(cell, "txBody");
          const border = first(
            ["lnL", "lnR", "lnT", "lnB"].map((side) => a(properties, side)),
          );
          const borderPaint = fillFrom(border, theme, format);
          return {
            text: textBody
              ? readText(textBody, [], theme, budget, format, properties)
              : {
                  paragraphs: [],
                  inset: [0, 0, 0, 0] as SlideText["inset"],
                  align: "top" as const,
                  wrap: true,
                },
            fill: fillFrom(properties, theme, format) ?? null,
            stroke: borderPaint === undefined ? "#bbc4cf" : borderPaint,
            colSpan: Math.max(
              1,
              Math.min(columns.length - c, numeric(attr(cell, "gridSpan"), 1)),
            ),
            rowSpan: Math.max(
              1,
              Math.min(
                sourceRows.length - r,
                numeric(attr(cell, "rowSpan"), 1),
              ),
            ),
            merged: on(attr(cell, "hMerge")) || on(attr(cell, "vMerge")),
          };
        }),
      }));
      return { ...base, kind: "table", columns, rows };
    }
    if (node.localName !== "sp" && node.localName !== "cxnSp")
      return unsupported(
        "element",
        `Unsupported slide element: ${boundedText(node.localName ?? "unknown", 100)}.`,
      );

    const properties = chain.map(shapeProperties);
    const preset = first(properties.map((item) => a(item, "prstGeom")));
    const rawShape =
      attr(preset, "prst") || (node.localName === "cxnSp" ? "line" : "rect");
    const connector = [
      "straightConnector1",
      "bentConnector2",
      "bentConnector3",
      "bentConnector4",
      "bentConnector5",
      "curvedConnector2",
      "curvedConnector3",
      "curvedConnector4",
      "curvedConnector5",
    ].includes(rawShape);
    const shape = connector ? "line" : rawShape;
    if (
      properties.some((item) => a(item, "custGeom")) ||
      !(SLIDE_SHAPES as readonly string[]).includes(shape)
    )
      return unsupported(
        "shape",
        `PowerPoint geometry ${boundedText(rawShape, 100)} is outside the supported shape subset.`,
      );
    if (connector && rawShape !== "straightConnector1")
      report(
        "shape",
        "Bent or curved connectors are approximated by a straight line.",
        id,
      );
    if (as(a(preset, "avLst"), "gd").length)
      report(
        "shape-adjustment",
        "Shape adjustment handles use the standard preset geometry.",
        id,
      );
    const fillReport = (message: string) => report("shape-style", message, id);
    const style = first(chain.map((item) => p(item, "style")));
    const directFill = first(
      properties.map((item) => fillFrom(item, theme, fillReport)),
    );
    const fill =
      shape === "line"
        ? null
        : directFill !== undefined
          ? directFill
          : (referencedFill(a(style, "fillRef"), theme, fillReport) ?? null);
    const ln = first(properties.map((item) => a(item, "ln")));
    const lnRef = a(style, "lnRef");
    const lnIndex = numeric(attr(lnRef, "idx"));
    const lnStyle = as(a(theme.styles, "lnStyleLst"), "ln")[lnIndex - 1];
    const directStroke = fillFrom(ln, theme, fillReport);
    const lnColor =
      lnIndex > 0 ? colorFrom(lnRef, theme, undefined, fillReport) : undefined;
    const themeStroke = fillFrom(lnStyle, theme, fillReport, lnColor);
    const stroke =
      directStroke !== undefined
        ? directStroke
        : themeStroke !== undefined
          ? themeStroke
          : (lnColor ?? (shape === "line" && !lnRef ? "#000000" : null));
    if (a(ln, "prstDash") && attr(a(ln, "prstDash"), "val") !== "solid")
      report(
        "shape-style",
        "Non-solid strokes are displayed as solid strokes.",
        id,
      );
    if (
      properties.some(
        (item) =>
          a(item, "effectLst") && elements(a(item, "effectLst")!).length,
      )
    )
      report(
        "shape-style",
        "Shadows, glows and similar visual effects are not rendered.",
        id,
      );
    const body = p(node, "txBody");
    const phType =
      attr(localPlaceholder, "type") ||
      attr(placeholder(fromLayout ?? node), "type");
    const isTitle = phType === "title" || phType === "ctrTitle";
    const textStyles = p(master?.root, "txStyles");
    const masterStyle = p(
      textStyles,
      isTitle ? "titleStyle" : localPlaceholder ? "bodyStyle" : "otherStyle",
    );
    const text = body
      ? readText(
          body,
          [
            ...inherited.map((item) => p(item, "txBody")),
            masterStyle,
            options.defaultTextStyle,
          ].filter((item): item is XmlElement => !!item),
          theme,
          budget,
          (message) => report("text-layout", message, id),
        )
      : undefined;
    if (scope === "slide" && isTitle && !title && text)
      title = text.paragraphs
        .flatMap((paragraph) => paragraph.runs)
        .map((run) => run.text)
        .join(" ")
        .trim();
    const arrow = (side: string) => {
      const type = attr(a(ln, side), "type");
      if (type && !["none", "triangle", "arrow"].includes(type))
        report(
          "shape-style",
          "An unsupported arrowhead is approximated by a triangle.",
          id,
        );
      return type !== "" && type !== "none";
    };
    return {
      ...base,
      kind: "shape",
      shape: shape as SlideShapeKind,
      fill,
      stroke,
      strokeWidth: Math.max(
        0,
        px(firstAttr([ln, lnStyle], "w"), stroke ? 1 : 0),
      ),
      text,
      arrowStart: arrow("headEnd"),
      arrowEnd: arrow("tailEnd"),
    };
  };

  const result: SlideElement[] = [];
  const includeMaster =
    !off(attr(slide.root, "showMasterSp")) &&
    !off(attr(layout?.root, "showMasterSp"));
  const sources = [
    {
      layer: includeMaster ? master : undefined,
      scope: "master" as const,
      nodes: masterNodes,
    },
    { layer: layout, scope: "layout" as const, nodes: layoutNodes },
    { layer: slide, scope: "slide" as const, nodes: shapeTree(slide) },
  ];
  for (const { layer, scope, nodes } of sources) {
    if (!layer) continue;
    for (const node of nodes) {
      const element = await readElement(node, layer, scope, 0);
      if (element) result.push(element);
    }
  }
  const background = first(
    [slide, layout, master].map((layer) => p(commonRoot(layer), "bg")),
  );
  const backgroundReport = (message: string) =>
    report("background-style", message);
  const backgroundColor =
    fillFrom(p(background, "bgPr"), theme, backgroundReport) ??
    referencedFill(p(background, "bgRef"), theme, backgroundReport) ??
    schemeColor("bg1", theme) ??
    "#ffffff";
  return {
    title: boundedText(title || attr(commonRoot(slide), "name"), 300),
    background: backgroundColor,
    elements: result,
    localElementIds,
  };
}
