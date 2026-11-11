export type ImagePoint = { x: number; y: number };
export type AnnotationTool = "pen" | "highlight";
export type Annotation = {
  id: string;
  tool: AnnotationTool;
  points: readonly ImagePoint[];
};
export type AnnotationHistory = {
  strokes: readonly Annotation[];
  past: readonly (readonly Annotation[])[];
  future: readonly (readonly Annotation[])[];
};
type Edit =
  | { type: "add"; stroke: Annotation }
  | { type: "erase"; id: string }
  | { type: "undo" | "redo" | "clear" };

export function emptyAnnotations(): AnnotationHistory {
  return { strokes: [], past: [], future: [] };
}
export function editAnnotations(
  history: AnnotationHistory,
  edit: Edit,
): AnnotationHistory {
  const { strokes, past, future } = history;
  if (edit.type === "undo")
    return past.length
      ? {
          strokes: past.at(-1)!,
          past: past.slice(0, -1),
          future: [strokes, ...future],
        }
      : history;
  if (edit.type === "redo")
    return future.length
      ? {
          strokes: future[0],
          past: [...past, strokes],
          future: future.slice(1),
        }
      : history;
  const next =
    edit.type === "add"
      ? [...strokes, edit.stroke]
      : edit.type === "erase"
        ? strokes.filter((stroke) => stroke.id !== edit.id)
        : [];
  if (next.length === strokes.length || next.length > 200) return history;
  return { strokes: next, past: [...past.slice(-49), strokes], future: [] };
}
export function pointInImage(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
): ImagePoint {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return {
    x: clamp((clientX - box.left) / box.width),
    y: clamp((clientY - box.top) / box.height),
  };
}
export function strokeHit(
  stroke: Annotation,
  point: ImagePoint,
  width: number,
  height: number,
  tolerance: number,
) {
  const { points } = stroke;
  for (let i = 0; i < points.length; i++) {
    const start = points[Math.max(0, i - 1)],
      end = points[i];
    const dx = (end.x - start.x) * width,
      dy = (end.y - start.y) * height;
    const x = (point.x - start.x) * width,
      y = (point.y - start.y) * height;
    const size = dx * dx + dy * dy;
    const along = size ? Math.min(1, Math.max(0, (x * dx + y * dy) / size)) : 0;
    if (Math.hypot(x - dx * along, y - dy * along) <= tolerance) return true;
  }
  return false;
}
export function annotationStyle(
  tool: AnnotationTool,
  width: number,
  height: number,
) {
  return tool === "highlight"
    ? {
        color: "#f4bb12",
        opacity: 0.4,
        width: Math.max(5, Math.min(width, height) * 0.018),
      }
    : {
        color: "#94253b",
        opacity: 1,
        width: Math.max(2, Math.min(width, height) * 0.005),
      };
}
export function annotationPath(
  points: readonly ImagePoint[],
  width: number,
  height: number,
) {
  const path = points
    .map(
      (point, i) =>
        (i ? "L" : "M") +
        (point.x * width).toFixed(2) +
        " " +
        (point.y * height).toFixed(2),
    )
    .join(" ");
  return points.length === 1 ? path + " l0.01 0" : path;
}

export async function makeAnnotationSnapshot(
  image: Blob,
  strokes: readonly Annotation[],
  name: string,
) {
  const bitmap = await createImageBitmap(image);
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width * bitmap.height > 5_000_000
    )
      throw new Error("Kích thước ảnh không phù hợp để chèn.");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Không tạo được ảnh để chèn.");
    context.drawImage(bitmap, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of strokes) {
      const style = annotationStyle(stroke.tool, bitmap.width, bitmap.height);
      context.strokeStyle = style.color;
      context.globalAlpha = style.opacity;
      context.lineWidth = style.width;
      context.stroke(
        new Path2D(annotationPath(stroke.points, bitmap.width, bitmap.height)),
      );
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Không tạo được ảnh để chèn.")),
        "image/jpeg",
        0.92,
      ),
    );
    return new File([blob], name.slice(0, 95) + ".jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
