import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { digest, RoomError } from "./model.ts";
import type { RoomState } from "./model.ts";
import type {
  ParticipationTarget,
  StudentParticipationCommand,
  TaskInput,
  TeacherParticipationCommand,
} from "../../src/modules/classroom/participation-types.ts";
import { activeParticipant, expiredSession, missingRoom } from "./store.ts";
import type { ParticipationActor } from "./participation-auth.ts";
import {
  captureCode,
  captureSessionView,
  dbNow,
  timerAt,
} from "./participation-store.ts";
import type { TaskRow } from "./participation-store.ts";
import type { parseCaptureCommand } from "./participation-model.ts";

type Command =
  | TeacherParticipationCommand
  | StudentParticipationCommand
  | ReturnType<typeof parseCaptureCommand>;
type ReceiptRow = {
  request_hash: string;
  resource_id: string;
  revision: number;
  accepted_at: Date;
};
const maxProducts = 600;
const maxHelp = 300;
const captureLifetimeSeconds = 15 * 60;

function missingRecord(): never {
  throw new RoomError(
    404,
    "room_record_not_found",
    "This classroom record is unavailable.",
  );
}
function conflict(code: string, message: string): never {
  throw new RoomError(409, code, message);
}
function submissionAllowed(state: RoomState) {
  if (state !== "open" && state !== "locked")
    conflict("room_closed", "The room is not accepting classroom activity.");
}
function version(row: TaskRow, expected: number) {
  if (row.revision !== expected)
    conflict(
      "stale_task",
      "The task changed. Refresh and review the current instructions.",
    );
}
async function taskRow(
  db: PoolClient,
  roomId: string,
  taskId: string,
): Promise<TaskRow> {
  const {
    rows: [row],
  } = await db.query<TaskRow>(
    "SELECT * FROM public.classroom_tasks WHERE room_id=$1 AND id=$2",
    [roomId, taskId],
  );
  return row ?? missingRecord();
}
async function checkGroups(db: PoolClient, roomId: string, groupIds: string[]) {
  if (!groupIds.length) return;
  const result = await db.query(
    "SELECT id FROM public.classroom_groups WHERE room_id=$1 AND id=ANY($2::uuid[]) AND removed_at IS NULL",
    [roomId, groupIds],
  );
  if (result.rowCount !== groupIds.length) missingRecord();
}
async function setTaskDetails(
  db: PoolClient,
  roomId: string,
  taskId: string,
  input: TaskInput,
) {
  await db.query(
    "DELETE FROM public.classroom_task_groups WHERE room_id=$1 AND task_id=$2",
    [roomId, taskId],
  );
  if (input.groupIds.length)
    await db.query(
      `INSERT INTO public.classroom_task_groups(room_id,task_id,group_id)
       SELECT $1,$2,id FROM unnest($3::uuid[]) id`,
      [roomId, taskId, input.groupIds],
    );
  await db.query(
    `INSERT INTO public.classroom_task_private(room_id,task_id,reference_answer,private_notes)
       VALUES($1,$2,$3,$4) ON CONFLICT(room_id,task_id) DO UPDATE
       SET reference_answer=excluded.reference_answer,private_notes=excluded.private_notes`,
    [roomId, taskId, input.referenceAnswer, input.privateNotes],
  );
}
async function writeTask(
  db: PoolClient,
  roomId: string,
  command: Extract<
    TeacherParticipationCommand,
    { type: "publishTask" | "reviseTask" }
  >,
) {
  const { taskId } = command;
  await checkGroups(db, roomId, command.groupIds);
  const fields = [
    roomId,
    taskId,
    command.title,
    command.instructions,
    command.focusQuestion,
    !command.groupIds.length,
    command.allowedTypes,
    command.submissionOpen,
    command.durationSeconds,
  ];
  if (command.type === "publishTask") {
    const {
      rows: [limit],
    } = await db.query<{ allowed: boolean }>(
      "SELECT count(*) < 100 AS allowed FROM public.classroom_tasks WHERE room_id=$1",
      [roomId],
    );
    if (!limit.allowed)
      conflict("task_limit", "The room has reached its task limit.");
    const result = await db.query(
      `INSERT INTO public.classroom_tasks(room_id,id,title,instructions,focus_question,common,
       allowed_types,submission_open,duration_seconds,remaining_ms)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9*1000) ON CONFLICT(room_id,id) DO NOTHING`,
      fields,
    );
    if (!result.rowCount)
      conflict("task_exists", "This task has already been published.");
  } else {
    const row = await taskRow(db, roomId, taskId);
    version(row, command.expectedRevision);
    await db.query(
      `UPDATE public.classroom_tasks SET title=$3,instructions=$4,focus_question=$5,common=$6,
        allowed_types=$7,submission_open=$8,duration_seconds=$9,
        remaining_ms=CASE WHEN duration_seconds<>$9 THEN $9*1000 ELSE remaining_ms END,
        timer_state=CASE WHEN duration_seconds<>$9 THEN 'idle' ELSE timer_state END,
        ends_at=CASE WHEN duration_seconds<>$9 THEN NULL ELSE ends_at END,
        revision=revision+1,updated_at=statement_timestamp() WHERE room_id=$1 AND id=$2`,
      fields,
    );
  }
  await setTaskDetails(db, roomId, taskId, command);
  return taskId;
}
type TaskStateCommand = Extract<
  TeacherParticipationCommand,
  { taskId: string; expectedRevision: number }
> & {
  type:
    | "lockSubmissions"
    | "unlockSubmissions"
    | "startTimer"
    | "pauseTimer"
    | "resumeTimer"
    | "endTimer"
    | "resetTimer";
};
async function taskState(
  db: PoolClient,
  roomId: string,
  command: TaskStateCommand,
) {
  const { taskId, type } = command;
  const row = await taskRow(db, roomId, taskId);
  version(row, command.expectedRevision);
  if (type === "lockSubmissions" || type === "unlockSubmissions") {
    await db.query(
      `UPDATE public.classroom_tasks SET submission_open=$3,revision=revision+1,updated_at=statement_timestamp()
        WHERE room_id=$1 AND id=$2`,
      [roomId, taskId, type === "unlockSubmissions"],
    );
    return taskId;
  }
  const now = await dbNow(db);
  const timer = timerAt(row, now);
  let state = timer.state,
    remaining = timer.remainingMs,
    ends: Date | null = null;
  switch (type) {
    case "startTimer":
      if (
        timer.state === "running" ||
        timer.state === "paused" ||
        !timer.durationSeconds
      )
        conflict("invalid_timer", "Set a duration and start a stopped timer.");
      remaining = timer.durationSeconds * 1000;
      ends = new Date(now.getTime() + remaining);
      state = "running";
      break;
    case "pauseTimer":
      if (timer.state !== "running")
        conflict("invalid_timer", "The timer is not running.");
      state = "paused";
      break;
    case "resumeTimer":
      if (timer.state !== "paused" || !remaining)
        conflict("invalid_timer", "The timer is not paused.");
      ends = new Date(now.getTime() + remaining);
      state = "running";
      break;
    case "endTimer":
      remaining = 0;
      state = "ended";
      break;
    case "resetTimer":
      remaining = timer.durationSeconds * 1000;
      state = "idle";
      break;
  }
  await db.query(
    `UPDATE public.classroom_tasks SET timer_state=$3,remaining_ms=$4,ends_at=$5,revision=revision+1,
      updated_at=statement_timestamp() WHERE room_id=$1 AND id=$2`,
    [roomId, taskId, state, remaining, ends],
  );
  return taskId;
}
async function availableMedia(
  db: PoolClient,
  actor: ParticipationActor,
  ids: string[],
  purpose: "submission" | "capture",
) {
  if (!ids.length) return;
  const { rows } = await db.query<{ expected_bytes: number }>(
    `SELECT expected_bytes FROM public.classroom_media WHERE room_id=$1 AND id=ANY($2::uuid[])
       AND owner_kind=$3 AND owner_id=$4 AND purpose=$5 AND state='finalized'
       AND attached_at IS NULL AND expires_at > statement_timestamp()
       ORDER BY id FOR UPDATE`,
    [actor.roomId, ids, actor.kind, actor.id, purpose],
  );
  if (rows.length !== ids.length)
    conflict(
      "media_unavailable",
      "An image upload is incomplete, expired, or already attached.",
    );
  if (rows.reduce((sum, row) => sum + row.expected_bytes, 0) > 20_000_000)
    conflict(
      "submission_size",
      "The product exceeds the combined image limit.",
    );
}
async function markAttached(db: PoolClient, roomId: string, ids: string[]) {
  if (ids.length)
    await db.query(
      `UPDATE public.classroom_media SET attached_at=statement_timestamp(),updated_at=statement_timestamp()
       WHERE room_id=$1 AND id=ANY($2::uuid[])`,
      [roomId, ids],
    );
}
async function submitProduct(
  db: PoolClient,
  actor: ParticipationActor,
  command: Extract<StudentParticipationCommand, { type: "submitProduct" }>,
) {
  const { roomId } = actor;
  const task = await taskRow(db, roomId, command.taskId);
  version(task, command.taskRevision);
  if (!task.submission_open)
    conflict(
      "submissions_locked",
      "Submissions are locked. Keep your draft and try again when reopened.",
    );
  if (
    !task.allowed_types.includes(command.kind === "images" ? "image" : "link")
  )
    conflict(
      "submission_type",
      "This task does not accept that submission type.",
    );
  await availableMedia(db, actor, command.mediaIds, "submission");
  const member = await activeParticipant(db, roomId, actor.id);
  const {
    rows: [audience],
  } = await db.query<{ ids: string[]; allowed: boolean }>(
    "SELECT public.classroom_s10_audience($1,$2) AS ids, public.classroom_s10_limit($1,'products',$3) AS allowed",
    [roomId, member.group_id, maxProducts],
  );
  if (!audience.allowed)
    conflict("product_limit", "The room has reached its product limit.");
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.classroom_products(room_id,id,participant_id,group_id,group_name,display_name,
      task_id,task_revision,kind,caption,link,audience)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      roomId,
      id,
      actor.id,
      member.group_id,
      member.group_name,
      member.display_name,
      command.taskId,
      command.taskRevision,
      command.kind,
      command.caption,
      command.link,
      audience.ids,
    ],
  );
  if (command.mediaIds.length)
    await db.query(
      `INSERT INTO public.classroom_product_media(room_id,product_id,media_id,position)
       SELECT $1,$2,id,position::integer FROM unnest($3::uuid[]) WITH ORDINALITY AS i(id,position)`,
      [roomId, id, command.mediaIds],
    );
  await markAttached(db, roomId, command.mediaIds);
  return id;
}
async function activeProduct(db: PoolClient, roomId: string, id: string) {
  const {
    rows: [row],
  } = await db.query<{
    id: string;
    task_id: string;
    participant_id: string;
    audience: string[];
  }>(
    "SELECT id,task_id,participant_id,audience FROM public.classroom_products WHERE room_id=$1 AND id=$2 AND removed_at IS NULL",
    [roomId, id],
  );
  return row ?? missingRecord();
}
async function requestHelp(
  db: PoolClient,
  actor: ParticipationActor,
  command: Extract<StudentParticipationCommand, { type: "requestHelp" }>,
) {
  const { roomId } = actor;
  if (command.taskId) await taskRow(db, roomId, command.taskId);
  if (command.productId) {
    const product = await activeProduct(db, roomId, command.productId);
    if (
      !product.audience.includes(actor.id) ||
      (command.taskId && product.task_id !== command.taskId)
    )
      missingRecord();
  }
  const existing = await db.query(
    `SELECT 1 FROM public.classroom_help_requests WHERE room_id=$1 AND participant_id=$2
       AND state IN ('pending','acknowledged')`,
    [roomId, actor.id],
  );
  if (existing.rowCount)
    conflict("help_pending", "There is already a pending help request.");
  const member = await activeParticipant(db, roomId, actor.id);
  const {
    rows: [limit],
  } = await db.query<{ allowed: boolean }>(
    "SELECT public.classroom_s10_limit($1,'help',$2) AS allowed",
    [roomId, maxHelp],
  );
  if (!limit.allowed)
    conflict("help_limit", "The room has reached its help request limit.");
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.classroom_help_requests(room_id,id,participant_id,group_id,display_name,task_id,product_id,explanation)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      roomId,
      id,
      actor.id,
      member.group_id,
      member.display_name,
      command.taskId,
      command.productId,
      command.explanation,
    ],
  );
  return id;
}
async function moveHelp(
  db: PoolClient,
  roomId: string,
  id: string,
  from: string[],
  state: string,
) {
  const result = await db.query(
    `UPDATE public.classroom_help_requests SET state=$3,updated_at=statement_timestamp()
       WHERE room_id=$1 AND id=$2 AND state=ANY($4::text[])`,
    [roomId, id, state, from],
  );
  if (!result.rowCount) missingRecord();
  return id;
}
async function rotateCapture(
  db: PoolClient,
  roomId: string,
  target: ParticipationTarget,
  secret: string,
  replace: boolean,
) {
  const {
    rows: [limit],
  } = await db.query<{ allowed: boolean }>(
    "SELECT count(*)<100 AS allowed FROM public.classroom_capture_grants WHERE room_id=$1",
    [roomId],
  );
  if (!limit.allowed)
    conflict("capture_limit", "The room has reached its capture grant limit.");
  const {
    rows: [current],
  } = await db.query<{ id: string; active: boolean }>(
    `SELECT id,expires_at>statement_timestamp() AS active FROM public.classroom_capture_grants
       WHERE room_id=$1 AND revoked_at IS NULL`,
    [roomId],
  );
  if (current?.active && !replace)
    conflict("capture_active", "Rotate or revoke the active capture QR first.");
  if (current)
    await db.query(
      "UPDATE public.classroom_capture_grants SET revoked_at=statement_timestamp() WHERE room_id=$1 AND id=$2",
      [roomId, current.id],
    );
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.classroom_capture_grants(room_id,id,code_hash,lesson_id,surface,page_id,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,statement_timestamp()+$7*interval '1 second')`,
    [
      roomId,
      id,
      digest(captureCode(secret, id)),
      target.lessonId,
      target.surface,
      target.pageId,
      captureLifetimeSeconds,
    ],
  );
  return id;
}
async function acceptCapture(
  db: PoolClient,
  actor: ParticipationActor,
  mediaId: string,
) {
  await availableMedia(db, actor, [mediaId], "capture");
  const {
    rows: [limit],
  } = await db.query<{ allowed: boolean }>(
    "SELECT public.classroom_s10_limit($1,'captures',$2) AS allowed",
    [actor.roomId, 100],
  );
  if (!limit.allowed)
    conflict("capture_limit", "The room has reached its capture limit.");
  const id = randomUUID();
  await db.query(
    "INSERT INTO public.classroom_captures(room_id,id,grant_id,session_id,media_id) VALUES($1,$2,$3,$4,$5)",
    [actor.roomId, id, actor.grantId, actor.id, mediaId],
  );
  await markAttached(db, actor.roomId, [mediaId]);
  return id;
}
async function prepareInsertion(
  db: PoolClient,
  roomId: string,
  command: Extract<TeacherParticipationCommand, { type: "prepareInsertion" }>,
) {
  const { productId, captureId, mediaId, target } = command;
  const {
    rows: [source],
  } = await db.query<{ valid: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM public.classroom_media m WHERE m.room_id=$1 AND m.id=$4
       AND m.state='finalized' AND m.attached_at IS NOT NULL AND (
         EXISTS(SELECT 1 FROM public.classroom_product_media j JOIN public.classroom_products p
           ON p.room_id=j.room_id AND p.id=j.product_id
           WHERE j.room_id=m.room_id AND j.media_id=m.id AND j.product_id=$2 AND p.removed_at IS NULL)
         OR EXISTS(SELECT 1 FROM public.classroom_captures c
           WHERE c.room_id=m.room_id AND c.media_id=m.id AND c.id=$3)
       )) AS valid`,
    [roomId, productId, captureId, mediaId],
  );
  if (!source.valid) missingRecord();
  const {
    rows: [prior],
  } = await db.query<{
    id: string;
    lesson_id: string;
    surface: string;
    page_id: string;
    saved_at: Date | null;
  }>(
    `SELECT id,lesson_id,surface,page_id,saved_at FROM public.classroom_board_insertions
      WHERE room_id=$1 AND media_id=$4 AND (capture_id=$3 OR
        (product_id=$2 AND lesson_id=$5 AND surface=$6 AND page_id=$7))`,
    [
      roomId,
      productId,
      captureId,
      mediaId,
      target.lessonId,
      target.surface,
      target.pageId,
    ],
  );
  if (prior) {
    const sameTarget =
      prior.lesson_id === target.lessonId &&
      prior.surface === target.surface &&
      prior.page_id === target.pageId;
    if (!sameTarget && prior.saved_at)
      conflict(
        "capture_target_changed",
        "This capture was already saved to a different board page.",
      );
    if (!sameTarget)
      await db.query(
        "UPDATE public.classroom_board_insertions SET lesson_id=$3,surface=$4,page_id=$5 WHERE room_id=$1 AND id=$2",
        [roomId, prior.id, target.lessonId, target.surface, target.pageId],
      );
    return prior.id;
  }
  const {
    rows: [limit],
  } = await db.query<{ allowed: boolean }>(
    "SELECT count(*)<300 AS allowed FROM public.classroom_board_insertions WHERE room_id=$1",
    [roomId],
  );
  if (!limit.allowed)
    conflict(
      "insertion_limit",
      "The room has reached its board insertion limit.",
    );
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.classroom_board_insertions(room_id,id,product_id,capture_id,media_id,lesson_id,surface,page_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      roomId,
      id,
      productId,
      captureId,
      mediaId,
      target.lessonId,
      target.surface,
      target.pageId,
    ],
  );
  return id;
}
async function completeInsertion(
  db: PoolClient,
  roomId: string,
  command: Extract<TeacherParticipationCommand, { type: "completeInsertion" }>,
) {
  const { insertionId, localRevision, target } = command;
  const {
    rows: [row],
  } = await db.query<{
    local_revision: number | null;
    lesson_id: string;
    surface: string;
    page_id: string;
  }>(
    "SELECT local_revision,lesson_id,surface,page_id FROM public.classroom_board_insertions WHERE room_id=$1 AND id=$2",
    [roomId, insertionId],
  );
  if (!row) return missingRecord();
  if (
    row.lesson_id !== target.lessonId ||
    row.surface !== target.surface ||
    row.page_id !== target.pageId
  )
    conflict(
      "insertion_target_changed",
      "The board insertion target changed. Review the current target before saving.",
    );
  if (row.local_revision !== null && row.local_revision !== localRevision)
    conflict(
      "insertion_receipt_conflict",
      "A different local save already completed this insertion.",
    );
  if (row.local_revision === null)
    await db.query(
      `UPDATE public.classroom_board_insertions SET saved_at=statement_timestamp(),local_revision=$3
       WHERE room_id=$1 AND id=$2`,
      [roomId, insertionId, localRevision],
    );
  return insertionId;
}

async function apply(
  db: PoolClient,
  actor: ParticipationActor,
  command: Command,
  state: RoomState,
  secret: string,
): Promise<string> {
  const { roomId } = actor;
  if (state === "archived")
    conflict("room_closed", "The room has been archived.");
  if (actor.kind !== "teacher") submissionAllowed(state);
  switch (command.type) {
    case "publishTask":
    case "reviseTask":
      return writeTask(db, roomId, command);
    case "lockSubmissions":
    case "unlockSubmissions":
    case "startTimer":
    case "pauseTimer":
    case "resumeTimer":
    case "endTimer":
    case "resetTimer":
      return taskState(db, roomId, command);
    case "submitProduct":
      return submitProduct(db, actor, command);
    case "requestHelp":
      return requestHelp(db, actor, command);
    case "cancelHelp":
      return moveHelp(db, roomId, command.helpId, ["pending"], "cancelled");
    case "acknowledgeHelp":
      return moveHelp(db, roomId, command.helpId, ["pending"], "acknowledged");
    case "resolveHelp":
      return moveHelp(
        db,
        roomId,
        command.helpId,
        ["pending", "acknowledged"],
        "resolved",
      );
    case "publishProduct":
      await activeProduct(db, roomId, command.productId);
      await db.query(
        "UPDATE public.classroom_products SET published=$3 WHERE room_id=$1 AND id=$2",
        [roomId, command.productId, command.published],
      );
      return command.productId;
    case "removeProduct":
      await activeProduct(db, roomId, command.productId);
      await db.query(
        `UPDATE public.classroom_products SET removed_at=statement_timestamp(),published=false
        WHERE room_id=$1 AND id=$2`,
        [roomId, command.productId],
      );
      return command.productId;
    case "feedback": {
      await activeProduct(db, roomId, command.productId);
      const {
        rows: [limit],
      } = await db.query<{ allowed: boolean }>(
        "SELECT count(*)<20 AS allowed FROM public.classroom_product_feedback WHERE room_id=$1 AND product_id=$2",
        [roomId, command.productId],
      );
      if (!limit.allowed)
        conflict(
          "feedback_limit",
          "This product has reached its feedback limit.",
        );
      const id = randomUUID();
      await db.query(
        "INSERT INTO public.classroom_product_feedback(room_id,id,product_id,text) VALUES($1,$2,$3,$4)",
        [roomId, id, command.productId, command.text],
      );
      return id;
    }
    case "createCapture":
    case "rotateCapture":
      submissionAllowed(state);
      return rotateCapture(
        db,
        roomId,
        command.target,
        secret,
        command.type === "rotateCapture",
      );
    case "revokeCapture": {
      const {
        rows: [row],
      } = await db.query<{ id: string }>(
        "UPDATE public.classroom_capture_grants SET revoked_at=statement_timestamp() WHERE room_id=$1 AND revoked_at IS NULL RETURNING id",
        [roomId],
      );
      return row?.id ?? missingRecord();
    }
    case "acceptCapture":
      return acceptCapture(db, actor, command.mediaId);
    case "prepareInsertion":
      return prepareInsertion(db, roomId, command);
    case "completeInsertion":
      return completeInsertion(db, roomId, command);
  }
}

export async function executeParticipation(
  db: PoolClient,
  actor: ParticipationActor,
  key: string,
  command: Command,
  secret: string,
) {
  const { roomId, kind, id } = actor;
  let lock: { state: RoomState; revision: number } | undefined;
  try {
    const { rows } = await db.query<{ state: RoomState; revision: number }>(
      "SELECT state,revision FROM public.classroom_s10_lock_room($1)",
      [roomId],
    );
    lock = rows[0];
  } catch (error) {
    if ((error as { code?: string }).code !== "42501") throw error;
    return kind === "teacher" ? missingRoom() : expiredSession();
  }
  if (!lock) return missingRoom();
  // Refresh revocation after the room lock. S09 removes members under this same lock.
  if (kind === "participant") await activeParticipant(db, roomId, id);
  if (kind === "capture") await captureSessionView(db, actor);
  const requestHash = digest(JSON.stringify([kind, roomId, command]));
  const {
    rows: [prior],
  } = await db.query<ReceiptRow>(
    `SELECT request_hash,resource_id,revision,accepted_at FROM public.classroom_participation_receipts
       WHERE room_id=$1 AND actor_kind=$2 AND actor_id=$3 AND key=$4`,
    [roomId, kind, id, key],
  );
  if (prior) {
    if (prior.request_hash !== requestHash)
      conflict(
        "idempotency_conflict",
        "This request key was already used for another action.",
      );
    return {
      id: key,
      resourceId: prior.resource_id,
      revision: prior.revision,
      acceptedAt: prior.accepted_at.toISOString(),
    };
  }
  const resourceId = await apply(db, actor, command, lock.state, secret);
  const {
    rows: [receipt],
  } = await db.query<ReceiptRow>(
    `INSERT INTO public.classroom_participation_receipts(room_id,actor_kind,actor_id,key,request_hash,revision,resource_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING request_hash,revision,resource_id,accepted_at`,
    [roomId, kind, id, key, requestHash, lock.revision + 1, resourceId],
  );
  await db.query("SELECT public.classroom_s10_append_change($1,$2)", [
    roomId,
    key,
  ]);
  return {
    id: key,
    resourceId,
    revision: receipt.revision,
    acceptedAt: receipt.accepted_at.toISOString(),
  };
}
