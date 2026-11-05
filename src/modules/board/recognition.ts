import type { Point } from "./geometry.ts";
export function recognizeLine(
  points: Point[],
): { start: Point; end: Point } | null {
  if (points.length < 2) return null;
  const start = points[0],
    end = points.at(-1)!,
    dx = end.x - start.x,
    dy = end.y - start.y,
    length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 20) return null;
  if (
    points.some(
      (p) =>
        Math.abs((p.x - start.x) * dy - (p.y - start.y) * dx) / length >
        Math.max(2, length * 0.03),
    )
  )
    return null;
  return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
}
