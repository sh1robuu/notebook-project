import { createShapeId, toRichText } from "tldraw";
import type { TLImageAsset } from "tldraw";
import type { BoardEngine } from "../board/engine.ts";
import type { LessonSession } from "../board/lesson-session.ts";
import { canCreateShapes } from "../board/capacity.ts";
import { checkAssetBudget } from "../media/asset-budget.ts";
import { prepareImage } from "../media/images.ts";
import { beginOperation } from "../workspace/activity.ts";
import type { BoardInsertionTarget } from "../workspace/database.ts";
import { sameInsertionTarget } from "./participation-types.ts";

type Insertion = { insertionId: string; expected: BoardInsertionTarget };
type Result = { insertionId: string; revision: number; duplicate: boolean };
const pending = new WeakMap<LessonSession, Set<string>>();

export function insertionTarget(engine: BoardEngine): BoardInsertionTarget {
  return {
    lessonId: engine.session.workspace.lesson.id,
    surface: engine.surface,
    pageId: engine.currentPageId(),
  };
}

export function insertCallerResult(
  engine: BoardEngine,
  value: Insertion & { names: readonly string[] },
) {
  if (
    value.names.length < 1 ||
    value.names.length > 4 ||
    value.names.some((name) => !name.trim() || name.length > 120)
  )
    return Promise.reject(new Error("Danh sách tên chưa hợp lệ."));
  return insert(engine, value, async () => ({ text: value.names.join("\n") }));
}

export function insertClassroomSnapshot(
  engine: BoardEngine,
  value: Insertion & { file: File },
) {
  return insert(engine, value, async () => ({
    asset: await prepareImage(value.file),
  }));
}

async function insert(
  engine: BoardEngine,
  { insertionId, expected }: Insertion,
  prepare: () => Promise<{ text: string } | { asset: TLImageAsset }>,
): Promise<Result> {
  if (!/^[a-f\d-]{36}$/i.test(insertionId))
    throw new Error("Mã chèn chưa hợp lệ.");
  const session = engine.session;
  const editor = engine.pages.editor;
  const verifyTarget = () => {
    if (
      session.engines.get(engine.surface) !== engine ||
      !sameInsertionTarget(insertionTarget(engine), expected) ||
      engine.isPointing() ||
      editor.getIsReadonly() ||
      engine.editing.state.isTextEditing
    )
      throw new Error(
        "Mở đúng trang bảng giảng và hoàn tất thao tác đang dùng trước khi chèn.",
      );
  };
  verifyTarget();
  let active = pending.get(session);
  if (!active) pending.set(session, (active = new Set()));
  if (active.has(insertionId)) throw new Error("Nội dung này đang được chèn.");
  const finish = beginOperation("Chèn nội dung lớp học");
  active.add(insertionId);
  try {
    const receipt = await session.workspace.boardInsertion(insertionId);
    verifyTarget();
    if (receipt) {
      if (!sameInsertionTarget(receipt, expected))
        throw new Error("Nội dung đã được chèn vào một trang khác.");
      return { insertionId, revision: receipt.revision, duplicate: true };
    }
    const shapeId = createShapeId("classroom-" + insertionId);
    const existing = editor.getShape(shapeId);
    if (
      existing &&
      (existing.meta.classroomInsertion !== insertionId ||
        editor.getAncestorPageId(existing) !== editor.getCurrentPageId())
    )
      throw new Error("Mã chèn trùng với một đối tượng đã có.");
    if (!existing) {
      const content = await prepare();
      verifyTarget();
      if (!canCreateShapes(editor, [shapeId]))
        throw new Error("Bài giảng đã đạt giới hạn đối tượng.");
      if ("asset" in content) checkAssetBudget(editor, [content.asset]);
      const center = editor.getViewportPageBounds().center;
      const inserted = engine.editing.command("Insert classroom work", () => {
        const meta = { classroomInsertion: insertionId };
        if ("asset" in content) {
          const asset = content.asset;
          if (!editor.getAsset(asset.id)) editor.createAssets([asset]);
          const scale = Math.min(1, 600 / asset.props.w, 480 / asset.props.h);
          const w = asset.props.w * scale,
            h = asset.props.h * scale;
          editor.createShape({
            id: shapeId,
            type: "image",
            meta,
            x: center.x - w / 2,
            y: center.y - h / 2,
            props: {
              assetId: asset.id,
              w,
              h,
              playing: false,
              altText: asset.props.name,
            },
          });
        } else {
          editor.createShape({
            id: shapeId,
            type: "text",
            meta,
            x: center.x - 120,
            y: center.y - 32,
            props: {
              richText: toRichText(content.text),
              font: "sans",
              w: 240,
              autoSize: false,
            },
          });
        }
        if (!editor.getShape(shapeId))
          throw new Error("Không chèn được vào bảng giảng.");
        editor.setCurrentTool("select");
        editor.select(shapeId);
      });
      if (!inserted) throw new Error("Không chèn được vào bảng giảng.");
    }
    const committed = await session.commitBoardInsertion({
      ...expected,
      id: insertionId,
      shapeId,
    });
    return { insertionId, revision: committed.revision, duplicate: !!existing };
  } finally {
    active.delete(insertionId);
    finish();
  }
}
