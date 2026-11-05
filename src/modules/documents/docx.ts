import { readImageHeader } from "../media/image-format.ts";
import { documentSource, DOCX_MIME } from "./sources.ts";
import type { DocumentSources } from "./sources.ts";
import { emptyDocument, validateDocument } from "./model.ts";
import type {
  BlockFormat,
  DocumentBlock,
  DocumentImportResult,
  DocumentSection,
  ImageInline,
  ParagraphBlock,
  TextFormat,
} from "./model.ts";
import {
  W,
  M,
  R,
  attribute,
  child,
  children,
  descendants,
  elements,
  readOoxmlPackage,
  serializeXml,
} from "./package.ts";
import type { OoxmlPackage, XmlElement } from "./package.ts";
import { convertOmml } from "./omml.ts";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const WP =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const V = "urn:schemas-microsoft-com:vml";
const O = "urn:schemas-microsoft-com:office:office";
const on = (el: XmlElement | undefined) =>
  !!el && !["0", "false", "off"].includes(attribute(el, W, "val"));
function numeric(
  text: string,
  divisor = 1,
  min = 0,
  max = 1200,
): number | undefined {
  const n = Number(text) / divisor;
  return text !== "" && Number.isFinite(n)
    ? Math.min(max, Math.max(min, n))
    : undefined;
}
const colors: Record<string, string> = {
  yellow: "#ffff00",
  green: "#00ff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  blue: "#0000ff",
  red: "#ff0000",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#c0c0c0",
  black: "#000000",
  white: "#ffffff",
};
function textFormat(pr: XmlElement | undefined): TextFormat {
  const out: TextFormat = {};
  if (!pr) return out;
  const font = child(pr, W, "rFonts"),
    family = attribute(font, W, "ascii") || attribute(font, W, "hAnsi");
  if (family && /^[\p{L}\p{N} .,_-]{1,100}$/u.test(family))
    out.fontFamily = family;
  const size = numeric(attribute(child(pr, W, "sz"), W, "val"), 2, 6, 144);
  if (size !== undefined) out.fontSize = size;
  for (const key of ["b", "i", "u"]) {
    const el = child(pr, W, key);
    if (el)
      out[
        ({ b: "bold", i: "italic", u: "underline" } as const)[
          key as "b" | "i" | "u"
        ]
      ] = key === "u" ? attribute(el, W, "val") !== "none" : on(el);
  }
  const color = attribute(child(pr, W, "color"), W, "val"),
    highlight = attribute(child(pr, W, "highlight"), W, "val");
  if (/^[a-f0-9]{6}$/i.test(color)) out.color = `#${color}`;
  if (colors[highlight]) out.highlight = colors[highlight];
  return out;
}
function blockFormat(pr: XmlElement | undefined): BlockFormat {
  const out: BlockFormat = { ...textFormat(child(pr, W, "rPr")) };
  if (!pr) return out;
  const align = attribute(child(pr, W, "jc"), W, "val");
  if (
    ["left", "center", "right", "both", "justify", "start", "end"].includes(
      align,
    )
  )
    out.align =
      align === "both"
        ? "justify"
        : align === "start"
          ? "left"
          : align === "end"
            ? "right"
            : (align as BlockFormat["align"]);
  const spacing = child(pr, W, "spacing"),
    before = numeric(attribute(spacing, W, "before"), 15),
    after = numeric(attribute(spacing, W, "after"), 15),
    line = numeric(attribute(spacing, W, "line"), 240, 0.8, 4);
  if (before !== undefined) out.before = before;
  if (after !== undefined) out.after = after;
  if (line !== undefined && attribute(spacing, W, "lineRule") !== "exact")
    out.lineHeight = line;
  const indent = numeric(
    attribute(child(pr, W, "ind"), W, "left"),
    15,
    -400,
    1200,
  );
  if (indent !== undefined) out.indent = indent;
  return out;
}
/** Parse declared WordprocessingML semantics. Raw generated HTML is never canonical. */
export async function parseDocx(
  bytes: Uint8Array,
  name: string,
  progress: (message: string) => void = () => {},
): Promise<DocumentImportResult> {
  if (!/\.docx$/i.test(name))
    throw new Error(
      "Choose a modern .docx file. Convert legacy .doc with Microsoft Word or LibreOffice Save As .docx.",
    );
  progress("Checking OOXML package and relationships…");
  const pkg = readOoxmlPackage(bytes),
    main = pkg.xml("word/document.xml").documentElement!;
  if (main.namespaceURI !== W || main.localName !== "document")
    throw new Error("Unsupported WordprocessingML document namespace.");
  const body = child(main, W, "body");
  if (!body) throw new Error("The DOCX has no document body.");
  const original = await documentSource(bytes, name, DOCX_MIME),
    sources: DocumentSources = { [original.id]: original };
  const model = emptyDocument(name.replace(/\.docx$/i, "").slice(0, 120));
  model.id = `document:${original.sha256}`;
  model.sourceId = original.id;
  const diagnostic = (
    code: string,
    message: string,
    recovery: string,
    blockId?: string,
    path?: string,
    severity: "info" | "warning" | "error" = "warning",
  ) => {
    if (model.diagnostics.length >= 10000)
      throw new Error("Document diagnostic limit exceeded.");
    model.diagnostics.push({
      id: `diagnostic:${model.diagnostics.length + 1}`,
      severity,
      code,
      message,
      recovery,
      ...(blockId ? { blockId } : {}),
      ...(path ? { path } : {}),
    });
  };
  const media = new Map<string, string>();
  for (const [part, data] of Object.entries(pkg.files)) {
    if (!/^word\/(?:media|embeddings)\//.test(part)) continue;
    const ext = part.split(".").pop()?.toLowerCase();
    let mime = "application/octet-stream";
    if (ext === "png" || ext === "jpg" || ext === "jpeg")
      mime = readImageHeader(data).mime;
    else if (ext === "emf") mime = "image/x-emf";
    else if (ext === "wmf") mime = "image/x-wmf";
    else if (ext === "bin") mime = "application/x-ole-storage";
    const source = await documentSource(data, part.split("/").at(-1)!, mime);
    sources[source.id] = source;
    media.set(part, source.id);
    if (mime === "image/png" || mime === "image/jpeg") {
      const header = readImageHeader(data),
        assetId = `asset:${source.sha256}`;
      model.assets[assetId] = {
        sourceId: source.id,
        mime,
        width: header.width,
        height: header.height,
        alt: "Embedded document image",
        name: source.name,
      };
    }
  }
  const relCache = new Map<string, ReturnType<OoxmlPackage["relationships"]>>();
  const rels = (part: string) => {
    let result = relCache.get(part);
    if (!result) {
      result = pkg.relationships(part);
      relCache.set(part, result);
      for (const rel of result)
        if (rel.external)
          diagnostic(
            "external-relationship",
            `External ${rel.type.split("/").at(-1)} was not fetched: ${rel.target.slice(0, 200)}`,
            "Embed the asset in the DOCX, or paste the complete local document.",
            undefined,
            part,
          );
    }
    return result;
  };
  rels("word/document.xml");
  const rootRelationships = pkg.relationships("");
  if (
    !rootRelationships.some(
      (r) =>
        !r.external &&
        r.target === "word/document.xml" &&
        r.type.endsWith("/officeDocument"),
    )
  )
    throw new Error(
      "The OOXML officeDocument relationship is missing or unsupported.",
    );
  const rawStyles = new Map<
    string,
    { basedOn: string; format: BlockFormat; heading?: number }
  >();
  let defaultFormat: BlockFormat = {
    fontFamily: "Arial",
    fontSize: 24,
    lineHeight: 1.4,
  };
  if (pkg.files["word/styles.xml"]) {
    const root = pkg.xml("word/styles.xml").documentElement!;
    const defaults = child(root, W, "docDefaults");
    defaultFormat = {
      ...defaultFormat,
      ...textFormat(child(child(defaults, W, "rPrDefault"), W, "rPr")),
      ...blockFormat(child(child(defaults, W, "pPrDefault"), W, "pPr")),
    };
    for (const s of children(root, W, "style")) {
      const id = attribute(s, W, "styleId");
      if (!id || id.length > 120) continue;
      const outline = numeric(
          attribute(child(child(s, W, "pPr"), W, "outlineLvl"), W, "val"),
          1,
          0,
          8,
        ),
        title = attribute(child(s, W, "name"), W, "val"),
        match =
          /heading\s*([1-6])/i.exec(title) || /^Heading([1-6])$/i.exec(id);
      rawStyles.set(id, {
        basedOn: attribute(child(s, W, "basedOn"), W, "val"),
        format: {
          ...textFormat(child(s, W, "rPr")),
          ...blockFormat(child(s, W, "pPr")),
        },
        ...(outline !== undefined && outline < 6
          ? { heading: outline + 1 }
          : match
            ? { heading: Number(match[1]) }
            : {}),
      });
    }
  }
  function style(id: string, visited = new Set<string>()): BlockFormat {
    if (!id) return {};
    if (visited.has(id) || visited.size > 16)
      throw new Error("Cyclic or deeply nested Word styles.");
    visited.add(id);
    const found = rawStyles.get(id);
    if (!found) return {};
    return { ...style(found.basedOn, visited), ...found.format };
  }
  for (const id of rawStyles.keys()) model.styles[id] = style(id);
  type NumberLevel = {
    kind: "number" | "bullet";
    level: number;
    label: string;
    start: number;
    format: string;
    restart: number;
    legal: boolean;
  };
  const nums = new Map<string, NumberLevel[]>(),
    counters = new Map<string, number>();
  if (pkg.files["word/numbering.xml"]) {
    const root = pkg.xml("word/numbering.xml").documentElement!,
      abstracts = new Map<string, NumberLevel[]>();
    const boundedInteger = (
      text: string,
      defaultValue: number,
      min: number,
      max: number,
    ) => {
      const n = Number(text);
      return text !== "" && Number.isInteger(n) && n >= min && n <= max
        ? n
        : defaultValue;
    };
    const readLevel = (lvl: XmlElement): NumberLevel => {
      const level = boundedInteger(attribute(lvl, W, "ilvl"), 0, 0, 8),
        format = attribute(child(lvl, W, "numFmt"), W, "val") || "decimal";
      return {
        kind: format === "bullet" ? "bullet" : "number",
        level,
        format,
        label:
          attribute(child(lvl, W, "lvlText"), W, "val") || `%${level + 1}.`,
        start: boundedInteger(
          attribute(child(lvl, W, "start"), W, "val"),
          1,
          0,
          1000000,
        ),
        restart: boundedInteger(
          attribute(child(lvl, W, "lvlRestart"), W, "val"),
          level,
          0,
          8,
        ),
        legal: on(child(lvl, W, "isLgl")),
      };
    };
    for (const abs of children(root, W, "abstractNum"))
      abstracts.set(
        attribute(abs, W, "abstractNumId"),
        children(abs, W, "lvl").map(readLevel),
      );
    for (const num of children(root, W, "num")) {
      const levels = (
        abstracts.get(attribute(child(num, W, "abstractNumId"), W, "val")) ?? []
      ).map((l) => ({ ...l }));
      for (const override of children(num, W, "lvlOverride")) {
        const level = boundedInteger(attribute(override, W, "ilvl"), -1, 0, 8);
        if (level < 0) continue;
        const replacement = child(override, W, "lvl"),
          index = levels.findIndex((l) => l.level === level);
        const spec = replacement
          ? { ...readLevel(replacement), level }
          : index >= 0
            ? { ...levels[index] }
            : undefined;
        if (!spec) continue;
        const initial = child(override, W, "startOverride");
        if (initial)
          spec.start = boundedInteger(
            attribute(initial, W, "val"),
            spec.start,
            0,
            1000000,
          );
        if (index < 0) levels.push(spec);
        else levels[index] = spec;
      }
      nums.set(attribute(num, W, "numId"), levels);
    }
  }
  let blockSerial = 0,
    inlineSerial = 0,
    sectionSerial = 0,
    sectionId = `section:${sectionSerial}`;
  const blockId = () =>
    `block:${original.sha256.slice(0, 20)}:${++blockSerial}`;
  const inlineId = () =>
    `inline:${original.sha256.slice(0, 20)}:${++inlineSerial}`;
  const provenance = (el: XmlElement, part: string, path: string) => ({
    part,
    path,
    xml: serializeXml(el),
  });
  function image(
    el: XmlElement,
    part: string,
    block: string,
    path: string,
  ): ImageInline | undefined {
    const blip = descendants(el, A, "blip")[0],
      vml = descendants(el, V, "imagedata")[0];
    const relId =
      attribute(blip, R, "embed") ||
      attribute(blip, R, "link") ||
      attribute(vml, R, "id");
    const rel = rels(part).find((r) => r.id === relId),
      sourceId = rel && !rel.external ? media.get(rel.target) : undefined,
      source = sourceId ? sources[sourceId] : undefined;
    if (!source || !["image/png", "image/jpeg"].includes(source.mime)) {
      diagnostic(
        "unsupported-image",
        `An image at ${path} is missing, externally linked or uses unsupported ${source?.mime ?? "content"}.`,
        "Use an embedded PNG/JPEG preview or convert the original picture in Word; full DOCX source is retained.",
        block,
        path,
      );
      return undefined;
    }
    const assetId = `asset:${source.sha256}`,
      asset = model.assets[assetId],
      extent = descendants(el, WP, "extent")[0];
    let width =
        numeric(extent?.getAttribute("cx") ?? "", 9525, 1, 10000) ??
        asset.width,
      height =
        numeric(extent?.getAttribute("cy") ?? "", 9525, 1, 10000) ??
        asset.height;
    const shape = descendants(el, V, "shape")[0],
      css = shape?.getAttribute("style") ?? "";
    const unit = (key: string) => {
      const match = new RegExp(
        `(?:^|;)\\s*${key}:\\s*([0-9.]+)(pt|px)\\b`,
      ).exec(css);
      return match
        ? Number(match[1]) * (match[2] === "pt" ? 4 / 3 : 1)
        : undefined;
    };
    width = unit("width") ?? width;
    height = unit("height") ?? height;
    const docPr = descendants(el, WP, "docPr")[0],
      alt = (
        docPr?.getAttribute("descr") ||
        docPr?.getAttribute("title") ||
        asset.alt
      ).slice(0, 500);
    asset.alt = alt;
    const crops = descendants(el, A, "srcRect"),
      transforms = descendants(el, A, "xfrm");
    if (
      crops.some((c) =>
        ["l", "t", "r", "b"].some((k) => Number(c.getAttribute(k) ?? 0) !== 0),
      ) ||
      transforms.some(
        (t) =>
          Number(t.getAttribute("rot") ?? 0) !== 0 ||
          ["1", "true"].includes(t.getAttribute("flipH") ?? "") ||
          ["1", "true"].includes(t.getAttribute("flipV") ?? ""),
      )
    )
      diagnostic(
        "image-transform",
        "This picture has source cropping, rotation or mirroring that is not reproduced in the editable teaching layout.",
        "Use the source preview for placement, or convert the transformed picture to an embedded PNG/JPEG in Word.",
        block,
        path,
      );
    return {
      id: inlineId(),
      kind: "image",
      assetId,
      width: Math.min(10000, Math.max(1, width)),
      height: Math.min(10000, Math.max(1, height)),
      alt,
      floating: descendants(el, WP, "anchor").length > 0,
    };
  }
  function paragraph(
    el: XmlElement,
    part: string,
    path: string,
  ): ParagraphBlock {
    const id = blockId(),
      pr = child(el, W, "pPr"),
      styleId = attribute(child(pr, W, "pStyle"), W, "val"),
      s = rawStyles.get(styleId);
    const result: ParagraphBlock = {
      id,
      kind: "paragraph",
      provenance: provenance(el, part, path),
      format: { ...defaultFormat, ...style(styleId), ...blockFormat(pr) },
      inlines: [],
      sectionId,
    };
    if (s?.heading) result.heading = s.heading;
    if (on(child(pr, W, "pageBreakBefore"))) result.breakBefore = true;
    const numPr = child(pr, W, "numPr"),
      numId = attribute(child(numPr, W, "numId"), W, "val"),
      level = Number(attribute(child(numPr, W, "ilvl"), W, "val")) || 0;
    if (numId && numId !== "0") {
      const levels = nums.get(numId) ?? [],
        spec = levels.find((n) => n.level === level);
      const renderNumber = (value: number, format: string) => {
        if (!Number.isSafeInteger(value) || value < 0 || value > 1000000)
          throw new Error("number exceeds the supported numbering range");
        if (format === "decimal") return String(value);
        if (format === "upperLetter" || format === "lowerLetter") {
          if (value < 1 || value > 18278)
            throw new Error("letter numbering exceeds 1–18278");
          let text = "",
            n = value;
          while (n > 0) {
            n--;
            text = String.fromCharCode(65 + (n % 26)) + text;
            n = Math.floor(n / 26);
          }
          return format === "lowerLetter" ? text.toLowerCase() : text;
        }
        if (format === "upperRoman" || format === "lowerRoman") {
          if (value < 1 || value > 3999)
            throw new Error("Roman numbering exceeds 1–3999");
          let n = value,
            text = "";
          for (const [arabic, roman] of [
            [1000, "M"],
            [900, "CM"],
            [500, "D"],
            [400, "CD"],
            [100, "C"],
            [90, "XC"],
            [50, "L"],
            [40, "XL"],
            [10, "X"],
            [9, "IX"],
            [5, "V"],
            [4, "IV"],
            [1, "I"],
          ] as const)
            while (n >= arabic) {
              text += roman;
              n -= arabic;
            }
          return format === "lowerRoman" ? text.toLowerCase() : text;
        }
        throw new Error(`unsupported numbering format ${format}`);
      };
      try {
        if (!spec || level < 0 || level > 8)
          throw new Error("missing or invalid numbering definition");
        for (const lower of levels)
          if (
            lower.level > level &&
            lower.restart !== 0 &&
            level <= lower.restart - 1
          )
            counters.delete(`${numId}:${lower.level}`);
        const key = `${numId}:${level}`,
          count = (counters.get(key) ?? spec.start - 1) + 1;
        counters.set(key, count);
        // Validate current format even when a malformed label omits its placeholder.
        if (spec.kind !== "bullet") renderNumber(count, spec.format);
        const label = spec.label.replace(/%([1-9])/g, (_, n) => {
          const referenced = levels.find((l) => l.level === Number(n) - 1);
          if (!referenced)
            throw new Error("missing referenced numbering level");
          const value =
            counters.get(`${numId}:${referenced.level}`) ?? referenced.start;
          return renderNumber(
            value,
            spec.legal ? "decimal" : referenced.format,
          );
        });
        if (label.length > 80)
          throw new Error("numbering label exceeds 80 characters");
        result.list = { kind: spec.kind, level, label };
      } catch (error) {
        result.list = {
          kind: spec?.kind ?? "number",
          level: Math.max(0, Math.min(8, level)),
          label: "[numbering needs review]",
        };
        diagnostic(
          "unsupported-numbering",
          `Word numbering requires review: ${error instanceof Error ? error.message : "unsupported definition"}.`,
          "Review the retained word/numbering.xml in the original DOCX, or replace this label with verified plain text in Word.",
          id,
          path,
        );
      }
    }
    const addText = (text: string, format: TextFormat = {}) => {
      if (text)
        result.inlines.push({ id: inlineId(), kind: "text", text, format });
    };
    const visit = (node: XmlElement, format: TextFormat = {}) => {
      const ns = node.namespaceURI,
        n = node.localName;
      if (ns === M && (n === "oMath" || n === "oMathPara")) {
        const conversion = convertOmml(node);
        result.inlines.push({
          id: inlineId(),
          kind: "equation",
          source: conversion.source,
          original: conversion.original,
          encoding: "omml",
          status: conversion.status,
        });
        if (conversion.status === "unsupported")
          diagnostic(
            "unsupported-equation",
            conversion.reason ?? "This OMML equation needs review.",
            "Inspect the retained source and enter a verified LaTeX equivalent, or convert it in Word.",
            id,
            path,
          );
        return;
      }
      if (ns !== W) {
        diagnostic(
          "unsupported-inline",
          `Unsupported inline namespace/element ${node.nodeName}.`,
          "Review the original DOCX; unsupported content is identified in the semantic layout.",
          id,
          path,
        );
        addText(`[Unsupported ${node.localName}]`);
        return;
      }
      if (
        n === "pPr" ||
        n === "rPr" ||
        [
          "bookmarkStart",
          "bookmarkEnd",
          "proofErr",
          "lastRenderedPageBreak",
          "commentRangeStart",
          "commentRangeEnd",
        ].includes(n!)
      )
        return;
      if (n === "r") {
        const runStyle = attribute(
            child(child(node, W, "rPr"), W, "rStyle"),
            W,
            "val",
          ),
          f = {
            ...format,
            ...style(runStyle),
            ...textFormat(child(node, W, "rPr")),
          };
        for (const c of elements(node)) visit(c, f);
        return;
      }
      if (n === "t" || n === "delText") {
        addText(node.textContent ?? "", format);
        return;
      }
      if (n === "tab") {
        addText("\t", format);
        return;
      }
      if (n === "br" || n === "cr") {
        addText("\n", format);
        if (attribute(node, W, "type") === "page")
          diagnostic(
            "manual-page-break",
            "Manual page break is retained; semantic teaching layout reflows independently.",
            "Use source preview for fixed pagination.",
            id,
            path,
            "info",
          );
        return;
      }
      if (n === "drawing" || n === "pict") {
        const img = image(node, part, id, path);
        if (img) {
          result.inlines.push(img);
          if (img.floating)
            diagnostic(
              "floating-image",
              "Floating image retained in source; teaching layout places it in source order inline.",
              "Use source preview for original anchoring.",
              id,
              path,
              "info",
            );
        } else addText("[Unsupported image — see diagnostics]", format);
        return;
      }
      if (n === "object") {
        const ole = descendants(node, O, "OLEObject")[0],
          preview = image(node, part, id, path),
          relId = attribute(ole, R, "id"),
          target = rels(part).find((r) => r.id === relId);
        const progId = ole?.getAttribute("ProgID") ?? "unknown OLE object";
        if (!/^(?:Equation\.|MathType(?:\.|$))/i.test(progId)) {
          addText(`[Unsupported OLE: ${progId}]`, format);
          if (preview) result.inlines.push(preview);
          diagnostic(
            "unsupported-ole",
            `Embedded ${progId} is retained as unsupported OLE; it is not classified as an editable equation.`,
            "Open the original document in its authoring application and convert this object to supported text or an embedded PNG/JPEG.",
            id,
            path,
          );
          return;
        }
        result.inlines.push({
          id: inlineId(),
          kind: "equation",
          source: "",
          original: serializeXml(node),
          encoding: "mtef",
          status: "unsupported",
          ...(preview ? { fallbackAssetId: preview.assetId } : {}),
        });
        diagnostic(
          "legacy-equation",
          `Legacy OLE/equation ${ole?.getAttribute("ProgID") ?? "object"} is retained${target ? ` (${target.target})` : ""}; editable MTEF conversion is unavailable.`,
          "Convert the equation to modern Word OMML, or enter and verify LaTeX. A preview is visual-only.",
          id,
          path,
        );
        return;
      }
      if (
        [
          "hyperlink",
          "smartTag",
          "ins",
          "sdtContent",
          "sdt",
          "fldSimple",
        ].includes(n!)
      ) {
        if (n === "hyperlink" || n === "fldSimple" || n === "ins")
          diagnostic(
            n === "ins" ? "tracked-changes" : "static-field",
            `${n} is imported as static visible content, without active behavior.`,
            "Review the source and accept changes/resolve fields in Word when needed.",
            id,
            path,
            "info",
          );
        for (const c of elements(node)) visit(c, format);
        return;
      }
      if (n === "instrText") {
        diagnostic(
          "field-code",
          "Word field code is retained but not evaluated.",
          "Update fields in Word before importing or replace with verified text.",
          id,
          path,
        );
        return;
      }
      diagnostic(
        "unsupported-inline",
        `Unsupported Word inline ${n} was retained in source and marked here.`,
        "Review the original content or convert to supported text/image/equation.",
        id,
        path,
      );
      addText(`[Unsupported ${n}]`, format);
    };
    for (const node of elements(el)) visit(node);
    return result;
  }
  function parseBlocks(
    container: XmlElement,
    part: string,
    path: string,
  ): DocumentBlock[] {
    const out: DocumentBlock[] = [];
    let at = 0;
    for (const el of elements(container)) {
      const loc = `${path}/${el.localName}[${++at}]`;
      if (el.namespaceURI === W && el.localName === "sectPr") continue;
      if (el.namespaceURI === W && el.localName === "p")
        out.push(paragraph(el, part, loc));
      else if (el.namespaceURI === W && el.localName === "tbl") {
        const id = blockId(),
          rows: {
            cells: {
              blocks: DocumentBlock[];
              colSpan: number;
              rowSpan: number;
            }[];
          }[] = [],
          merges = new Map<
            number,
            { blocks: DocumentBlock[]; colSpan: number; rowSpan: number }
          >();
        let ri = 0;
        for (const tr of children(el, W, "tr")) {
          const cells: {
              blocks: DocumentBlock[];
              colSpan: number;
              rowSpan: number;
            }[] = [],
            continuing = new Set<number>();
          let column = 0,
            ci = 0;
          for (const tc of children(tr, W, "tc")) {
            const pr = child(tc, W, "tcPr"),
              colSpan = Math.max(
                1,
                Math.min(
                  1000,
                  Number(attribute(child(pr, W, "gridSpan"), W, "val")) || 1,
                ),
              ),
              vm = child(pr, W, "vMerge"),
              restart = attribute(vm, W, "val") === "restart";
            const content = parseBlocks(
              tc,
              part,
              `${loc}/tr[${ri}]/tc[${ci++}]`,
            );
            if (vm && !restart && merges.has(column)) {
              const above = merges.get(column)!;
              above.rowSpan++;
              if (
                content.some(
                  (b) =>
                    b.kind !== "paragraph" ||
                    b.inlines.some((i) => i.kind !== "text" || i.text.trim()),
                )
              ) {
                above.blocks.push(...content);
                diagnostic(
                  "merged-cell-content",
                  "Content in a vertical merge continuation is preserved in the spanning cell.",
                  "Review table layout against Word.",
                  id,
                  loc,
                );
              }
              continuing.add(column);
            } else {
              const cell = { blocks: content, colSpan, rowSpan: 1 };
              cells.push(cell);
              if (vm) {
                merges.set(column, cell);
                continuing.add(column);
              }
            }
            column += colSpan;
          }
          for (const key of merges.keys())
            if (!continuing.has(key)) merges.delete(key);
          rows.push({ cells });
          ri++;
        }
        out.push({
          id,
          kind: "table",
          provenance: provenance(el, part, loc),
          format: { ...defaultFormat },
          rows,
          sectionId,
        });
      } else if (
        el.namespaceURI === W &&
        ["sdt", "sdtContent", "customXml"].includes(el.localName!)
      )
        out.push(...parseBlocks(el, part, loc));
      else if (
        el.namespaceURI === W &&
        ["tcPr", "tblPr", "tblGrid"].includes(el.localName!)
      )
        continue;
      else {
        const id = blockId();
        out.push({
          id,
          kind: "unsupported",
          provenance: provenance(el, part, loc),
          format: {},
          label: `Unsupported ${el.localName}`,
          reason:
            "This content is retained in the original DOCX but cannot be represented safely in the supported semantic layout.",
          sectionId,
        });
        diagnostic(
          "unsupported-block",
          `Unsupported document block ${el.nodeName} requires review.`,
          "Convert it to supported text, OMML, table or embedded PNG/JPEG in Word.",
          id,
          loc,
        );
      }
    }
    return out;
  }
  progress("Normalizing paragraphs, tables, images and equations…");
  // Parse body one element at a time so section membership is explicit.
  let bodyIndex = 0;
  const section = (pr: XmlElement, afterBlockId?: string) => {
    const size = child(pr, W, "pgSz"),
      mar = child(pr, W, "pgMar"),
      section: DocumentSection = {
        id: sectionId,
        width: numeric(attribute(size, W, "w"), 15, 64, 10000) ?? 794,
        height: numeric(attribute(size, W, "h"), 15, 64, 10000) ?? 1123,
        orientation:
          attribute(size, W, "orient") === "landscape"
            ? "landscape"
            : "portrait",
        margin: {
          top: numeric(attribute(mar, W, "top"), 15, 0, 1000) ?? 72,
          right: numeric(attribute(mar, W, "right"), 15, 0, 1000) ?? 72,
          bottom: numeric(attribute(mar, W, "bottom"), 15, 0, 1000) ?? 72,
          left: numeric(attribute(mar, W, "left"), 15, 0, 1000) ?? 72,
        },
        header: [],
        footer: [],
        ...(afterBlockId ? { afterBlockId } : {}),
      };
    for (const kind of ["header", "footer"] as const)
      for (const ref of children(pr, W, `${kind}Reference`)) {
        const relId = attribute(ref, R, "id"),
          rel = rels("word/document.xml").find((r) => r.id === relId);
        if (rel && !rel.external && pkg.files[rel.target])
          section[kind].push(
            ...parseBlocks(
              pkg.xml(rel.target).documentElement!,
              rel.target,
              `/${kind}`,
            ),
          );
        else
          diagnostic(
            "missing-header-footer",
            `Missing ${kind} source.`,
            "Review the original DOCX header/footer.",
            undefined,
            "word/document.xml",
          );
      }
    model.sections.push(section);
    sectionId = `section:${++sectionSerial}`;
  };
  for (const el of elements(body)) {
    if (el.namespaceURI === W && el.localName === "sectPr") {
      section(el, model.blocks.at(-1)?.id);
      continue;
    }
    const holder = pkg.xml("word/document.xml").createElementNS(W, "w:body");
    holder.appendChild(el.cloneNode(true));
    model.blocks.push(
      ...parseBlocks(holder, "word/document.xml", `/body[${bodyIndex++}]`),
    );
    const pr =
      el.namespaceURI === W && el.localName === "p"
        ? child(child(el, W, "pPr"), W, "sectPr")
        : undefined;
    if (pr) section(pr, model.blocks.at(-1)?.id);
  }
  if (
    !model.sections.length ||
    model.blocks.some((b) => b.sectionId === sectionId)
  )
    model.sections.push({
      id: sectionId,
      width: 794,
      height: 1123,
      orientation: "portrait",
      margin: { top: 72, right: 72, bottom: 72, left: 72 },
      header: [],
      footer: [],
    });
  const fonts = new Set<string>();
  for (const b of model.blocks)
    if (b.format.fontFamily) fonts.add(b.format.fontFamily);
  if (fonts.size)
    diagnostic(
      "font-fidelity",
      `Font family metadata is preserved (${[...fonts].join(", ").slice(0, 300)}); installed browser fonts may differ from Word.`,
      "Inspect the preview; use an available font or install the source font lawfully. Word pagination is not certified.",
      undefined,
      undefined,
      "info",
    );
  progress("Validating structured document and immutable source references…");
  return { document: validateDocument(model, sources), sources };
}
