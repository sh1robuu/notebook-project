import type { DocumentSources } from "./sources.ts";
import { readImageHeader } from "../media/image-format.ts";
export type TextFormat = {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  highlight?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};
export type BlockFormat = TextFormat & {
  align?: "left" | "center" | "right" | "justify";
  indent?: number;
  before?: number;
  after?: number;
  lineHeight?: number;
};
export type DocumentProvenance = { part: string; path: string; xml?: string };
export type EquationInline = {
  id: string;
  kind: "equation";
  source: string;
  original: string;
  encoding: "omml" | "latex" | "mtef";
  status: "editable" | "unsupported";
  fallbackAssetId?: string;
};
export type ImageInline = {
  id: string;
  kind: "image";
  assetId: string;
  width: number;
  height: number;
  alt: string;
  floating: boolean;
};
export type DocumentInline =
  | { id: string; kind: "text"; text: string; format: TextFormat }
  | EquationInline
  | ImageInline;
type BlockBase = {
  id: string;
  provenance: DocumentProvenance;
  format: BlockFormat;
  sectionId?: string;
};
export type ParagraphBlock = BlockBase & {
  kind: "paragraph";
  inlines: DocumentInline[];
  heading?: number;
  list?: { kind: "bullet" | "number"; level: number; label: string };
  breakBefore?: boolean;
};
export type TableBlock = BlockBase & {
  kind: "table";
  rows: {
    cells: { blocks: DocumentBlock[]; colSpan: number; rowSpan: number }[];
  }[];
};
export type ImageBlock = BlockBase & Omit<ImageInline, "id">;
export type UnsupportedBlock = BlockBase & {
  kind: "unsupported";
  label: string;
  reason: string;
  fallbackAssetId?: string;
};
export type DocumentBlock =
  ParagraphBlock | TableBlock | ImageBlock | UnsupportedBlock;
export type DocumentSection = {
  id: string;
  afterBlockId?: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  margin: { top: number; right: number; bottom: number; left: number };
  header: DocumentBlock[];
  footer: DocumentBlock[];
};
export type DocumentDiagnostic = {
  id: string;
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  recovery: string;
  blockId?: string;
  path?: string;
};
export type DocumentAsset = {
  sourceId: string;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  alt: string;
  name: string;
};
export type DocumentModel = {
  schemaVersion: 1;
  id: string;
  sourceId: string | null;
  title: string;
  revision: number;
  blocks: DocumentBlock[];
  sections: DocumentSection[];
  styles: Record<string, BlockFormat>;
  assets: Record<string, DocumentAsset>;
  diagnostics: DocumentDiagnostic[];
};
export type DocumentImportResult = {
  document: DocumentModel;
  sources: DocumentSources;
};
export function emptyDocument(title = "Word draft"): DocumentModel {
  return {
    schemaVersion: 1,
    id: `document:${crypto.randomUUID()}`,
    sourceId: null,
    title: title.slice(0, 120),
    revision: 0,
    blocks: [],
    sections: [],
    styles: {},
    assets: {},
    diagnostics: [],
  };
}
export function walkBlocks(document: DocumentModel): DocumentBlock[] {
  const out: DocumentBlock[] = [];
  const visit = (blocks: DocumentBlock[]) => {
    for (const b of blocks) {
      out.push(b);
      if (b.kind === "table")
        for (const row of b.rows)
          for (const cell of row.cells) visit(cell.blocks);
    }
  };
  visit(document.blocks);
  for (const section of document.sections) {
    visit(section.header);
    visit(section.footer);
  }
  return out;
}
export function documentText(document: DocumentModel): string {
  return walkBlocks(document)
    .map((b) =>
      b.kind === "paragraph"
        ? b.inlines
            .map((i) =>
              i.kind === "text"
                ? i.text
                : i.kind === "equation"
                  ? i.source || "[Unsupported equation]"
                  : i.alt,
            )
            .join("")
        : b.kind === "unsupported"
          ? `[${b.label}]`
          : b.kind === "image"
            ? b.alt
            : "",
    )
    .filter(Boolean)
    .join("\n");
}
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function keys(v: Record<string, unknown>, allowed: string[], name: string) {
  if (Object.keys(v).some((k) => !allowed.includes(k)))
    throw new Error(`Unsupported ${name} property.`);
}
function string(
  v: unknown,
  max: number,
  name: string,
  required = false,
): asserts v is string {
  if (
    typeof v !== "string" ||
    v.length > max ||
    (required && !v) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    throw new Error(`Invalid ${name}.`);
}
function number(v: unknown, min: number, max: number, name: string) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new Error(`Invalid ${name}.`);
}
export function validateFormat(value: unknown): asserts value is BlockFormat {
  if (!obj(value)) throw new Error("Invalid document formatting.");
  keys(
    value,
    [
      "fontFamily",
      "fontSize",
      "color",
      "highlight",
      "bold",
      "italic",
      "underline",
      "align",
      "indent",
      "before",
      "after",
      "lineHeight",
    ],
    "format",
  );
  if (
    value.fontFamily !== undefined &&
    (typeof value.fontFamily !== "string" ||
      !/^[\p{L}\p{N} .,_-]{1,100}$/u.test(value.fontFamily))
  )
    throw new Error("Unsupported font family format.");
  for (const k of ["color", "highlight"])
    if (
      value[k] !== undefined &&
      (typeof value[k] !== "string" ||
        !/^#[a-f0-9]{6}$/i.test(value[k] as string))
    )
      throw new Error("Invalid document color format.");
  for (const k of ["bold", "italic", "underline"])
    if (value[k] !== undefined && typeof value[k] !== "boolean")
      throw new Error("Invalid document text format.");
  if (value.fontSize !== undefined) number(value.fontSize, 6, 144, "font size");
  if (
    value.align !== undefined &&
    !["left", "center", "right", "justify"].includes(String(value.align))
  )
    throw new Error("Invalid paragraph alignment.");
  if (value.indent !== undefined)
    number(value.indent, -400, 1200, "indentation");
  for (const k of ["before", "after"])
    if (value[k] !== undefined) number(value[k], 0, 1200, "paragraph spacing");
  if (value.lineHeight !== undefined)
    number(value.lineHeight, 0.8, 4, "line height");
}
/** Strict JSON semantic contract shared by import, draft, compiled page and archive. */
export function validateDocument(
  value: unknown,
  sources?: DocumentSources,
): DocumentModel {
  if (!obj(value) || value.schemaVersion !== 1)
    throw new Error("Unsupported semantic document version.");
  keys(
    value,
    [
      "schemaVersion",
      "id",
      "sourceId",
      "title",
      "revision",
      "blocks",
      "sections",
      "styles",
      "assets",
      "diagnostics",
    ],
    "document",
  );
  string(value.id, 160, "document identity", true);
  string(value.title, 120, "document title");
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0)
    throw new Error("Invalid document revision.");
  if (value.sourceId !== null) {
    string(value.sourceId, 69, "document source identity", true);
    if (!/^word:[a-f0-9]{64}$/.test(value.sourceId))
      throw new Error("Invalid document source identity.");
    if (sources && !sources[value.sourceId])
      throw new Error("Missing original document source.");
  }
  if (!obj(value.styles) || Object.keys(value.styles).length > 1000)
    throw new Error("Invalid document styles.");
  for (const [id, style] of Object.entries(value.styles)) {
    string(id, 120, "style identity", true);
    validateFormat(style);
  }
  if (!obj(value.assets) || Object.keys(value.assets).length > 512)
    throw new Error("Invalid document assets.");
  for (const [id, a] of Object.entries(value.assets)) {
    string(id, 160, "asset identity", true);
    if (!obj(a)) throw new Error("Invalid document asset.");
    keys(a, ["sourceId", "mime", "width", "height", "alt", "name"], "asset");
    string(a.sourceId, 69, "asset source identity", true);
    if (
      !/^word:[a-f0-9]{64}$/.test(a.sourceId) ||
      !["image/png", "image/jpeg"].includes(String(a.mime))
    )
      throw new Error("Unsupported document asset source.");
    number(a.width, 1, 8192, "image width");
    number(a.height, 1, 8192, "image height");
    if (Number(a.width) * Number(a.height) > 16_000_000)
      throw new Error("Document image exceeds 16 megapixels.");
    string(a.alt, 500, "image description");
    string(a.name, 180, "image name");
    if (sources) {
      const source = sources[a.sourceId];
      if (!source || source.mime !== a.mime)
        throw new Error("Missing or mismatched document image source.");
      const header = readImageHeader(source.bytes);
      if (
        header.width !== a.width ||
        header.height !== a.height ||
        header.mime !== a.mime
      )
        throw new Error(
          "Document image dimensions differ from original source bytes.",
        );
    }
  }
  const ids = new Set<string>();
  let blockCount = 0,
    inlineCount = 0,
    chars = 0,
    xmlChars = 0;
  const identity = (v: unknown) => {
    string(v, 160, "semantic identity", true);
    if (ids.has(v))
      throw new Error("Duplicate semantic block/equation identity.");
    ids.add(v);
  };
  const assetMap = value.assets;
  const asset = (id: unknown) => {
    string(id, 160, "asset reference", true);
    if (!Object.hasOwn(assetMap, id))
      throw new Error("Missing semantic image asset.");
  };
  function image(v: Record<string, unknown>) {
    asset(v.assetId);
    number(v.width, 1, 10000, "image layout width");
    number(v.height, 1, 10000, "image layout height");
    string(v.alt, 500, "image description");
    if (typeof v.floating !== "boolean")
      throw new Error("Invalid image placement.");
  }
  function blocks(items: unknown, depth = 0) {
    if (!Array.isArray(items) || depth > 8)
      throw new Error("Invalid or deeply nested document blocks.");
    for (const b of items) {
      if (!obj(b) || ++blockCount > 5000)
        throw new Error("Document exceeds 5,000 semantic blocks.");
      identity(b.id);
      validateFormat(b.format);
      if (!obj(b.provenance))
        throw new Error("Missing semantic source provenance.");
      keys(b.provenance, ["part", "path", "xml"], "provenance");
      string(b.provenance.part, 240, "source part");
      string(b.provenance.path, 500, "source location");
      if (b.provenance.xml !== undefined) {
        string(b.provenance.xml, 1_000_000, "original source XML");
        xmlChars += b.provenance.xml.length;
        if (xmlChars > 20_000_000)
          throw new Error("Semantic original XML exceeds 20 MB.");
      }
      if (b.sectionId !== undefined)
        string(b.sectionId, 160, "section reference", true);
      const base = ["id", "kind", "provenance", "format", "sectionId"];
      if (b.kind === "paragraph") {
        keys(
          b,
          [...base, "inlines", "heading", "list", "breakBefore"],
          "paragraph",
        );
        if (
          b.heading !== undefined &&
          (!Number.isInteger(b.heading) ||
            Number(b.heading) < 1 ||
            Number(b.heading) > 6)
        )
          throw new Error("Invalid heading level.");
        if (b.breakBefore !== undefined && typeof b.breakBefore !== "boolean")
          throw new Error("Invalid page break.");
        if (b.list !== undefined) {
          if (!obj(b.list)) throw new Error("Invalid list.");
          keys(b.list, ["kind", "level", "label"], "list");
          if (!["bullet", "number"].includes(String(b.list.kind)))
            throw new Error("Invalid list kind.");
          number(b.list.level, 0, 8, "list depth");
          string(b.list.label, 80, "list label");
        }
        if (!Array.isArray(b.inlines))
          throw new Error("Invalid paragraph inlines.");
        for (const i of b.inlines) {
          if (!obj(i) || ++inlineCount > 50000)
            throw new Error("Document inline limit exceeded.");
          identity(i.id);
          if (i.kind === "text") {
            keys(i, ["id", "kind", "text", "format"], "text inline");
            string(i.text, 100000, "document text");
            chars += i.text.length;
            validateFormat(i.format);
          } else if (i.kind === "equation") {
            keys(
              i,
              [
                "id",
                "kind",
                "source",
                "original",
                "encoding",
                "status",
                "fallbackAssetId",
              ],
              "equation",
            );
            string(i.source, 4000, "equation source");
            string(i.original, 100000, "original equation");
            if (
              !["omml", "latex", "mtef"].includes(String(i.encoding)) ||
              !["editable", "unsupported"].includes(String(i.status)) ||
              (i.status === "editable" && !i.source)
            )
              throw new Error("Invalid equation conversion status.");
            if (i.fallbackAssetId !== undefined) asset(i.fallbackAssetId);
          } else if (i.kind === "image") {
            keys(
              i,
              ["id", "kind", "assetId", "width", "height", "alt", "floating"],
              "image inline",
            );
            image(i);
          } else throw new Error("Unsupported semantic inline kind.");
        }
      } else if (b.kind === "table") {
        keys(b, [...base, "rows"], "table");
        if (!Array.isArray(b.rows) || b.rows.length > 1000)
          throw new Error("Invalid table rows.");
        for (const row of b.rows) {
          if (!obj(row) || !Array.isArray(row.cells) || row.cells.length > 100)
            throw new Error("Invalid table cells.");
          keys(row, ["cells"], "table row");
          for (const c of row.cells) {
            if (!obj(c)) throw new Error("Invalid table cell.");
            keys(c, ["blocks", "colSpan", "rowSpan"], "table cell");
            for (const k of ["colSpan", "rowSpan"])
              if (
                !Number.isInteger(c[k]) ||
                Number(c[k]) < 1 ||
                Number(c[k]) > 1000
              )
                throw new Error("Invalid merged cell span.");
            blocks(c.blocks, depth + 1);
          }
        }
      } else if (b.kind === "image") {
        keys(
          b,
          [...base, "assetId", "width", "height", "alt", "floating"],
          "image block",
        );
        image(b);
      } else if (b.kind === "unsupported") {
        keys(
          b,
          [...base, "label", "reason", "fallbackAssetId"],
          "unsupported block",
        );
        string(b.label, 200, "unsupported content label");
        string(b.reason, 1000, "unsupported reason");
        if (b.fallbackAssetId !== undefined) asset(b.fallbackAssetId);
      } else throw new Error("Unsupported semantic block kind.");
    }
  }
  blocks(value.blocks);
  if (chars > 1_000_000)
    throw new Error("Document exceeds one million text characters.");
  if (!Array.isArray(value.sections) || value.sections.length > 200)
    throw new Error("Invalid document sections.");
  const sectionIds = new Set<string>();
  for (const s of value.sections) {
    if (!obj(s)) throw new Error("Invalid section.");
    keys(
      s,
      [
        "id",
        "afterBlockId",
        "width",
        "height",
        "orientation",
        "margin",
        "header",
        "footer",
      ],
      "section",
    );
    string(s.id, 160, "section identity", true);
    if (sectionIds.has(s.id)) throw new Error("Duplicate section identity.");
    sectionIds.add(s.id);
    number(s.width, 64, 10000, "section width");
    number(s.height, 64, 10000, "section height");
    if (!["portrait", "landscape"].includes(String(s.orientation)))
      throw new Error("Invalid section orientation.");
    if (s.afterBlockId !== undefined) {
      string(s.afterBlockId, 160, "section block reference");
      if (!ids.has(s.afterBlockId))
        throw new Error("Missing section block reference.");
    }
    if (!obj(s.margin)) throw new Error("Invalid section margins.");
    keys(s.margin, ["top", "right", "bottom", "left"], "margins");
    for (const k of ["top", "right", "bottom", "left"])
      number(s.margin[k], 0, 1000, "section margin");
    blocks(s.header);
    blocks(s.footer);
  }
  if (chars > 1_000_000)
    throw new Error(
      "Document exceeds one million text characters including headers and footers.",
    );
  for (const block of walkBlocks(value as unknown as DocumentModel))
    if (block.sectionId !== undefined && !sectionIds.has(block.sectionId))
      throw new Error(
        "A semantic block references a missing document section.",
      );
  if (!Array.isArray(value.diagnostics) || value.diagnostics.length > 10000)
    throw new Error("Invalid diagnostics.");
  for (const d of value.diagnostics) {
    if (!obj(d)) throw new Error("Invalid document diagnostic.");
    keys(
      d,
      ["id", "severity", "code", "message", "recovery", "blockId", "path"],
      "diagnostic",
    );
    string(d.id, 160, "diagnostic identity", true);
    string(d.code, 100, "diagnostic code", true);
    string(d.message, 1000, "diagnostic message");
    string(d.recovery, 1000, "diagnostic recovery");
    if (!["info", "warning", "error"].includes(String(d.severity)))
      throw new Error("Invalid diagnostic severity.");
    if (d.blockId !== undefined) {
      string(d.blockId, 160, "diagnostic block reference");
      if (!ids.has(d.blockId)) throw new Error("Missing diagnostic block.");
    }
    if (d.path !== undefined) string(d.path, 500, "diagnostic source location");
  }
  return value as unknown as DocumentModel;
}
