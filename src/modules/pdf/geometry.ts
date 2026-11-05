import { WorkspaceError } from "../workspace/contracts.ts";
export type Matrix = readonly number[];
export function applyMatrix(m: Matrix, p: { x: number; y: number }) {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}
export function multiply(
  a: Matrix,
  b: Matrix,
): [number, number, number, number, number, number] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function inverse(m: Matrix): number[] {
  const d = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12)
    throw new WorkspaceError("matrix", "Singular page transform.");
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ];
}
export function parsePageRange(value: string, count: number): number[] {
  const out: number[] = [];
  for (const part of value.split(",")) {
    const m = /^\s*([1-9]\d*)(?:\s*-\s*([1-9]\d*))?\s*$/.exec(part);
    if (!m)
      throw new WorkspaceError("range", "Use page numbers such as 1,3-5.");
    const from = Number(m[1]),
      to = Number(m[2] ?? m[1]);
    if (from > to || to > count || to - from > 200)
      throw new WorkspaceError("range", "Page range is outside this lesson.");
    for (let n = from; n <= to; n++) {
      if (out.includes(n - 1))
        throw new WorkspaceError("range", "A page is repeated in the range.");
      out.push(n - 1);
    }
  }
  return out;
}
export const MAX_RASTER_PIXELS = 16_000_000;
export function rasterSize(w: number, h: number, scale: number) {
  const width = Math.ceil(w * scale),
    height = Math.ceil(h * scale);
  if (
    ![w, h, scale].every((n) => Number.isFinite(n) && n > 0) ||
    width * height > MAX_RASTER_PIXELS ||
    width > 16384 ||
    height > 16384
  )
    throw new WorkspaceError(
      "limit",
      "Output exceeds 16 million pixels or 16,384 pixels per side. Choose a smaller region or resolution.",
    );
  return { width, height, scale };
}
