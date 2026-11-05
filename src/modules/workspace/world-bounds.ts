type Shape = Record<string, unknown>;
export type LocalBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};
/** Pure geometry guard before restoring native derived bounds or camera state. */
export function validateWorldBounds(
  shapes: Record<string, Shape>,
  pageId: string | Set<string>,
  ink: Map<string, LocalBounds>,
  limit: number,
) {
  const isPage = (id: unknown) =>
    typeof pageId === "string" ? id === pageId : pageId.has(String(id));
  type Matrix = {
    a: number;
    b: number;
    c: number;
    d: number;
    x: number;
    y: number;
  };
  const identity: Matrix = { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 },
    cache = new Map<string, Matrix>();
  const matrix = (id: string, depth = 0): Matrix => {
    const cached = cache.get(id);
    if (cached) return cached;
    if (depth > 32) throw new Error("Parent geometry depth limit.");
    const s = shapes[id],
      parent = isPage(s.parentId)
        ? identity
        : matrix(String(s.parentId), depth + 1),
      c = Math.cos(Number(s.rotation)),
      sin = Math.sin(Number(s.rotation)),
      x = Number(s.x),
      y = Number(s.y);
    const m = {
      a: parent.a * c + parent.c * sin,
      b: parent.b * c + parent.d * sin,
      c: parent.c * c - parent.a * sin,
      d: parent.d * c - parent.b * sin,
      x: parent.a * x + parent.c * y + parent.x,
      y: parent.b * x + parent.d * y + parent.y,
    };
    cache.set(id, m);
    return m;
  };
  const check = (m: Matrix, x: number, y: number) => {
    const wx = m.a * x + m.c * y + m.x,
      wy = m.b * x + m.d * y + m.y;
    if (![wx, wy].every((n) => Number.isFinite(n) && Math.abs(n) <= limit))
      throw new Error("Composed world geometry exceeds coordinate bounds.");
  };
  for (const s of Object.values(shapes)) {
    const id = String(s.id),
      m = matrix(id),
      p = s.props as Record<string, unknown>;
    check(m, 0, 0);
    let box = ink.get(id);
    if (!box && s.type !== "group") {
      const scale = Number(p.scale ?? 1);
      const points: { x: number; y: number }[] = [];
      if (s.type === "line")
        for (const point of Object.values(
          p.points as Record<string, { x: number; y: number }>,
        ))
          points.push(point);
      else if (s.type === "arrow") {
        points.push(
          p.start as { x: number; y: number },
          p.end as { x: number; y: number },
        );
        const bend = Math.abs(Number(p.bend ?? 0));
        for (const point of [...points])
          points.push(
            { x: point.x + bend, y: point.y + bend },
            { x: point.x - bend, y: point.y - bend },
          );
      } else
        points.push(
          { x: 0, y: 0 },
          {
            x: Number(p.w ?? 0) * scale,
            y: (Number(p.h ?? 0) + Number(p.growY ?? 0)) * scale,
          },
        );
      box = {
        minX: Math.min(...points.map((p) => p.x)),
        minY: Math.min(...points.map((p) => p.y)),
        maxX: Math.max(...points.map((p) => p.x)),
        maxY: Math.max(...points.map((p) => p.y)),
      };
    }
    if (box)
      for (const x of [box.minX, box.maxX])
        for (const y of [box.minY, box.maxY]) check(m, x, y);
  }
}
