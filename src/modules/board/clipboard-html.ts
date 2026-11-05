import DOMPurify from "dompurify";
import type { TLRichText } from "tldraw";
import { validateRichText } from "../workspace/content-validation.ts";
import { dataImage, MAX_TOTAL_IMAGE_PIXELS } from "../media/image-format.ts";
export const MAX_CLIPBOARD_CHARS = 20_000_000;
export function plainRichText(text: string): TLRichText {
  const result = {
    type: "doc",
    content: text
      .replaceAll("\r\n", "\n")
      .split("\n")
      .map((line) => ({
        type: "paragraph",
        content: line ? [{ type: "text", text: line }] : [],
      })),
  };
  validateRichText(result);
  return result as TLRichText;
}
export function clipboardHtml(html: string): {
  richText: TLRichText;
  images: { src: string; alt: string }[];
  notice: string;
} {
  if (html.length > MAX_CLIPBOARD_CHARS)
    throw new Error("Clipboard content exceeds the 20 MB text limit.");
  if (/<\s*(script|iframe|object|embed|svg|math|link|meta|style)\b/i.test(html))
    throw new Error("Executable or unsupported markup was rejected.");
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
      "ul",
      "ol",
      "li",
      "img",
    ],
    ALLOWED_ATTR: ["src", "alt", "style", "dir"],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^data:image\/(?:png|jpeg);base64,/i,
  });
  let imagePixels = 0;
  const doc = new DOMParser().parseFromString(safe, "text/html"),
    images: { src: string; alt: string }[] = [],
    paragraphs: any[] = [];
  let content: any[] = [];
  const flush = () => {
    if (content.length) {
      paragraphs.push({ type: "paragraph", content });
      content = [];
    }
  };
  function walk(node: Node, marks: any[] = []) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text && (text.trim() || content.length))
        content.push({
          type: "text",
          text,
          ...(marks.length ? { marks } : {}),
        });
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "img") {
      const src = node.getAttribute("src");
      if (src) {
        if (images.length >= 12)
          throw new Error("Paste at most 12 images at once.");
        const image = dataImage(src);
        imagePixels += image.width * image.height;
        if (imagePixels > MAX_TOTAL_IMAGE_PIXELS)
          throw new Error(
            "Clipboard images exceed the 32 megapixel decoded limit.",
          );
        images.push({
          src,
          alt: (node.getAttribute("alt") ?? "Pasted image").slice(0, 120),
        });
      }
      return;
    }
    if (tag === "br") {
      flush();
      return;
    }
    const block = ["p", "div", "h1", "h2", "h3", "li", "ul", "ol"].includes(
      tag,
    );
    if (block) flush();
    const next = [...marks],
      style = (node as HTMLElement).style;
    const add = (type: string) => {
      if (!next.some((m) => m.type === type)) next.push({ type });
    };
    if (
      ["b", "strong", "h1", "h2", "h3"].includes(tag) ||
      style?.fontWeight === "bold" ||
      Number(style?.fontWeight) >= 600
    )
      add("bold");
    if (["i", "em"].includes(tag) || style?.fontStyle === "italic")
      add("italic");
    if (tag === "u" || style?.textDecoration.includes("underline"))
      add("underline");
    if (tag === "li") content.push({ type: "text", text: "• " });
    for (const child of node.childNodes) walk(child, next);
    if (block) flush();
  }
  for (const node of doc.body.childNodes) walk(node);
  flush();
  const richText = {
    type: "doc",
    content: paragraphs.length
      ? paragraphs
      : [{ type: "paragraph", content: [] }],
  } as TLRichText;
  validateRichText(richText);
  return {
    richText,
    images,
    notice:
      "Imported supported text formatting and local data images. Linked images, tables, CSS layout and RTF/Word fidelity require separate import support.",
  };
}
