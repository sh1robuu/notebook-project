import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import { storedMime } from "../media/image.ts";
import type {
  CaptureGrant,
  CaptureSessionView,
  ClassroomCapture,
  ClassroomHelp,
  ClassroomInsertion,
  ClassroomMedia,
  ClassroomProduct,
  ClassroomTask,
  ParticipationTarget,
  ParticipationView,
  ProductFeedback,
  TaskTimer,
  TeacherParticipation,
} from "../../src/modules/classroom/participation-types.ts";
import type { ParticipationActor } from "./participation-auth.ts";
import { expiredSession, missingRoom, roomRow } from "./store.ts";

export type TaskRow = {
  id: string;
  revision: number;
  title: string;
  instructions: string;
  focus_question: string;
  allowed_types: ClassroomTask["allowedTypes"];
  submission_open: boolean;
  timer_state: TaskTimer["state"];
  duration_seconds: number;
  remaining_ms: number;
  ends_at: Date | null;
  published_at: Date;
  updated_at: Date;
};
export type GrantRow = {
  id: string;
  room_id: string;
  lesson_id: string;
  surface: ParticipationTarget["surface"];
  page_id: string;
  expires_at: Date;
  revoked_at: Date | null;
};
type MediaRow = {
  id: string;
  image_bytes: number;
  width: number;
  height: number;
};
type ProductRow = {
  id: string;
  participant_id: string;
  group_id: string | null;
  display_name: string;
  group_name: string | null;
  task_id: string;
  task_revision: number;
  kind: ClassroomProduct["kind"];
  caption: string;
  link: string | null;
  accepted_at: Date;
  published: boolean;
  removed_at: Date | null;
  audience: string[];
};
type HelpRow = {
  id: string;
  participant_id: string;
  display_name: string;
  group_id: string | null;
  task_id: string | null;
  product_id: string | null;
  explanation: string;
  state: ClassroomHelp["state"];
  created_at: Date;
  updated_at: Date;
};

export async function dbNow(db: PoolClient) {
  const {
    rows: [row],
  } = await db.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  return row.now;
}
export function timerAt(row: TaskRow, now: Date): TaskTimer {
  const remainingMs = row.ends_at
    ? Math.max(0, row.ends_at.getTime() - now.getTime())
    : row.remaining_ms;
  return {
    state:
      row.timer_state === "running" && !remainingMs ? "ended" : row.timer_state,
    durationSeconds: row.duration_seconds,
    remainingMs,
    endsAt: row.ends_at?.toISOString() ?? null,
  };
}
function taskView(
  row: TaskRow & { group_ids: string[] },
  now: Date,
): ClassroomTask {
  return {
    id: row.id,
    revision: row.revision,
    title: row.title,
    instructions: row.instructions,
    focusQuestion: row.focus_question,
    groupIds: row.group_ids,
    allowedTypes: row.allowed_types,
    submissionOpen: row.submission_open,
    timer: timerAt(row, now),
    publishedAt: row.published_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
export function targetView(
  row: Pick<GrantRow, "lesson_id" | "surface" | "page_id">,
): ParticipationTarget {
  return { lessonId: row.lesson_id, surface: row.surface, pageId: row.page_id };
}
export function captureCode(secret: string, id: string) {
  return createHmac("sha256", secret)
    .update("lessonboard:capture:v1:" + id)
    .digest("base64url");
}
function grantView(row: GrantRow, secret: string): CaptureGrant {
  return {
    id: row.id,
    code: captureCode(secret, row.id),
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    target: targetView(row),
  };
}
export async function captureSessionView(
  db: PoolClient,
  actor: ParticipationActor,
): Promise<CaptureSessionView> {
  const {
    rows: [row],
  } = await db.query<GrantRow>(
    `SELECT id,room_id,lesson_id,surface,page_id,expires_at,revoked_at FROM public.classroom_capture_grants
       WHERE room_id=$1 AND id=$2 AND revoked_at IS NULL AND expires_at>statement_timestamp()`,
    [actor.roomId, actor.grantId],
  );
  if (!row) return expiredSession();
  return {
    grantId: row.id,
    expiresAt: row.expires_at.toISOString(),
    target: targetView(row),
  };
}

function mediaView(row: MediaRow, actor: ParticipationActor): ClassroomMedia {
  const path =
    actor.kind === "teacher" ? "/rooms/" + actor.roomId : "/" + actor.kind;
  const url = "/api/classroom" + path + "/media/" + row.id;
  return {
    id: row.id,
    mime: storedMime,
    bytes: row.image_bytes,
    width: row.width,
    height: row.height,
    url,
    thumbnailUrl: url + "?variant=thumbnail",
  };
}
function productView(
  row: ProductRow,
  media: ClassroomMedia[],
  feedback: ProductFeedback[],
): ClassroomProduct {
  return {
    id: row.id,
    participantId: row.participant_id,
    groupId: row.group_id,
    displayName: row.display_name,
    groupName: row.group_name,
    taskId: row.task_id,
    taskRevision: row.task_revision,
    kind: row.kind,
    caption: row.caption,
    link: row.link,
    media,
    acceptedAt: row.accepted_at.toISOString(),
    published: row.published,
    removedAt: row.removed_at?.toISOString() ?? null,
    feedback,
  };
}
function appendMap<T>(map: Map<string, T[]>, key: string, value: T) {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}
async function products(db: PoolClient, actor: ParticipationActor) {
  const { roomId } = actor;
  const { rows } = await db.query<ProductRow>(
    `SELECT id,participant_id,group_id,display_name,group_name,task_id,task_revision,kind,caption,link,
      accepted_at,published,removed_at,audience FROM public.classroom_products
      WHERE room_id=$1 ORDER BY accepted_at DESC,id LIMIT 600`,
    [roomId],
  );
  if (!rows.length) return { products: [], gallery: [] };
  const ids = rows.map((row) => row.id);
  const images = await db.query<MediaRow & { product_id: string }>(
    `SELECT m.id,m.image_bytes,m.width,m.height,j.product_id
       FROM public.classroom_product_media j JOIN public.classroom_media m ON m.room_id=j.room_id AND m.id=j.media_id
       JOIN public.classroom_products p ON p.room_id=j.room_id AND p.id=j.product_id
       WHERE j.room_id=$1 AND j.product_id=ANY($2::uuid[]) AND p.removed_at IS NULL
        AND m.state='finalized' AND m.attached_at IS NOT NULL ORDER BY j.position`,
    [roomId, ids],
  );
  const comments = await db.query<{
    id: string;
    product_id: string;
    text: string;
    created_at: Date;
  }>(
    `SELECT id,product_id,text,created_at FROM public.classroom_product_feedback
       WHERE room_id=$1 AND product_id=ANY($2::uuid[]) ORDER BY created_at,id`,
    [roomId, ids],
  );
  const media = new Map<string, ClassroomMedia[]>(),
    feedback = new Map<string, ProductFeedback[]>();
  for (const row of images.rows)
    appendMap(media, row.product_id, mediaView(row, actor));
  for (const row of comments.rows)
    appendMap(feedback, row.product_id, {
      id: row.id,
      productId: row.product_id,
      text: row.text,
      createdAt: row.created_at.toISOString(),
    });
  const visible = rows.filter(
    (row) => actor.kind === "teacher" || row.audience.includes(actor.id),
  );
  return {
    products: visible.map((row) =>
      productView(row, media.get(row.id) ?? [], feedback.get(row.id) ?? []),
    ),
    gallery: rows
      .filter((row) => row.published && !row.removed_at)
      .map((row) => productView(row, media.get(row.id) ?? [], [])),
  };
}
async function help(db: PoolClient, roomId: string): Promise<ClassroomHelp[]> {
  const { rows } = await db.query<HelpRow>(
    `SELECT id,participant_id,display_name,group_id,task_id,product_id,explanation,state,created_at,updated_at
       FROM public.classroom_help_requests WHERE room_id=$1 ORDER BY created_at DESC,id LIMIT 300`,
    [roomId],
  );
  return rows.map((row) => ({
    id: row.id,
    participantId: row.participant_id,
    displayName: row.display_name,
    groupId: row.group_id,
    taskId: row.task_id,
    productId: row.product_id,
    explanation: row.explanation,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

type TaskProjection = TaskRow & {
  group_ids: string[];
  reference_answer: string | null;
  private_notes: string | null;
};
export async function participationView(
  db: PoolClient,
  actor: ParticipationActor,
): Promise<ParticipationView> {
  const room = await roomRow(db, actor.roomId);
  if (!room) return missingRoom();
  const now = await dbNow(db);
  const { rows } = await db.query<TaskProjection>(
    `SELECT t.*,coalesce((SELECT array_agg(g.group_id ORDER BY g.group_id)
       FROM public.classroom_task_groups g WHERE g.room_id=t.room_id AND g.task_id=t.id),ARRAY[]::uuid[]) group_ids,
       s.reference_answer,s.private_notes
       FROM public.classroom_tasks t LEFT JOIN public.classroom_task_private s ON s.room_id=t.room_id AND s.task_id=t.id
       WHERE t.room_id=$1 ORDER BY t.published_at DESC,t.id LIMIT 100`,
    [actor.roomId],
  );
  const activity = await products(db, actor);
  return {
    roomId: room.id,
    revision: room.revision,
    serverTime: now.toISOString(),
    tasks: rows.map((row) => {
      const task = taskView(row, now);
      return actor.kind === "teacher"
        ? {
            ...task,
            referenceAnswer: row.reference_answer ?? "",
            privateNotes: row.private_notes ?? "",
          }
        : task;
    }),
    ...activity,
    help: await help(db, actor.roomId),
  };
}
export async function teacherParticipationView(
  db: PoolClient,
  actor: ParticipationActor,
  secret: string,
): Promise<TeacherParticipation> {
  const view = await participationView(db, actor);
  const {
    rows: [grant],
  } = await db.query<GrantRow>(
    `SELECT id,room_id,lesson_id,surface,page_id,expires_at,revoked_at FROM public.classroom_capture_grants
       WHERE room_id=$1 AND revoked_at IS NULL AND expires_at>statement_timestamp()`,
    [actor.roomId],
  );
  const { rows: captureRows } = await db.query<
    GrantRow &
      MediaRow & {
        capture_id: string;
        grant_id: string;
        accepted_at: Date;
        insertion_id: string | null;
      }
  >(
    `SELECT c.id capture_id,c.grant_id,c.accepted_at,g.lesson_id,g.surface,g.page_id,
       m.id,m.image_bytes,m.width,m.height,i.id insertion_id
       FROM public.classroom_captures c JOIN public.classroom_capture_grants g ON g.room_id=c.room_id AND g.id=c.grant_id
       JOIN public.classroom_media m ON m.room_id=c.room_id AND m.id=c.media_id
       LEFT JOIN public.classroom_board_insertions i ON i.room_id=c.room_id AND i.capture_id=c.id
       WHERE c.room_id=$1 AND m.state='finalized' AND m.attached_at IS NOT NULL ORDER BY c.accepted_at DESC,c.id LIMIT 100`,
    [actor.roomId],
  );
  const captures: ClassroomCapture[] = captureRows.map((row) => ({
    id: row.capture_id,
    grantId: row.grant_id,
    media: mediaView(row, actor),
    target: targetView(row),
    acceptedAt: row.accepted_at.toISOString(),
    insertionId: row.insertion_id,
  }));
  const { rows: insertionRows } = await db.query<
    Pick<GrantRow, "lesson_id" | "surface" | "page_id"> & {
      id: string;
      product_id: string | null;
      capture_id: string | null;
      media_id: string;
      created_at: Date;
      saved_at: Date | null;
      local_revision: number | null;
    }
  >(
    `SELECT id,product_id,capture_id,media_id,lesson_id,surface,page_id,created_at,saved_at,local_revision
       FROM public.classroom_board_insertions WHERE room_id=$1 ORDER BY created_at DESC,id LIMIT 300`,
    [actor.roomId],
  );
  const insertions: ClassroomInsertion[] = insertionRows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    captureId: row.capture_id,
    mediaId: row.media_id,
    target: targetView(row),
    state: row.saved_at ? "saved" : "requested",
    createdAt: row.created_at.toISOString(),
    savedAt: row.saved_at?.toISOString() ?? null,
    localRevision: row.local_revision,
  }));
  return {
    ...view,
    tasks: view.tasks as TeacherParticipation["tasks"],
    captures,
    insertions,
    captureGrant: grant ? grantView(grant, secret) : null,
  };
}
