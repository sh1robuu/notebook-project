import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { RoomError, uuid } from "../rooms/model.ts";
import type { ParticipationActor } from "../rooms/participation-auth.ts";
import { expiredSession, missingRoom } from "../rooms/store.ts";
import { imageTypes, mediaLimits } from "./image.ts";
import type { ImageMime, normalizeMedia } from "./image.ts";
import { mediaObjectKeys } from "./store.ts";

type InitUpload = {
  requestId: string;
  bytes: number;
  mime: ImageMime;
  sha256: string;
};
type Stage =
  | "pending"
  | "processing"
  | "uploaded"
  | "finalized"
  | "rejected"
  | "deleting"
  | "deleted";

export type MediaRow = {
  id: string;
  expected_bytes: number;
  expected_mime: ImageMime;
  expected_sha256: string;
  state: Stage;
  object_key: string | null;
  thumbnail_key: string | null;
  image_bytes: number | null;
  thumbnail_bytes: number | null;
  process_token: string | null;
  active: boolean;
  processing_recently: boolean;
};

const stageMinutes = 20;
const roomImages = 200;
const roomBytes = 300_000_000;
const actorImages = 20;
const actorDrafts = 4;

const columns = `id, expected_bytes, expected_mime, expected_sha256, state,
  object_key, thumbnail_key, image_bytes, thumbnail_bytes, process_token,
  (attached_at IS NOT NULL OR expires_at > statement_timestamp()) AS active,
  updated_at > statement_timestamp() - interval '2 minutes' AS processing_recently`;

function missingMedia() {
  return new RoomError(
    404,
    "media_not_found",
    "Classroom media is unavailable.",
  );
}

function inactiveMedia() {
  return new RoomError(
    409,
    "media_expired",
    "This upload has ended. Select the image again.",
  );
}

export function busyMedia() {
  return new RoomError(
    429,
    "media_busy",
    "Another image is being processed. Try again shortly.",
  );
}

export function uploadReceipt(media: MediaRow) {
  if (
    !media.active ||
    media.state === "rejected" ||
    media.state === "deleting" ||
    media.state === "deleted"
  )
    throw inactiveMedia();
  return {
    id: media.id,
    state: media.state === "processing" ? "pending" : media.state,
  };
}

export function parseUpload(body: unknown): InitUpload {
  const invalid = new RoomError(
    400,
    "invalid_media_request",
    "Provide a supported image, size and checksum.",
  );
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid;
  const { requestId, bytes, mime, sha256, ...extra } = body as Record<
    string,
    unknown
  >;
  if (
    Object.keys(extra).length ||
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > mediaLimits.uploadBytes ||
    !imageTypes.includes(mime as ImageMime) ||
    typeof sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(sha256)
  )
    throw invalid;
  return { requestId: uuid(requestId), bytes, mime: mime as ImageMime, sha256 };
}

async function lockUploadRoom(db: PoolClient, actor: ParticipationActor) {
  const {
    rows: [room],
  } = await db
    .query<{ state: string }>(
      "SELECT state FROM public.classroom_s10_lock_room($1)",
      [actor.roomId],
    )
    .catch((error: unknown) => {
      if ((error as { code?: string })?.code !== "42501") throw error;
      if (actor.kind === "teacher") return missingRoom();
      return expiredSession();
    });
  if (
    !room ||
    room.state === "archived" ||
    (actor.kind !== "teacher" && !["open", "locked"].includes(room.state))
  )
    throw new RoomError(
      409,
      "room_closed",
      "This classroom is closed to image uploads.",
    );
}

export async function readMedia(
  db: PoolClient,
  actor: ParticipationActor,
  id: string,
) {
  const {
    rows: [row],
  } = await db.query<MediaRow>(
    `SELECT ${columns} FROM public.classroom_media WHERE room_id=$1 AND id=$2`,
    [actor.roomId, id],
  );
  if (!row) throw missingMedia();
  return row;
}

export async function readOwnedMedia(
  db: PoolClient,
  actor: ParticipationActor,
  id: string,
) {
  const {
    rows: [row],
  } = await db.query<MediaRow>(
    `SELECT ${columns} FROM public.classroom_media WHERE room_id=$1 AND owner_kind=$2 AND owner_id=$3 AND id=$4`,
    [actor.roomId, actor.kind, actor.id, id],
  );
  if (!row) throw missingMedia();
  return row;
}

export async function initUpload(
  db: PoolClient,
  actor: ParticipationActor,
  input: InitUpload,
) {
  await lockUploadRoom(db, actor);
  const scope = [actor.roomId, actor.kind, actor.id];
  const {
    rows: [existing],
  } = await db.query<MediaRow>(
    `SELECT ${columns} FROM public.classroom_media WHERE room_id=$1 AND owner_kind=$2 AND owner_id=$3 AND request_id=$4`,
    [...scope, input.requestId],
  );
  if (existing) {
    if (
      existing.expected_bytes !== input.bytes ||
      existing.expected_mime !== input.mime ||
      existing.expected_sha256 !== input.sha256
    )
      throw new RoomError(
        409,
        "media_request_conflict",
        "This upload request already belongs to another file.",
      );
    return uploadReceipt(existing);
  }
  const {
    rows: [room],
  } = await db.query<{ objects: number; reserved_bytes: string }>(
    "SELECT * FROM public.classroom_s10_media_usage($1)",
    [actor.roomId],
  );
  const {
    rows: [owner],
  } = await db.query<{ objects: number; drafts: number }>(
    `SELECT count(*) FILTER (WHERE attached_at IS NOT NULL OR expires_at>statement_timestamp())::int AS objects,
       count(*) FILTER (WHERE attached_at IS NULL AND expires_at>statement_timestamp())::int AS drafts
     FROM public.classroom_media WHERE room_id=$1 AND owner_kind=$2 AND owner_id=$3 AND state NOT IN ('rejected','deleting','deleted')`,
    scope,
  );
  if (
    room.objects >= roomImages ||
    Number(room.reserved_bytes) +
      Math.max(
        input.bytes,
        mediaLimits.imageBytes + mediaLimits.thumbnailBytes,
      ) >
      roomBytes ||
    owner.objects >= actorImages ||
    owner.drafts >= actorDrafts
  )
    throw new RoomError(
      429,
      "media_quota",
      "This classroom or account has reached its image limit.",
    );

  const {
    rows: [created],
  } = await db.query<MediaRow>(
    `INSERT INTO public.classroom_media(room_id,owner_kind,owner_id,purpose,request_id,expected_bytes,expected_mime,expected_sha256,state,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',statement_timestamp()+($9::int*interval '1 minute')) RETURNING ${columns}`,
    [
      ...scope,
      actor.kind === "participant" ? "submission" : "capture",
      input.requestId,
      input.bytes,
      input.mime,
      input.sha256,
      stageMinutes,
    ],
  );
  return uploadReceipt(created);
}

export async function claimUpload(
  db: PoolClient,
  actor: ParticipationActor,
  id: string,
) {
  await lockUploadRoom(db, actor);
  const row = await readOwnedMedia(db, actor, id);
  const receipt = uploadReceipt(row);
  if (receipt.state !== "pending") return row;
  if (row.state === "processing" && row.processing_recently) throw busyMedia();

  const token = randomUUID();
  const keys = mediaObjectKeys(actor.roomId, id, token);
  const {
    rows: [claimed],
  } = await db.query<MediaRow>(
    `UPDATE public.classroom_media
     SET state='processing',object_key=coalesce(object_key,$4),thumbnail_key=coalesce(thumbnail_key,$5),
       process_token=$3,updated_at=statement_timestamp(),expires_at=statement_timestamp()+($6::int*interval '1 minute')
     WHERE room_id=$1 AND id=$2 AND state IN ('pending','processing') AND expires_at>statement_timestamp()
     RETURNING ${columns}`,
    [actor.roomId, id, token, keys.image, keys.thumbnail, stageMinutes],
  );
  if (!claimed) throw inactiveMedia();
  return claimed;
}

export async function releaseUpload(
  db: PoolClient,
  actor: ParticipationActor,
  claimed: MediaRow,
  rejected: boolean,
) {
  await db.query(
    `UPDATE public.classroom_media SET state=$4,process_token=NULL,updated_at=statement_timestamp()
     WHERE room_id=$1 AND id=$2 AND process_token=$3 AND state='processing'`,
    [
      actor.roomId,
      claimed.id,
      claimed.process_token,
      rejected ? "rejected" : "pending",
    ],
  );
}

export async function completeUpload(
  db: PoolClient,
  actor: ParticipationActor,
  claimed: MediaRow,
  normalized: Awaited<ReturnType<typeof normalizeMedia>>,
) {
  await lockUploadRoom(db, actor);
  const {
    rows: [row],
  } = await db.query<MediaRow>(
    `UPDATE public.classroom_media SET state='uploaded',image_bytes=$4,thumbnail_bytes=$5,width=$6,height=$7,sha256=$8,
       process_token=NULL,updated_at=statement_timestamp(),expires_at=statement_timestamp()+($9::int*interval '1 minute')
     WHERE room_id=$1 AND id=$2 AND process_token=$3 AND state='processing' AND expires_at>statement_timestamp()
     RETURNING ${columns}`,
    [
      actor.roomId,
      claimed.id,
      claimed.process_token,
      normalized.image.length,
      normalized.thumbnail.length,
      normalized.width,
      normalized.height,
      normalized.sha256,
      stageMinutes,
    ],
  );
  if (!row) throw inactiveMedia();
  return uploadReceipt(row);
}

export async function finalizeUpload(
  db: PoolClient,
  actor: ParticipationActor,
  inspected: MediaRow,
) {
  await lockUploadRoom(db, actor);
  const current = await readOwnedMedia(db, actor, inspected.id);
  const receipt = uploadReceipt(current);
  if (receipt.state === "finalized") return receipt;
  if (
    current.state !== "uploaded" ||
    current.object_key !== inspected.object_key ||
    current.thumbnail_key !== inspected.thumbnail_key
  )
    throw new RoomError(
      409,
      "media_incomplete",
      "Upload the image before finishing.",
    );
  const {
    rows: [row],
  } = await db.query<MediaRow>(
    `UPDATE public.classroom_media SET state='finalized',updated_at=statement_timestamp(),
       expires_at=statement_timestamp()+($3::int*interval '1 minute')
     WHERE room_id=$1 AND id=$2 AND state='uploaded' AND expires_at>statement_timestamp() RETURNING ${columns}`,
    [actor.roomId, inspected.id, stageMinutes],
  );
  if (!row) throw inactiveMedia();
  return uploadReceipt(row);
}
