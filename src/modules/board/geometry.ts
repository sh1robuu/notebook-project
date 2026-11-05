export type Point = { x: number; y: number };
export type InkPoint = Point & { z: number };
export type Sweep = { a: Point; b: Point };
export type Transform = Point & { rotation: number; scale: number };
export type Camera = Point & { zoom: number; left: number; top: number };
const EPS = 1e-9;

export function worldToScreen(p: Point, c: Camera): Point {
  return { x: (p.x - c.x) * c.zoom + c.left, y: (p.y - c.y) * c.zoom + c.top };
}
export function screenToWorld(p: Point, c: Camera): Point {
  return { x: (p.x - c.left) / c.zoom + c.x, y: (p.y - c.top) / c.zoom + c.y };
}
export function toLocal(p: Point, t: Transform): Point {
  const x = p.x - t.x,
    y = p.y - t.y,
    c = Math.cos(t.rotation),
    s = Math.sin(t.rotation);
  return { x: (x * c + y * s) / t.scale, y: (y * c - x * s) / t.scale };
}
export function toWorld(p: Point, t: Transform): Point {
  const c = Math.cos(t.rotation),
    s = Math.sin(t.rotation);
  return {
    x: t.x + (p.x * c - p.y * s) * t.scale,
    y: t.y + (p.x * s + p.y * c) * t.scale,
  };
}
type Interval = [number, number];
function linearRange(
  base: number,
  delta: number,
  min: number,
  max: number,
): Interval | null {
  if (Math.abs(delta) < EPS)
    return base >= min - EPS && base <= max + EPS ? [0, 1] : null;
  const a = (min - base) / delta,
    b = (max - base) / delta;
  const lo = Math.max(0, Math.min(a, b)),
    hi = Math.min(1, Math.max(a, b));
  return hi >= lo ? [lo, hi] : null;
}
function circleRange(p: Point, q: Point, c: Point, r: number): Interval | null {
  const dx = q.x - p.x,
    dy = q.y - p.y,
    x = p.x - c.x,
    y = p.y - c.y;
  const a = dx * dx + dy * dy,
    b = 2 * (x * dx + y * dy),
    v = x * x + y * y - r * r;
  if (a < EPS) return v <= 0 ? [0, 1] : null;
  const d = b * b - 4 * a * v;
  if (d < 0) return null;
  const lo = Math.max(0, (-b - Math.sqrt(d)) / (2 * a)),
    hi = Math.min(1, (-b + Math.sqrt(d)) / (2 * a));
  return hi >= lo ? [lo, hi] : null;
}
// Capsule = the finite strip plus its two endpoint discs. Clip analytically,
// so fast pointer movement cannot jump over sparse stroke samples.
function cutRanges(p: Point, q: Point, sweep: Sweep, r: number): Interval[] {
  const { a, b } = sweep,
    vx = b.x - a.x,
    vy = b.y - a.y,
    l2 = vx * vx + vy * vy;
  const ranges = [circleRange(p, q, a, r), circleRange(p, q, b, r)].filter(
    (x): x is Interval => x !== null,
  );
  if (l2 > EPS) {
    const dx = q.x - p.x,
      dy = q.y - p.y;
    const u = linearRange(
      (p.x - a.x) * vx + (p.y - a.y) * vy,
      dx * vx + dy * vy,
      0,
      l2,
    );
    const v = linearRange(
      (p.x - a.x) * vy - (p.y - a.y) * vx,
      dx * vy - dy * vx,
      -r * Math.sqrt(l2),
      r * Math.sqrt(l2),
    );
    if (u && v) {
      const lo = Math.max(u[0], v[0]),
        hi = Math.min(u[1], v[1]);
      if (hi >= lo) ranges.push([lo, hi]);
    }
  }
  const merged: Interval[] = [];
  for (const range of ranges.sort((x, y) => x[0] - y[0])) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1] + EPS)
      last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}
function lerp(a: InkPoint, b: InkPoint, t: number): InkPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}
function same(a: Point, b: Point) {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

export function splitStroke(
  points: InkPoint[],
  sweep: Sweep,
  radius: number,
): { changed: boolean; fragments: InkPoint[][] } {
  if (!Number.isFinite(radius) || radius < 0)
    throw new Error("Invalid eraser radius");
  if (!points.length) return { changed: false, fragments: [] };
  if (points.length === 1) {
    const cut = cutRanges(points[0], points[0], sweep, radius).length > 0;
    return { changed: cut, fragments: cut ? [] : [points] };
  }
  let changed = false;
  const fragments: InkPoint[][] = [];
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1],
      q = points[i],
      cuts = cutRanges(p, q, sweep, radius);
    const keep: Interval[] = [];
    let cursor = 0;
    for (const [lo, hi] of cuts) {
      if (hi - lo <= EPS) continue;
      changed = true;
      if (lo > cursor + EPS) keep.push([cursor, lo]);
      cursor = Math.max(cursor, hi);
    }
    if (cursor < 1 - EPS) keep.push([cursor, 1]);
    for (const [lo, hi] of keep) {
      const start = lerp(p, q, lo),
        end = lerp(p, q, hi),
        last = fragments.at(-1);
      if (last && lo === 0 && same(last.at(-1)!, start)) {
        if (!same(start, end)) last.push(end);
      } else fragments.push(same(start, end) ? [start] : [start, end]);
    }
  }
  return changed
    ? { changed: true, fragments }
    : { changed: false, fragments: [points] };
}
