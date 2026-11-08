import {
  attribute,
  child,
  children,
  type XmlElement,
} from "../documents/package.ts";

export const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
export const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
export const EMU_PER_PIXEL = 9_525;
export const p = (node: XmlElement | undefined, name: string) =>
  child(node, P, name);
export const a = (node: XmlElement | undefined, name: string) =>
  child(node, A, name);
export const ps = (node: XmlElement | undefined, name: string) =>
  node ? children(node, P, name) : [];
export const as = (node: XmlElement | undefined, name: string) =>
  node ? children(node, A, name) : [];
export const attr = (node: XmlElement | undefined, name: string) =>
  attribute(node, "", name);
export const on = (value: string) => value === "1" || value === "true";
export const off = (value: string) => value === "0" || value === "false";

export function numeric(value: string, fallback = 0) {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function px(value: string, fallback = 0) {
  return numeric(value, fallback * EMU_PER_PIXEL) / EMU_PER_PIXEL;
}

export function percent(value: string, fallback = 0) {
  return value.endsWith("%")
    ? numeric(value.slice(0, -1), fallback * 100) / 100
    : numeric(value, fallback * 100_000) / 100_000;
}

export function boundedText(value: string, maximum: number) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .slice(0, maximum);
}
