import type { TLStoreSnapshot } from "tldraw";
import { b64Vecs } from "@tldraw/tlschema";
import { lessonSchema as sdkSchema } from "./schema.ts";
import { finiteBox, validateRichText } from "./content-validation.ts";
import { validateWorldBounds } from "./world-bounds.ts";
import type { LocalBounds } from "./world-bounds.ts";
import {
  dataImage,
  MAX_TOTAL_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_PIXELS,
  MAX_IMAGE_ASSETS,
} from "../media/image-format.ts";
import {
  object,
  WorkspaceError,
  MAX_WORLD_COORDINATE,
  MAX_SHAPES,
  MAX_PAGES,
} from "./contracts.ts";
import { validatePaper } from "./lesson-view.ts";
import {
  mathFigureSampleCount,
  mathFigureSourceSize,
  MAX_LESSON_MATH_SAMPLES,
  MAX_LESSON_MATH_SOURCE_CHARS,
} from "../math/descriptor.ts";
export type DrawingBudget = {
  shapes: number;
  pathChars: number;
  points: number;
  expandedPoints: number;
  mathSamples?: number;
  mathSourceChars?: number;
};
/** Internal drawing contract. assetsValidated is only for the already checked shared pool. */
export function validateDrawing(
  value: { document: TLStoreSnapshot; pageId: string },
  options: {
    multiplePages?: boolean;
    assetsValidated?: boolean;
    budget?: DrawingBudget;
  } = {},
) {
  const doc = value.document;
  if (!object(doc) || !object(doc.store) || !object(doc.schema))
    throw new WorkspaceError("invalid", "The lesson has no drawing document.");
  const migration = sdkSchema.migrateStoreSnapshot(
    doc as unknown as TLStoreSnapshot,
  );
  if (migration.type !== "success")
    throw new WorkspaceError(
      "schema",
      "The drawing schema cannot be migrated safely.",
    );
  // The SDK returns the caller's store by identity when no migration is needed.
  // Normalize paper into a new map, including on later validation failure.
  migration.value = { ...migration.value };
  let pageCount = 0,
    documentCount = 0,
    userCount = 0;
  const pageIds = new Set(
      Object.values(migration.value)
        .filter((r) => r.typeName === "page")
        .map((r) => String(r.id)),
    ),
    indices = new Set<string>();
  const budget = options.budget ?? {
    shapes: 0,
    pathChars: 0,
    points: 0,
    expandedPoints: 0,
  };
  let assetBytes = 0,
    assetPixels = 0,
    assetCount = 0;
  const shapes: Record<string, Record<string, unknown>> = {};
  const inkBounds = new Map<string, LocalBounds>();
  for (const [id, record] of Object.entries(migration.value)) {
    if (id === "__proto__" || !object(record) || record.id !== id)
      throw new WorkspaceError("invalid", "Invalid drawing record identity.");
    try {
      const type =
        sdkSchema.types[record.typeName as keyof typeof sdkSchema.types];
      if (!type) throw new Error();
      type.validate(record);
    } catch {
      throw new WorkspaceError(
        "schema",
        "A drawing record does not match its SDK schema.",
      );
    }
    if (record.typeName === "page") {
      pageCount++;
      if (!options.multiplePages && id !== value.pageId)
        throw new WorkspaceError(
          "surface",
          "The drawing belongs to another page.",
        );
      if (indices.has(String(record.index)))
        throw new WorkspaceError("surface", "Duplicate page order index.");
      indices.add(String(record.index));
      const paper = validatePaper(
        (record.meta as Record<string, unknown>).paper,
      );
      migration.value[id as keyof typeof migration.value] = {
        ...record,
        meta: { ...record.meta, paper },
      } as never;
    } else if (record.typeName === "document") {
      documentCount++;
      if (id !== "document:document")
        throw new WorkspaceError(
          "invalid",
          "Invalid document record identity.",
        );
    } else if (record.typeName === "user") {
      userCount++;
      if (
        typeof record.name !== "string" ||
        record.name.length > 120 ||
        record.imageUrl !== "" ||
        userCount > 64
      )
        throw new WorkspaceError(
          "unsupported",
          "Linked profile images or excessive attribution records are unsupported by this ink-only version.",
        );
    } else if (record.typeName === "asset") {
      if (
        record.type !== "image" ||
        !object(record.props) ||
        typeof record.props.src !== "string"
      )
        throw new WorkspaceError(
          "unsupported",
          "Only local image assets are supported.",
        );
      if (options.assetsValidated) continue;
      const image = dataImage(record.props.src);
      assetBytes += image.bytes.length;
      assetPixels += image.width * image.height;
      assetCount++;
      if (
        assetBytes > MAX_TOTAL_IMAGE_BYTES ||
        assetPixels > MAX_TOTAL_IMAGE_PIXELS ||
        assetCount > MAX_IMAGE_ASSETS ||
        record.props.mimeType !== image.mime ||
        record.props.isAnimated !== false ||
        !(
          (record.props.w === image.width && record.props.h === image.height) ||
          (record.props.w === image.height && record.props.h === image.width)
        ) ||
        (record.props.fileSize !== undefined &&
          record.props.fileSize !== image.bytes.length)
      )
        throw new WorkspaceError(
          "limit",
          "Image asset dimensions/type/total exceed supported limits.",
        );
    } else if (record.typeName === "binding") {
      if (record.type !== "arrow")
        throw new WorkspaceError("unsupported", "Unsupported binding type.");
      const anchor = record.props.normalizedAnchor;
      if (
        ![anchor.x, anchor.y].every(
          (n) => Number.isFinite(n) && n >= -0.1 && n <= 1.1,
        )
      )
        throw new WorkspaceError(
          "bounds",
          "Arrow binding anchor exceeds supported bounds.",
        );
    } else if (record.typeName === "shape") {
      budget.shapes++;
      shapes[id] = record;
      if (
        ![
          "draw",
          "highlight",
          "geo",
          "line",
          "arrow",
          "text",
          "image",
          "group",
          "equation",
          "word-block",
          "math-figure",
        ].includes(String(record.type))
      )
        throw new WorkspaceError(
          "unsupported",
          "This version cannot open that object type.",
        );
      if (
        ![record.x, record.y, record.rotation].every(
          (n) => typeof n === "number" && Number.isFinite(n),
        ) ||
        Math.abs(Number(record.x)) > MAX_WORLD_COORDINATE ||
        Math.abs(Number(record.y)) > MAX_WORLD_COORDINATE
      )
        throw new WorkspaceError("invalid", "Invalid drawing coordinates.");
      if (!object(record.props))
        throw new WorkspaceError("invalid", "Invalid object properties.");
      const props = record.props as Record<string, unknown>;
      if (record.type === "math-figure") {
        // A graph's mathematical coordinates and literals are independent of
        // its board geometry. The descriptor validator already checked them.
        finiteBox({ w: record.props.w, h: record.props.h });
        if (record.props.w < 1 || record.props.h < 1)
          throw new WorkspaceError("bounds", "Invalid math figure dimensions.");
        budget.mathSamples =
          (budget.mathSamples ?? 0) +
          mathFigureSampleCount(record.props.figure);
        if (budget.mathSamples > MAX_LESSON_MATH_SAMPLES)
          throw new WorkspaceError(
            "limit",
            "Math graphs exceed the shared lesson sample limit.",
          );
        budget.mathSourceChars =
          (budget.mathSourceChars ?? 0) +
          mathFigureSourceSize(record.props.figure);
        if (budget.mathSourceChars > MAX_LESSON_MATH_SOURCE_CHARS)
          throw new WorkspaceError(
            "limit",
            "Math figures exceed the shared lesson source size limit.",
          );
      } else finiteBox(props);
      if (
        record.type === "word-block" &&
        (Number(props.w) < 1 ||
          Number(props.h) < 1 ||
          typeof props.documentId !== "string" ||
          props.documentId.length > 160 ||
          typeof props.blockId !== "string" ||
          props.blockId.length > 160 ||
          !pageIds.has(String(record.parentId)) ||
          record.rotation !== 0 ||
          record.isLocked !== true)
      )
        throw new WorkspaceError(
          "invalid",
          "Invalid structured Word block reference or layout.",
        );
      if (typeof props.url === "string" && props.url !== "")
        throw new WorkspaceError(
          "unsupported",
          "Linked object URLs are unsupported.",
        );
      if (props.richText !== undefined) validateRichText(props.richText);
      if (
        record.type === "equation" &&
        (typeof props.source !== "string" ||
          props.source.length > 4000 ||
          Number(props.fontSize) < 8 ||
          Number(props.fontSize) > 128 ||
          typeof props.color !== "string" ||
          !/^#[0-9a-f]{6}$/i.test(props.color) ||
          Number(props.w) < 1 ||
          Number(props.h) < 1)
      )
        throw new WorkspaceError(
          "invalid",
          "Invalid equation source or dimensions.",
        );
      if (record.type === "line") {
        if (!object(props.points) || Object.keys(props.points).length > 1024)
          throw new WorkspaceError("limit", "Line point limit exceeded.");
        for (const point of Object.values(props.points))
          if (
            !object(point) ||
            ![point.x, point.y].every(
              (n) =>
                typeof n === "number" &&
                Number.isFinite(n) &&
                Math.abs(n) <= MAX_WORLD_COORDINATE,
            )
          )
            throw new WorkspaceError("bounds", "Invalid line coordinates.");
      }
      if (record.type === "arrow")
        for (const key of ["start", "end"]) {
          const p = props[key];
          if (
            !object(p) ||
            ![p.x, p.y].every(
              (n) =>
                typeof n === "number" &&
                Number.isFinite(n) &&
                Math.abs(n) <= MAX_WORLD_COORDINATE,
            )
          )
            throw new WorkspaceError("bounds", "Invalid arrow coordinates.");
        }
      if (record.type === "image") {
        const asset =
          migration.value[props.assetId as keyof typeof migration.value];
        if (
          !asset ||
          asset.typeName !== "asset" ||
          asset.type !== "image" ||
          props.playing !== false
        )
          throw new WorkspaceError(
            "invalid",
            "Image must reference a local source asset.",
          );
        if (props.crop !== null) {
          const crop = props.crop as {
            topLeft: { x: number; y: number };
            bottomRight: { x: number; y: number };
          };
          if (
            ![
              crop.topLeft.x,
              crop.topLeft.y,
              crop.bottomRight.x,
              crop.bottomRight.y,
            ].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) ||
            crop.topLeft.x >= crop.bottomRight.x ||
            crop.topLeft.y >= crop.bottomRight.y
          )
            throw new WorkspaceError(
              "bounds",
              "Image crop exceeds supported bounds.",
            );
        }
      }
      if (record.type !== "draw" && record.type !== "highlight") {
        if (
          props.scale !== undefined &&
          (typeof props.scale !== "number" ||
            !Number.isFinite(props.scale) ||
            props.scale <= 0 ||
            props.scale > 100)
        )
          throw new WorkspaceError("bounds", "Invalid object scale.");
        continue;
      }
      if (
        !object(record.props) ||
        record.props.isComplete !== true ||
        !Array.isArray(record.props.segments)
      )
        throw new WorkspaceError(
          "invalid",
          "The lesson contains an incomplete stroke.",
        );
      if (!record.props.segments.length)
        throw new WorkspaceError(
          "invalid",
          "The lesson contains an empty stroke.",
        );
      const localBox: LocalBounds = {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
      };
      inkBounds.set(id, localBox);
      for (const segment of record.props.segments) {
        if (
          !object(segment) ||
          typeof segment.path !== "string" ||
          segment.path.length > 2_000_000 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(segment.path)
        )
          throw new WorkspaceError("invalid", "Invalid encoded stroke path.");
        budget.pathChars += segment.path.length;
        if (budget.pathChars > 64_000_000)
          throw new WorkspaceError(
            "limit",
            "Stroke paths exceed the editor limit.",
          );
        try {
          const points = b64Vecs.decodePoints(
            segment.path,
            segment.dim as 2 | 3 | undefined,
          );
          budget.points += points.length;
          if (segment.type === "straight" && points.length >= 2) {
            const distance = Math.hypot(
              (points[1].x - points[0].x) * Number(record.props.scaleX),
              (points[1].y - points[0].y) * Number(record.props.scaleY),
            );
            budget.expandedPoints +=
              distance === 0 ? 1 : Math.max(4, Math.floor(distance / 16)) + 2;
          } else budget.expandedPoints += points.length;
          if (
            !points.length ||
            budget.points > 4_000_000 ||
            budget.expandedPoints > 4_000_000 ||
            points.some((p) => ![p.x, p.y, p.z ?? 0.5].every(Number.isFinite))
          )
            throw new Error();
          const cos = Math.cos(Number(record.rotation)),
            sin = Math.sin(Number(record.rotation));
          for (const point of points) {
            const pressure = point.z ?? 0.5;
            // SDK scale changes width, while scaleX/Y change centerline points.
            const x = point.x * Number(record.props.scaleX),
              y = point.y * Number(record.props.scaleY);
            localBox.minX = Math.min(localBox.minX, x);
            localBox.maxX = Math.max(localBox.maxX, x);
            localBox.minY = Math.min(localBox.minY, y);
            localBox.maxY = Math.max(localBox.maxY, y);
            const wx = Number(record.x) + cos * x - sin * y,
              wy = Number(record.y) + sin * x + cos * y;
            if (
              // SDK 5.6 multiplies browser [0,1] pressure by 1.25, then
              // accumulates Float16 deltas. Preserve its scaled/quantized
              // canonical bytes while bounding amplification with tolerance.
              pressure < -0.05 ||
              pressure > 1.3 ||
              Math.abs(point.x) > MAX_WORLD_COORDINATE ||
              Math.abs(point.y) > MAX_WORLD_COORDINATE ||
              ![wx, wy].every(
                (n) =>
                  Number.isFinite(n) && Math.abs(n) <= MAX_WORLD_COORDINATE,
              )
            )
              throw new WorkspaceError(
                "bounds",
                "Stroke coordinates or pressure exceed supported bounds.",
              );
          }
        } catch {
          throw new WorkspaceError(
            "invalid",
            "Stroke coordinates or pressure are invalid or exceed supported bounds/point limits.",
          );
        }
      }
      for (const key of ["scale", "scaleX", "scaleY"])
        if (
          typeof record.props[key] !== "number" ||
          !Number.isFinite(record.props[key]) ||
          (key === "scale"
            ? Number(record.props[key]) <= 0
            : Number(record.props[key]) === 0) ||
          Math.abs(Number(record.props[key])) > 100
        )
          throw new WorkspaceError("invalid", "Invalid stroke scale.");
    } else
      throw new WorkspaceError(
        "unsupported",
        "The lesson contains content unsupported by this ink-only version.",
      );
  }
  // Parent IDs are authoring ownership, not arbitrary foreign references. Native
  // groups may nest, but cycles/deep graphs must fail before editor restoration.
  for (const shape of Object.values(shapes)) {
    const seen = new Set<string>([String(shape.id)]);
    let parent = shape.parentId;
    while (!pageIds.has(String(parent))) {
      if (
        typeof parent !== "string" ||
        seen.has(parent) ||
        seen.size > 32 ||
        shapes[parent]?.type !== "group"
      )
        throw new WorkspaceError(
          "ownership",
          "Invalid parent/group ownership or cycle.",
        );
      seen.add(parent);
      parent = shapes[parent].parentId;
    }
  }
  const root = (id: string): string => {
    let s = shapes[id];
    while (!pageIds.has(String(s.parentId))) s = shapes[String(s.parentId)];
    return String(s.parentId);
  };
  const terminals = new Set<string>(),
    dependencies = new Map<string, string[]>();
  for (const s of Object.values(shapes))
    if (!pageIds.has(String(s.parentId))) {
      const parent = String(s.parentId);
      dependencies.set(parent, [
        ...(dependencies.get(parent) ?? []),
        String(s.id),
      ]);
    }
  for (const record of Object.values(migration.value))
    if (record.typeName === "binding") {
      if (
        shapes[record.fromId]?.type !== "arrow" ||
        !shapes[record.toId] ||
        ["arrow", "group"].includes(String(shapes[record.toId]?.type)) ||
        record.fromId === record.toId ||
        (shapes[record.fromId] &&
          shapes[record.toId] &&
          root(record.fromId) !== root(record.toId))
      )
        throw new WorkspaceError(
          "ownership",
          "Arrow binding references a missing or unsupported target object.",
        );
      const key = record.fromId + ":" + record.props.terminal;
      if (terminals.has(key))
        throw new WorkspaceError(
          "ownership",
          "Duplicate arrow terminal binding.",
        );
      terminals.add(key);
      dependencies.set(record.fromId, [
        ...(dependencies.get(record.fromId) ?? []),
        record.toId,
      ]);
    }
  const depths = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    if (stack.has(id) || stack.size > 32)
      throw new WorkspaceError(
        "ownership",
        "Cyclic or excessive derived binding geometry.",
      );
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    stack.add(id);
    let depth = 1;
    for (const to of dependencies.get(id) ?? [])
      depth = Math.max(depth, 1 + visit(to, stack));
    stack.delete(id);
    if (depth > 33)
      throw new WorkspaceError(
        "ownership",
        "Excessive derived binding geometry depth.",
      );
    depths.set(id, depth);
    return depth;
  };
  for (const id of dependencies.keys()) visit(id, new Set());
  validateWorldBounds(shapes, pageIds, inkBounds, MAX_WORLD_COORDINATE);
  if (
    pageCount < 1 ||
    pageCount > (options.multiplePages ? MAX_PAGES : 1) ||
    !pageIds.has(value.pageId) ||
    documentCount !== 1 ||
    budget.shapes > MAX_SHAPES ||
    budget.pathChars > 64_000_000
  )
    throw new WorkspaceError(
      "limit",
      "The lesson exceeds this editor’s page, stroke or path limits.",
    );
  return {
    document: { store: migration.value, schema: sdkSchema.serialize() },
    pageIds,
  };
}
