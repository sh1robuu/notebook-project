import { unzipSync } from "fflate";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type {
  Element as XmlElement,
  Document as XmlDocument,
} from "@xmldom/xmldom";
export type { XmlElement, XmlDocument };
export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
export const R =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const REL =
  "http://schemas.openxmlformats.org/package/2006/relationships";
export type OoxmlRelationship = {
  id: string;
  type: string;
  target: string;
  external: boolean;
};
export type OoxmlPackage = {
  files: Record<string, Uint8Array>;
  xml(part: string): XmlDocument;
  relationships(part: string): OoxmlRelationship[];
};
const decoder = new TextDecoder("utf-8", { fatal: true });
export function parseXml(xml: string): XmlDocument {
  if (xml.length > 8_000_000 || /<!\s*(?:DOCTYPE|ENTITY)/i.test(xml))
    throw new Error(
      "XML DTD/entity declarations or oversized XML are unsupported.",
    );
  let nodes = 0;
  const parsed = new DOMParser({
    onError: (level, message) => {
      throw new Error(`Malformed XML (${level}): ${message}`);
    },
  }).parseFromString(xml, "application/xml");
  if (!parsed.documentElement) throw new Error("Invalid XML document root.");
  const visit = (node: XmlElement, depth: number) => {
    if (++nodes > 200000 || depth > 80)
      throw new Error("XML depth/node resource limit exceeded.");
    for (const child of elements(node)) visit(child, depth + 1);
  };
  visit(parsed.documentElement, 0);
  return parsed;
}
export function serializeXml(element: XmlElement): string {
  return new XMLSerializer().serializeToString(element);
}
export function elements(element: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (let i = 0; i < element.childNodes.length; i++) {
    const node = element.childNodes.item(i);
    if (node?.nodeType === 1) out.push(node as XmlElement);
  }
  return out;
}
export function children(
  element: XmlElement,
  ns: string,
  localName: string,
): XmlElement[] {
  return elements(element).filter(
    (n) => n.namespaceURI === ns && n.localName === localName,
  );
}
export function child(
  element: XmlElement | undefined,
  ns: string,
  localName: string,
): XmlElement | undefined {
  return element ? children(element, ns, localName)[0] : undefined;
}
export function descendants(
  element: XmlElement,
  ns: string,
  localName: string,
): XmlElement[] {
  const out: XmlElement[] = [];
  const nodes = element.getElementsByTagNameNS(ns, localName);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes.item(i);
    if (node) out.push(node);
  }
  return out;
}
export function attribute(
  element: XmlElement | undefined,
  ns: string,
  name: string,
): string {
  return element?.getAttributeNS(ns, name) ?? "";
}
export function safePart(base: string, target: string): string {
  if (
    !target ||
    /[\\\u0000-\u001f?#]/.test(target) ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  )
    throw new Error("Unsafe OOXML relationship target.");
  const parts = target.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const component of target.split("/")) {
    if (!component || component === ".") continue;
    if (component === "..") {
      if (!parts.length) throw new Error("OOXML relationship path traversal.");
      parts.pop();
    } else parts.push(component);
  }
  return parts.join("/");
}
export function readOoxmlPackage(
  bytes: Uint8Array,
  kind: "docx" | "pptx" = "docx",
): OoxmlPackage {
  if (
    bytes.length < 4 ||
    bytes.length > 50_000_000 ||
    bytes[0] !== 80 ||
    bytes[1] !== 75
  )
    throw new Error(
      kind === "docx"
        ? "This is not a supported DOCX ZIP package (maximum 50 MB). Convert legacy .doc using Word or LibreOffice Save As .docx."
        : "This is not a supported PPTX ZIP package (maximum 50 MB).",
    );
  const seen = new Set<string>();
  let expanded = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(entry) {
        if (
          !entry.name ||
          entry.name.startsWith("/") ||
          /[:\\\u0000-\u001f]/.test(entry.name) ||
          entry.name.split("/").some((p) => p === ".." || p === ".") ||
          (kind === "pptx" &&
            (entry.name.length > 512 ||
              /(^|\/)(?:__proto__|constructor|prototype)(?:\/|$)|%(?:2e|2f|5c)|\/\//i.test(
                entry.name,
              ))) ||
          seen.has(entry.name)
        )
          throw new Error("Unsafe or duplicate OOXML ZIP path.");
        seen.add(entry.name);
        expanded += entry.originalSize;
        if (
          seen.size > 2000 ||
          !Number.isSafeInteger(entry.originalSize) ||
          entry.originalSize < 0 ||
          (kind === "pptx" &&
            entry.compression === 0 &&
            entry.size !== entry.originalSize) ||
          expanded > 100_000_000 ||
          (/\.(xml|rels)$/i.test(entry.name) && entry.originalSize > 8_000_000)
        )
          throw new Error(
            "OOXML ZIP resource limit exceeded (2,000 entries /100 MB expanded /8 MB XML part).",
          );
        if (
          /(^|\/)(?:vbaProject\.bin|vbaData\.xml|activeX)(?:\/|$)/i.test(
            entry.name,
          )
        )
          throw new Error(
            "Active macros/ActiveX are unsupported. Remove active content before import.",
          );
        return !entry.name.endsWith("/");
      },
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : `Unreadable ${kind.toUpperCase()} ZIP package.`,
    );
  }
  if (
    !files["[Content_Types].xml"] ||
    !files["_rels/.rels"] ||
    (kind === "docx" && !files["word/document.xml"])
  )
    throw new Error(
      kind === "docx"
        ? "The OOXML package needs content types, relationships and word/document.xml."
        : "The PPTX package needs content types and root relationships.",
    );
  if (Object.values(files).reduce((n, b) => n + b.length, 0) > 100_000_000)
    throw new Error("OOXML expanded resource budget exceeded.");
  const cache = new Map<string, XmlDocument>();
  const pkg: OoxmlPackage = {
    files,
    xml(part) {
      const existing = cache.get(part);
      if (existing) return existing;
      if (!Object.hasOwn(files, part))
        throw new Error(`Missing OOXML part: ${part}`);
      let text: string;
      try {
        text = decoder.decode(files[part]);
      } catch {
        throw new Error(`Unsupported or invalid XML encoding in ${part}.`);
      }
      const doc = parseXml(text);
      cache.set(part, doc);
      return doc;
    },
    relationships(part) {
      const pieces = part.split("/"),
        name = pieces.pop()!;
      const relPart = part
        ? [...pieces, "_rels", `${name}.rels`].join("/")
        : "_rels/.rels";
      if (!Object.hasOwn(files, relPart)) return [];
      const root = pkg.xml(relPart).documentElement!;
      if (root.namespaceURI !== REL || root.localName !== "Relationships")
        throw new Error("Invalid OOXML relationships root.");
      const ids = new Set<string>();
      return elements(root).map((el) => {
        if (el.namespaceURI !== REL || el.localName !== "Relationship")
          throw new Error("Invalid OOXML relationship element.");
        const id = el.getAttribute("Id") ?? "",
          type = el.getAttribute("Type") ?? "",
          target = el.getAttribute("Target") ?? "",
          mode = el.getAttribute("TargetMode") ?? "",
          external = mode === "External";
        if (
          !id ||
          id.length > 240 ||
          ids.has(id) ||
          !type ||
          type.length > 500 ||
          (kind === "pptx" &&
            (!target ||
              (mode !== "" && mode !== "Internal" && mode !== "External") ||
              (!external && /%(?:2e|2f|5c)|\/\//i.test(target)))) ||
          target.length > 2000
        )
          throw new Error("Invalid or duplicate OOXML relationship.");
        ids.add(id);
        if (
          /(?:vbaProject|activeX|oleObject)$/i.test(type) &&
          !external &&
          /(?:vbaProject|activeX)$/i.test(type)
        )
          throw new Error("Active OOXML content is unsupported.");
        return {
          id,
          type,
          target: external ? target : safePart(part, target),
          external,
        };
      });
    },
  };
  const types = pkg.xml("[Content_Types].xml").documentElement!;
  if (
    types.namespaceURI !==
      "http://schemas.openxmlformats.org/package/2006/content-types" ||
    types.localName !== "Types"
  )
    throw new Error("Invalid OOXML content types root.");
  for (const entry of elements(types))
    if (
      /macroEnabled|vbaProject|activeX/i.test(
        entry.getAttribute("ContentType") ?? "",
      )
    )
      throw new Error("Macro-enabled or active OOXML content is unsupported.");
  // Parse every relationships part before a visual converter can see the package.
  for (const name of Object.keys(files))
    if (name.endsWith(".rels")) {
      const root = pkg.xml(name).documentElement!;
      if (root.namespaceURI !== REL || root.localName !== "Relationships")
        throw new Error("Invalid OOXML relationships.");
    }
  return pkg;
}
