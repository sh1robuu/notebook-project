import DOMPurify from "dompurify";
import { dataImage, readImageHeader } from "../media/image-format.ts";
import { documentSource } from "./sources.ts";
import { emptyDocument, validateDocument } from "./model.ts";
import type {
  BlockFormat,
  DocumentBlock,
  DocumentImportResult,
  DocumentInline,
  ParagraphBlock,
  TextFormat,
} from "./model.ts";
import { convertOmml } from "./omml.ts";
import type { OmmlConversion } from "./omml.ts";
import { M } from "./package.ts";
import { validateDocumentImages } from "./import.ts";
export type ClipboardDocumentInput = {
  html?: string;
  text?: string;
  rtf?: string;
  images?: Blob[];
};
function abort(signal: AbortSignal) {
  if (signal.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Word paste cancelled.", "AbortError");
}
function cssColor(value: string) {
  if (/^#[a-f0-9]{6}$/i.test(value)) return value;
  const m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(
    value,
  );
  if (m && m.slice(1).every((n) => Number(n) <= 255))
    return (
      "#" +
      m
        .slice(1)
        .map((n) => Number(n).toString(16).padStart(2, "0"))
        .join("")
    );
  return undefined;
}
function format(el: HTMLElement): BlockFormat {
  const out: BlockFormat = {},
    style = el.style,
    tag = el.tagName.toLowerCase();
  if (
    ["b", "strong", "th"].includes(tag) ||
    style.fontWeight === "bold" ||
    Number(style.fontWeight) >= 600
  )
    out.bold = true;
  if (["i", "em"].includes(tag) || style.fontStyle === "italic")
    out.italic = true;
  if (tag === "u" || style.textDecoration.includes("underline"))
    out.underline = true;
  const family = style.fontFamily.replace(/["']/g, "");
  if (/^[\p{L}\p{N} .,_-]{1,100}$/u.test(family)) out.fontFamily = family;
  const size = /^([0-9.]+)(pt|px)$/.exec(style.fontSize);
  if (size)
    out.fontSize = Math.max(
      6,
      Math.min(144, Number(size[1]) * (size[2] === "px" ? 0.75 : 1)),
    );
  const color = cssColor(style.color),
    highlight = cssColor(style.backgroundColor);
  if (color) out.color = color;
  if (highlight) out.highlight = highlight;
  if (["left", "center", "right", "justify"].includes(style.textAlign))
    out.align = style.textAlign as BlockFormat["align"];
  const unit = (s: string) => {
    const m = /^([0-9.]+)(pt|px)$/.exec(s);
    return m
      ? Math.min(1200, Number(m[1]) * (m[2] === "pt" ? 4 / 3 : 1))
      : undefined;
  };
  const indent = unit(style.marginLeft),
    before = unit(style.marginTop),
    after = unit(style.marginBottom);
  if (indent !== undefined) out.indent = indent;
  if (before !== undefined) out.before = before;
  if (after !== undefined) out.after = after;
  return out;
}
/** Browser-only paste normalization. Sanitized markup is parsed inertly, then
 * projected to the same strict semantic model used by the file importer. */
export async function normalizeClipboard(
  input: ClipboardDocumentInput,
  signal: AbortSignal,
): Promise<DocumentImportResult> {
  abort(signal);
  for (const text of [input.html, input.text, input.rtf])
    if (text && text.length > 20_000_000)
      throw new Error("Word clipboard text exceeds the 20 MB limit.");
  if ((input.images?.length ?? 0) > 12)
    throw new Error("Paste at most 12 images at once.");
  if (
    input.html &&
    /<\s*(?:script|iframe|object|embed|svg)\b/i.test(input.html)
  )
    throw new Error(
      "Executable or unsupported active clipboard markup was rejected. Existing work is unchanged.",
    );
  const model = emptyDocument("Pasted Word material"),
    sources: DocumentImportResult["sources"] = {},
    math = new Map<string, OmmlConversion>(),
    usedMath = new Set<string>();
  let serial = 0;
  const id = (kind: string) => `${kind}:${model.id.slice(9)}:${++serial}`;
  const diagnostic = (
    code: string,
    message: string,
    recovery: string,
    blockId?: string,
  ) =>
    model.diagnostics.push({
      id: id("diagnostic"),
      severity: "warning",
      code,
      message,
      recovery,
      ...(blockId ? { blockId } : {}),
    });
  const original = input.html || input.text || input.rtf || "";
  if (!original && !input.images?.length)
    throw new Error(
      "Clipboard has no available text/HTML/images. Paste here or import the full DOCX.",
    );
  if (original) {
    const source = await documentSource(
      new TextEncoder().encode(original),
      input.html
        ? "word-clipboard.html"
        : input.text
          ? "word-clipboard.txt"
          : "word-clipboard.rtf",
      input.html ? "text/html" : input.text ? "text/plain" : "text/rtf",
    );
    sources[source.id] = source;
    model.sourceId = source.id;
    model.id = `document:${source.sha256}`;
  }
  // Retain every exposed source flavor for diagnostics/recovery, not only the
  // chosen presentation flavor. RTF is not claimed to be an editable parser.
  for (const [value, mime, name] of [
    [input.text, "text/plain", "word-clipboard.txt"],
    [input.rtf, "text/rtf", "word-clipboard.rtf"],
  ] as const)
    if (value) {
      const source = await documentSource(
        new TextEncoder().encode(value),
        name,
        mime,
      );
      sources[source.id] = source;
    }
  if (input.rtf)
    diagnostic(
      "rtf-retained",
      input.html || input.text
        ? "Available RTF was retained; supported HTML/plain text supplies this draft."
        : "RTF-only content has no validated semantic converter in this build.",
      "Copy with browser HTML/plain text or import the full DOCX; equations and RTF picture/layout fidelity need review.",
    );
  const asset = async (
    bytes: Uint8Array,
    mime: string,
    name: string,
    alt: string,
  ) => {
    const header = readImageHeader(bytes);
    if (mime && mime !== header.mime)
      throw new Error("Clipboard image bytes and exposed MIME type differ.");
    const source = await documentSource(bytes, name, header.mime);
    sources[source.id] = source;
    const assetId = `asset:${source.sha256}`;
    model.assets[assetId] = {
      sourceId: source.id,
      mime: header.mime,
      width: header.width,
      height: header.height,
      alt: alt.slice(0, 500),
      name: source.name,
    };
    return assetId;
  };
  let html = input.html ?? "";
  if (html) {
    html = html.replace(
      /<([A-Za-z_][\w.-]*):(oMathPara|oMath)\b[^>]*>[\s\S]*?<\/\1:\2\s*>/g,
      (fragment, prefix) => {
        const token = `WORDMATH${math.size}TOKEN`;
        try {
          const withNamespace = new RegExp(`xmlns:${prefix}\\s*=`).test(
            fragment,
          )
            ? fragment
            : fragment.replace(/^<[^\s>]+/, `$& xmlns:${prefix}="${M}"`);
          math.set(token, convertOmml(withNamespace));
        } catch {
          math.set(token, {
            status: "unsupported",
            source: "",
            original: fragment,
            reason: "Malformed clipboard OMML.",
          });
        }
        return `<span data-word-math="${token}"></span>`;
      },
    );
    if (
      /<(?:[\w-]+:)?(?:math|oMath)|mso-element:field|Equation\.3|MathType|<v:imagedata/i.test(
        html,
      )
    )
      diagnostic(
        "clipboard-math-review",
        "The clipboard contains equation/legacy metadata outside the validated OMML subset.",
        "Import the full DOCX to retain equation structures, OLE objects and available previews.",
      );
    // Only local raster data images survive the sanitizer. No remote/file URL
    // enters the inert DOM parser, so it cannot trigger document network loads.
    const missingImages = [
      ...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']?([^\s"'>]+)/gi),
    ].filter((m) => !/^data:image\/(?:png|jpeg);base64,/i.test(m[1])).length;
    if (missingImages)
      diagnostic(
        "clipboard-linked-image",
        `${missingImages} externally linked/file image(s) cannot be recovered from this paste.`,
        "Embed images in the full DOCX, or paste the local PNG/JPEG separately.",
      );
    const safe = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        "p",
        "div",
        "span",
        "b",
        "strong",
        "i",
        "em",
        "u",
        "br",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "td",
        "th",
        "img",
        "sup",
        "sub",
      ],
      ALLOWED_ATTR: [
        "src",
        "alt",
        "style",
        "width",
        "height",
        "colspan",
        "rowspan",
        "data-word-math",
      ],
      ALLOW_DATA_ATTR: true,
      ALLOWED_URI_REGEXP: /^data:image\/(?:png|jpeg);base64,/i,
    });
    const dom = new DOMParser().parseFromString(safe, "text/html");
    const imageMap = new Map<Element, string>();
    for (const img of dom.querySelectorAll("img")) {
      abort(signal);
      const src = img.getAttribute("src");
      if (!src) {
        img.replaceWith(
          dom.createTextNode("[Missing clipboard image — import full DOCX]"),
        );
        continue;
      }
      const decoded = dataImage(src);
      if (imageMap.size >= 12)
        throw new Error("Paste at most 12 images at once.");
      const assetId = await asset(
        decoded.bytes,
        decoded.mime,
        "pasted-image",
        img.getAttribute("alt") || "Pasted image",
      );
      imageMap.set(img, assetId);
    }
    const provenance = (path: string) => ({ part: "clipboard.html", path });
    const inline = (
      nodes: NodeListOf<ChildNode> | ChildNode[],
      target: DocumentInline[],
      path: string,
      inherited: TextFormat = {},
    ) => {
      for (const node of nodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? "";
          if (text)
            target.push({
              id: id("inline"),
              kind: "text",
              text,
              format: inherited,
            });
          continue;
        }
        if (!(node instanceof HTMLElement)) continue;
        const tag = node.tagName.toLowerCase(),
          token = node.getAttribute("data-word-math");
        if (token && math.has(token)) {
          const eq = math.get(token)!;
          usedMath.add(token);
          target.push({
            id: id("equation"),
            kind: "equation",
            source: eq.source,
            original: eq.original,
            encoding: "omml",
            status: eq.status,
          });
          if (eq.status === "unsupported")
            diagnostic(
              "unsupported-equation",
              eq.reason ?? "Clipboard equation needs review.",
              "Import full DOCX or enter verified LaTeX.",
            );
          continue;
        }
        if (tag === "img") {
          const assetId = imageMap.get(node);
          if (assetId) {
            const a = model.assets[assetId];
            target.push({
              id: id("inline"),
              kind: "image",
              assetId,
              width: Math.min(
                10000,
                Math.max(1, Number(node.getAttribute("width")) || a.width),
              ),
              height: Math.min(
                10000,
                Math.max(1, Number(node.getAttribute("height")) || a.height),
              ),
              alt: a.alt,
              floating: false,
            });
          }
          continue;
        }
        if (tag === "br") {
          target.push({
            id: id("inline"),
            kind: "text",
            text: "\n",
            format: inherited,
          });
          continue;
        }
        if (tag === "sup" || tag === "sub")
          diagnostic(
            "clipboard-script-format",
            "Superscript/subscript text needs equation review in the semantic draft.",
            "Replace with a verified equation or import full DOCX.",
          );
        inline(node.childNodes, target, path, {
          ...inherited,
          ...format(node),
        });
      }
    };
    const parse = (
      container: Element,
      path: string,
      depth = 0,
    ): DocumentBlock[] => {
      if (depth > 8)
        throw new Error(
          "Clipboard table/list nesting exceeds supported depth.",
        );
      const out: DocumentBlock[] = [];
      let stray: ChildNode[] = [];
      const flush = () => {
        if (!stray.length) return;
        const inlines: DocumentInline[] = [];
        inline(stray, inlines, path);
        if (inlines.some((i) => i.kind !== "text" || i.text.trim()))
          out.push({
            id: id("block"),
            kind: "paragraph",
            provenance: provenance(path),
            format: { fontSize: 24, lineHeight: 1.4 },
            inlines,
          });
        stray = [];
      };
      let index = 0;
      for (const node of container.childNodes) {
        if (!(node instanceof HTMLElement)) {
          stray.push(node);
          continue;
        }
        const tag = node.tagName.toLowerCase(),
          loc = `${path}/${tag}[${index++}]`;
        if (tag === "table") {
          flush();
          const rows: {
            cells: {
              blocks: DocumentBlock[];
              colSpan: number;
              rowSpan: number;
            }[];
          }[] = [];
          for (const tr of node.querySelectorAll("tr")) {
            if (tr.closest("table") !== node) continue;
            const cells = [...tr.children]
              .filter((c) => ["TD", "TH"].includes(c.tagName))
              .map((c) => ({
                blocks: parse(c, `${loc}/cell`, depth + 1),
                colSpan: Math.min(
                  1000,
                  Math.max(1, Number(c.getAttribute("colspan")) || 1),
                ),
                rowSpan: Math.min(
                  1000,
                  Math.max(1, Number(c.getAttribute("rowspan")) || 1),
                ),
              }));
            rows.push({ cells });
          }
          out.push({
            id: id("block"),
            kind: "table",
            provenance: provenance(loc),
            format: { fontSize: 24, lineHeight: 1.4 },
            rows,
          });
          continue;
        }
        if (tag === "ol" || tag === "ul") {
          flush();
          let number = 0;
          for (const li of node.children) {
            if (li.tagName !== "LI") continue;
            const inlines: DocumentInline[] = [];
            inline(li.childNodes, inlines, loc);
            out.push({
              id: id("block"),
              kind: "paragraph",
              provenance: provenance(loc),
              format: {
                fontSize: 24,
                lineHeight: 1.4,
                ...format(li as HTMLElement),
              },
              inlines,
              list: {
                kind: tag === "ul" ? "bullet" : "number",
                level: Math.min(8, depth),
                label: tag === "ul" ? "•" : `${++number}.`,
              },
            });
          }
          continue;
        }
        if (
          ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li"].includes(tag)
        ) {
          flush();
          if (
            node.querySelector(
              ":scope > table,:scope > p,:scope > div,:scope > ul,:scope > ol",
            )
          ) {
            out.push(...parse(node, loc, depth + 1));
            continue;
          }
          const inlines: DocumentInline[] = [];
          inline(node.childNodes, inlines, loc);
          const heading = /^h[1-6]$/.test(tag) ? Number(tag[1]) : undefined;
          const p: ParagraphBlock = {
            id: id("block"),
            kind: "paragraph",
            provenance: provenance(loc),
            format: {
              fontSize: heading ? Math.max(24, 42 - heading * 3) : 24,
              lineHeight: 1.4,
              ...format(node),
            },
            inlines,
            ...(heading ? { heading } : {}),
          };
          out.push(p);
          continue;
        }
        stray.push(node);
      }
      flush();
      return out;
    };
    model.blocks = parse(dom.body, "/clipboard");
    for (const [token, eq] of math)
      if (!usedMath.has(token)) {
        const blockId = id("block");
        model.blocks.push({
          id: blockId,
          kind: "unsupported",
          provenance: {
            part: "clipboard.html",
            path: "/hidden-equation",
            xml: eq.original,
          },
          format: {},
          label: "Clipboard equation location unavailable",
          reason:
            "The equation was in hidden/conditional Word metadata; its visual source order cannot be verified from this paste.",
        });
        diagnostic(
          "clipboard-hidden-equation",
          "An equation was preserved from clipboard metadata but cannot be placed reliably.",
          "Import the full DOCX to recover source order and editable equations.",
          blockId,
        );
      }
  } else if (input.text) {
    model.blocks = input.text
      .replaceAll("\r\n", "\n")
      .split(/\n[\t ]*\n+/)
      .map((text, index) => ({
        id: id("block"),
        kind: "paragraph",
        provenance: { part: "clipboard.txt", path: `/line[${index}]` },
        format: { fontSize: 24, lineHeight: 1.4 },
        inlines: text
          ? [{ id: id("inline"), kind: "text", text, format: {} }]
          : [],
      }));
  } else if (input.rtf) {
    model.blocks.push({
      id: id("block"),
      kind: "unsupported",
      provenance: { part: "clipboard.rtf", path: "/" },
      format: {},
      label: "RTF requires conversion",
      reason:
        "Original RTF bytes are retained, but no validated RTF semantic converter is installed. Paste plain/HTML text or import DOCX.",
    });
  }
  const representedAssets = new Set(Object.keys(model.assets));
  for (const [index, blob] of (input.images ?? []).entries()) {
    abort(signal);
    const bytes = new Uint8Array(await blob.arrayBuffer()),
      assetId = await asset(
        bytes,
        blob.type,
        `pasted-image-${index + 1}`,
        "Pasted image",
      ),
      a = model.assets[assetId];
    // Word may expose the same picture both in HTML and as a file flavor.
    // Retain multiple explicit HTML occurrences but do not append its file twin.
    if (representedAssets.has(assetId)) continue;
    representedAssets.add(assetId);
    model.blocks.push({
      id: id("block"),
      kind: "image",
      provenance: { part: "clipboard.images", path: `/image[${index}]` },
      format: {},
      assetId,
      width: a.width,
      height: a.height,
      alt: a.alt,
      floating: false,
    });
  }
  abort(signal);
  await validateDocumentImages(sources, signal);
  abort(signal);
  return { document: validateDocument(model, sources), sources };
}
