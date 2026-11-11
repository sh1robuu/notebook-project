import { object, WorkspaceError, MAX_WORLD_COORDINATE } from "./contracts.ts";
export type SurfaceId = "main" | "scratchpad";
export type Camera = { x: number; y: number; z: number };
export type Paper = {
  kind: "blank" | "pdf" | "pptx";
  color: "white" | "dark" | "green";
  width: number;
  height: number;
  pattern?: "ruled" | "grid" | "dotted";
  titleGuide?: boolean;
  sourceId?: string;
  pageIndex?: number;
  slideId?: string;
};
export type LessonView = {
  mainCameras: Record<string, Camera>;
  scratchCamera: Camera;
  layout: { open: boolean; dock: "right" | "bottom"; ratio: number };
  hidden: { pages: boolean; scratch: boolean };
};
export const defaultPaper = (): Paper => ({
  kind: "blank",
  color: "white",
  width: 1280,
  height: 960,
});
export const defaultNotebookPaper = (
  color: Paper["color"] = "white",
): Paper => ({
  ...defaultPaper(),
  color,
  ...(color === "white" ? { pattern: "ruled", titleGuide: true } : {}),
});
export const defaultView = (): LessonView => ({
  mainCameras: {},
  scratchCamera: { x: 0, y: 0, z: 1 },
  layout: { open: false, dock: "right", ratio: 0.35 },
  hidden: { pages: false, scratch: false },
});
export function validatePaper(value: unknown): Paper {
  if (value === undefined) return defaultPaper();
  if (
    !object(value) ||
    !["blank", "pdf", "pptx"].includes(String(value.kind)) ||
    !["white", "dark", "green"].includes(String(value.color)) ||
    ![value.width, value.height].every(
      (n) =>
        typeof n === "number" &&
        Number.isFinite(n) &&
        n >= (value.kind === "blank" ? 64 : 1) &&
        n <= 100_000,
    ) ||
    (value.kind === "blank" &&
      ((value.pattern !== undefined &&
        value.pattern !== "ruled" &&
        value.pattern !== "grid" &&
        value.pattern !== "dotted") ||
        (value.titleGuide !== undefined &&
          typeof value.titleGuide !== "boolean")))
  )
    throw new WorkspaceError(
      "paper",
      "Unsupported paper or unsafe page dimensions. Keep the original lesson.",
    );
  if (
    value.kind === "pdf" &&
    (typeof value.sourceId !== "string" ||
      !/^pdf:[a-f0-9]{64}$/.test(value.sourceId) ||
      !Number.isSafeInteger(value.pageIndex) ||
      Number(value.pageIndex) < 0 ||
      Number(value.pageIndex) >= 200 ||
      value.color !== "white")
  )
    throw new WorkspaceError("paper", "Invalid PDF background mapping.");
  if (
    value.kind === "pptx" &&
    (typeof value.sourceId !== "string" ||
      !/^pptx:[a-f0-9]{64}$/.test(value.sourceId) ||
      typeof value.slideId !== "string" ||
      !/^slide:\d{1,10}$/.test(value.slideId) ||
      value.color !== "white")
  )
    throw new WorkspaceError("paper", "Invalid PowerPoint slide mapping.");
  return {
    kind: value.kind as Paper["kind"],
    color: value.color as Paper["color"],
    width: Number(value.width),
    height: Number(value.height),
    ...(value.kind === "blank" && value.pattern !== undefined
      ? { pattern: value.pattern as Paper["pattern"] }
      : {}),
    ...(value.kind === "blank" &&
    value.pattern === "ruled" &&
    value.titleGuide === true
      ? { titleGuide: true }
      : {}),
    ...(value.kind === "pdf"
      ? {
          sourceId: value.sourceId as string,
          pageIndex: Number(value.pageIndex),
        }
      : {}),
    ...(value.kind === "pptx"
      ? { sourceId: value.sourceId as string, slideId: value.slideId as string }
      : {}),
  };
}
export function validateCamera(value: unknown): Camera {
  if (
    !object(value) ||
    ![value.x, value.y].every(
      (n) =>
        typeof n === "number" &&
        Number.isFinite(n) &&
        Math.abs(n) <= MAX_WORLD_COORDINATE,
    ) ||
    typeof value.z !== "number" ||
    !Number.isFinite(value.z) ||
    value.z < 0.25 ||
    value.z > 4
  )
    throw new WorkspaceError("view", "Invalid camera coordinates or zoom.");
  return { x: Number(value.x), y: Number(value.y), z: value.z };
}
export function validateView(value: unknown, pages: Set<string>): LessonView {
  if (
    !object(value) ||
    !object(value.mainCameras) ||
    !object(value.layout) ||
    !object(value.hidden)
  )
    throw new WorkspaceError("view", "Invalid lesson view preferences.");
  const cameras: Record<string, Camera> = {};
  for (const [id, camera] of Object.entries(value.mainCameras)) {
    if (!pages.has(id))
      throw new WorkspaceError(
        "view",
        "A saved camera belongs to an absent page.",
      );
    cameras[id] = validateCamera(camera);
  }
  const layout = value.layout,
    hidden = value.hidden;
  if (
    typeof layout.open !== "boolean" ||
    !["right", "bottom"].includes(String(layout.dock)) ||
    typeof layout.ratio !== "number" ||
    !Number.isFinite(layout.ratio) ||
    layout.ratio < 0.2 ||
    layout.ratio > 0.65 ||
    typeof hidden.pages !== "boolean" ||
    typeof hidden.scratch !== "boolean"
  )
    throw new WorkspaceError(
      "view",
      "Invalid split layout or control preferences.",
    );
  return {
    mainCameras: cameras,
    scratchCamera: validateCamera(value.scratchCamera),
    layout: {
      open: layout.open,
      dock: layout.dock as "right" | "bottom",
      ratio: layout.ratio,
    },
    hidden: { pages: hidden.pages, scratch: hidden.scratch },
  };
}
