import { parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { readImageHeader } from "../media/image-format.ts";
import { safePackagePath } from "./bundle-files.ts";
import { readInteractivePreview } from "./preview.ts";

export type HtmlDiagnostic = {
  code: "missing" | "case" | "network" | "unsupported";
  message: string;
};

const HTML_NS = "http://www.w3.org/1999/xhtml";
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_HTML_BYTES = 2_000_000;
const MAX_STYLE_BYTES = 250_000;
const MAX_INLINE_BYTES = 12_000_000;
const MAX_VIEW_CHARS = 18_000_000;
const MAX_INLINE_PIXELS = 16_000_000;

const tags = new Set(
  "article aside section main header footer nav div span p h1 h2 h3 h4 h5 h6 figure figcaption blockquote pre code kbd samp var b strong em i u small s mark sub sup dl dt dd ol ul li table caption colgroup col thead tbody tfoot tr th td br hr img details summary label input output meter progress audio video source select option textarea".split(
    " ",
  ),
);
const drop = new Set(
  "script iframe frame frameset object embed applet portal fencedframe svg math template noscript plaintext xmp noembed noframes".split(
    " ",
  ),
);
const voidTags = new Set(["br", "hr", "img", "input", "source", "col"]);
const globalAttrs = new Set([
  "id",
  "class",
  "title",
  "lang",
  "dir",
  "role",
  "hidden",
]);
const localAttrs: Record<string, ReadonlySet<string>> = {
  img: new Set(["alt", "height", "width"]),
  video: new Set(["height", "width"]),
  label: new Set(["for"]),
  ol: new Set(["start", "reversed"]),
  li: new Set(["value"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  td: new Set(["colspan", "rowspan", "headers"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  details: new Set(["open"]),
  input: new Set([
    "checked",
    "disabled",
    "min",
    "max",
    "step",
    "value",
    "type",
  ]),
  meter: new Set(["min", "max", "low", "high", "optimum", "value"]),
  progress: new Set(["max", "value"]),
  output: new Set(["for"]),
  select: new Set(["multiple", "size", "disabled"]),
  option: new Set(["label", "value", "selected", "disabled"]),
  textarea: new Set([
    "rows",
    "cols",
    "maxlength",
    "placeholder",
    "disabled",
    "readonly",
  ]),
};
const allowedInputs = new Set(["range", "checkbox", "radio", "number", "text"]);

// These documents must also use an empty iframe sandbox. No child script,
// external URL, navigation element or app-origin permission is retained.
const policy =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'";
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const attr = (name: string, value: string) =>
  " " + name + '="' + escape(value) + '"';
const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

function decodeText(bytes: Uint8Array, limit: number, description: string) {
  if (bytes.length > limit)
    throw new Error(description + " exceeds its text limit.");
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error(description + " must use UTF-8.");
  }
}

function base64(bytes: Uint8Array) {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 32_768)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32_768)));
  return btoa(chunks.join(""));
}

type ResourceKind = "image" | "font" | "audio" | "video";
type BinaryResource = { mime: string; pixels?: number };
const textAt = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));
function binaryResource(path: string, bytes: Uint8Array): BinaryResource {
  const ext = path.split(".").at(-1)?.toLowerCase();
  switch (ext) {
    case "png":
    case "jpg":
    case "jpeg": {
      const { mime, width, height } = readImageHeader(bytes);
      if (mime === (ext === "png" ? "image/png" : "image/jpeg"))
        return { mime, pixels: width * height };
      break;
    }
    case "woff":
    case "woff2":
      if (
        bytes.length <= 2_000_000 &&
        textAt(bytes, 0, 4) === (ext === "woff" ? "wOFF" : "wOF2")
      )
        return { mime: "font/" + ext };
      break;
    case "wav":
      if (textAt(bytes, 0, 4) === "RIFF" && textAt(bytes, 8, 4) === "WAVE")
        return { mime: "audio/wav" };
      break;
    case "mp3":
      if (
        textAt(bytes, 0, 3) === "ID3" ||
        (bytes[0] === 255 && (bytes[1] & 224) === 224)
      )
        return { mime: "audio/mpeg" };
      break;
    case "ogg":
    case "oga":
      if (textAt(bytes, 0, 4) === "OggS") return { mime: "audio/ogg" };
      break;
    case "mp4":
    case "m4a":
      if (textAt(bytes, 4, 4) === "ftyp")
        return { mime: ext === "mp4" ? "video/mp4" : "audio/mp4" };
      break;
    case "webm":
      if ([26, 69, 223, 163].every((byte, i) => bytes[i] === byte))
        return { mime: "video/webm" };
      break;
  }
  throw new Error("Unsupported or invalid package media.");
}

function resolveLocalPath(base: string, raw: string) {
  if (
    !raw ||
    raw.length > 1024 ||
    /^[/?#]/.test(raw) ||
    /[\\:\u0000-\u001f\u007f?#]/.test(raw)
  )
    throw new Error("Expected a relative package path.");
  const resolved = folderOf(base).split("/").filter(Boolean);
  for (const token of raw.split("/")) {
    const part = decodeURIComponent(token);
    if (
      !part ||
      /[\\/:?#\u0000-\u001f\u007f]/.test(part) ||
      ((part === "." || part === "..") && part !== token)
    )
      throw new Error("Malformed package resource path.");
    if (part === ".") continue;
    if (part === "..") {
      if (!resolved.length) throw new Error("Resource escapes the package.");
      resolved.pop();
    } else resolved.push(part);
  }
  return safePackagePath(resolved.join("/"));
}

export function compileHtml(
  files: ReadonlyMap<string, Uint8Array>,
  entry: string,
  diagnose: (code: HtmlDiagnostic["code"], message: string) => void,
) {
  const document = parse(
    decodeText(files.get(entry)!, MAX_HTML_BYTES, "Entry HTML"),
  );
  const casePaths = new Map(
    [...files.keys()].map((path) => [path.toLowerCase(), path]),
  );
  const binaries = new Map<string, { mime: string; url: string }>();
  const styles = new Map<string, string>();
  let binaryBytes = 0;
  let pixels = 0;
  let styleChars = 0;
  let references = 0;
  function locate(base: string, raw: string) {
    if (++references > 2_000)
      throw new Error("HTML resource reference limit exceeded.");
    const reference = raw.trim();
    if (/^(?:https?:)?\/\//i.test(reference)) {
      diagnose("network", "External resource blocked: " + reference);
      return;
    }
    let path: string;
    try {
      path = resolveLocalPath(base, reference);
    } catch {
      diagnose(
        "unsupported",
        "Unsafe or unsupported resource path: " + reference,
      );
      return;
    }
    const bytes = files.get(path);
    if (bytes) return { path, bytes };
    const matching = casePaths.get(path.toLowerCase());
    if (matching)
      diagnose(
        "case",
        "Case mismatch: " + path + " (package contains " + matching + ").",
      );
    else diagnose("missing", "Missing resource: " + path);
  }

  function embed(base: string, ref: string, kinds: ResourceKind[]) {
    const located = locate(base, ref);
    if (!located) return;
    const { path, bytes } = located;
    let binary = binaries.get(path);
    if (!binary) {
      let format: BinaryResource;
      try {
        format = binaryResource(path, bytes);
      } catch {
        diagnose("unsupported", "Unsupported or invalid local media: " + path);
        return;
      }
      if (!kinds.some((kind) => format.mime.startsWith(kind + "/"))) {
        diagnose("unsupported", "Unexpected resource type: " + path);
        return;
      }
      binaryBytes += bytes.length;
      pixels += format.pixels ?? 0;
      if (binaryBytes > MAX_INLINE_BYTES || pixels > MAX_INLINE_PIXELS)
        throw new Error(
          "Referenced HTML media exceeds the preview memory limit.",
        );
      binary = {
        mime: format.mime,
        url: "data:" + format.mime + ";base64," + base64(bytes),
      };
      binaries.set(path, binary);
    }
    if (!kinds.some((kind) => binary.mime.startsWith(kind + "/"))) {
      diagnose("unsupported", "Unexpected resource type: " + path);
      return;
    }
    return binary;
  }

  function css(source: string, path: string) {
    if (source.length > MAX_STYLE_BYTES)
      throw new Error("HTML style exceeds its text limit.");
    styleChars += source.length;
    if (styleChars > 1_000_000)
      throw new Error("Combined HTML styles exceed the text limit.");
    // Allow only ordinary url() literals. In particular, image-set() can
    // load a quoted data URL without calling url(), bypassing asset checks.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, " ");
    if (
      /@import\b|(?:image-set|src|image)\s*\(|\b(?:data|blob):|\\/i.test(
        withoutComments,
      )
    ) {
      diagnose(
        "unsupported",
        "CSS imports, escaped and dynamic resource references are unsupported: " +
          path,
      );
      for (const external of withoutComments.matchAll(
        /(?:https?:)?\/\/[^\s)"';]+/gi,
      )) {
        if (++references > 2_000)
          throw new Error("HTML resource reference limit exceeded.");
        diagnose("network", "External resource blocked: " + external[0]);
      }
      return "";
    }
    if (/<\/?style\b|<\/?script\b/i.test(source)) {
      diagnose(
        "unsupported",
        "CSS contains an unsafe markup delimiter: " + path,
      );
      return "";
    }
    let added = 0;
    return source.replace(
      /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?<![\w-])url\s*\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^"'()\s\\]*))\s*\)/gi,
      (
        whole,
        double: string | undefined,
        single: string | undefined,
        bare: string | undefined,
      ) => {
        const raw = double ?? single ?? bare;
        if (raw === undefined) return whole;
        const url = embed(path, raw, ["image", "font"])?.url;
        if (!url) return "none";
        added += url.length;
        if (added > MAX_VIEW_CHARS)
          throw new Error("Compiled HTML preview exceeds its size limit.");
        return 'url("' + url + '")';
      },
    );
  }

  const parts = [
    '<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="',
    policy,
    '"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mô phỏng</title></head><body>',
  ];
  let chars = parts.reduce((sum, part) => sum + part.length, 0);
  const append = (part: string) => {
    chars += part.length;
    if (chars > MAX_VIEW_CHARS)
      throw new Error("Compiled HTML preview exceeds its size limit.");
    parts.push(part);
  };
  let nodes = 0;
  function visit(
    node: DefaultTreeAdapterTypes.ChildNode,
    parent: string,
    depth: number,
  ) {
    if (++nodes > 20_000 || depth > 100)
      throw new Error("HTML node/depth limit exceeded.");
    if (node.nodeName === "#text" && "value" in node) {
      if (parent !== "head") append(escape(node.value));
      return;
    }
    if (!("tagName" in node)) return;
    const tag = node.tagName;
    const attrs = new Map(
      node.attrs.filter((a) => !a.namespace).map((a) => [a.name, a.value]),
    );
    if (node.namespaceURI !== HTML_NS || drop.has(tag)) {
      diagnose(
        "unsupported",
        "Removed <" +
          tag +
          ">." +
          (tag === "script"
            ? " Authored JavaScript, modules and dynamic imports are disabled."
            : ""),
      );
      if (tag === "script" && attrs.get("src"))
        locate(entry, attrs.get("src")!);
      return;
    }
    if (tag === "title") return;
    if (tag === "base" || tag === "meta") {
      if (tag === "base" || attrs.has("http-equiv"))
        diagnose("unsupported", "Removed <" + tag + "> navigation or policy.");
      return;
    }
    if (tag === "style" || tag === "link") {
      if (tag === "style") {
        const style = node.childNodes
          .map((child) => ("value" in child ? child.value : ""))
          .join("");
        append("<style>" + css(style, entry) + "</style>");
      } else if (
        attrs.get("rel")?.toLowerCase() === "stylesheet" &&
        attrs.get("href")
      ) {
        const source = locate(entry, attrs.get("href")!);
        if (source && /\.css$/i.test(source.path)) {
          let style = styles.get(source.path);
          if (style === undefined) {
            style = css(
              decodeText(source.bytes, MAX_STYLE_BYTES, "Stylesheet"),
              source.path,
            );
            styles.set(source.path, style);
          }
          append("<style>" + style + "</style>");
        } else if (source)
          diagnose("unsupported", "Expected a local CSS file: " + source.path);
      } else {
        diagnose("unsupported", "Removed unsupported link resource.");
        if (attrs.get("href")) locate(entry, attrs.get("href")!);
      }
      return;
    }
    if (!tags.has(tag)) {
      if (tag !== "html" && tag !== "head" && tag !== "body")
        diagnose("unsupported", "Removed unsupported <" + tag + "> behavior.");
      if (
        tag === "a" &&
        attrs.get("href") &&
        !attrs.get("href")!.startsWith("#")
      )
        locate(entry, attrs.get("href")!);
      for (const child of node.childNodes) visit(child, tag, depth + 1);
      return;
    }
    const inputType = (attrs.get("type") ?? "text").toLowerCase();
    if (tag === "input" && !allowedInputs.has(inputType)) {
      diagnose("unsupported", "Removed unsupported input type: " + inputType);
      return;
    }
    if (tag === "source" && parent !== "audio" && parent !== "video") {
      diagnose(
        "unsupported",
        "Only audio/video source elements are supported.",
      );
      return;
    }
    append("<" + tag);
    for (const [name, value] of attrs) {
      if (
        name.startsWith("on") ||
        name === "srcset" ||
        name === "contenteditable"
      ) {
        diagnose("unsupported", "Removed unsupported HTML attribute: " + name);
      } else if (name === "style") {
        append(attr("style", css(value, entry)));
      } else if (
        value.length <= 2048 &&
        (globalAttrs.has(name) ||
          /^aria-[a-z-]+$/.test(name) ||
          (Object.hasOwn(localAttrs, tag) && localAttrs[tag].has(name)))
      )
        append(attr(name, value));
    }
    const src = attrs.get("src");
    if (
      src &&
      (tag === "img" || tag === "video" || tag === "audio" || tag === "source")
    ) {
      const kind =
        tag === "img"
          ? "image"
          : tag === "source"
            ? (parent as "audio" | "video")
            : tag;
      const asset = embed(entry, src, [kind]);
      if (asset) {
        append(attr("src", asset.url));
        if (tag === "source") append(attr("type", asset.mime));
      }
    }
    if (tag === "video" && attrs.get("poster")) {
      const poster = embed(entry, attrs.get("poster")!, ["image"]);
      if (poster) append(attr("poster", poster.url));
    }
    if (tag === "audio" || tag === "video")
      append(
        ' controls preload="metadata" disablepictureinpicture disableremoteplayback',
      );
    append(">");
    if (!voidTags.has(tag)) {
      for (const child of node.childNodes) visit(child, tag, depth + 1);
      append("</" + tag + ">");
    }
  }
  for (const node of document.childNodes) visit(node, "#document", 0);
  append("</body></html>");
  return parts.join("");
}

export function compilePreview(bytes: Uint8Array) {
  const { mime } = readInteractivePreview(bytes);
  return "data:" + mime + ";base64," + base64(bytes);
}
