import type { Pool, PoolClient } from "pg";
import { RoomError, digest, invitationCode, limits } from "./model.ts";
import type { RoomMode, RoomState } from "./model.ts";

export type RoomRow = {
  id: string;
  owner_id: string;
  title: string;
  mode: RoomMode;
  state: RoomState;
  revision: number;
  active_participants: number;
  next_position: number;
  created_at: Date;
  updated_at: Date;
};

type Scope = {
  actor: "teacher" | "participant" | "invite";
  actorId?: string;
  roomId?: string;
  inviteHash?: string;
  joinKey?: string;
};

export async function transaction<T>(
  pool: Pool,
  operation: (db: PoolClient) => Promise<T>,
  readOnly = false,
): Promise<T> {
  const db = await pool.connect();
  let discard: Error | undefined;
  try {
    await db.query(
      readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN",
    );
    const result = await operation(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch {
      discard = new Error("PostgreSQL transaction could not be rolled back.");
    }
    throw error;
  } finally {
    db.release(discard);
  }
}

export async function setScope(db: PoolClient, scope: Scope) {
  await db.query(
    `SELECT
      set_config('classroom.actor', $1, true),
      set_config('classroom.actor_id', $2, true),
      set_config('classroom.room_id', $3, true),
      set_config('classroom.invite_hash', $4, true),
      set_config('classroom.join_key', $5, true)`,
    [
      scope.actor,
      scope.actorId ?? "",
      scope.roomId ?? "",
      scope.inviteHash ?? "",
      scope.joinKey ?? "",
    ],
  );
}

export function missingRoom(): never {
  throw new RoomError(
    404,
    "room_not_found",
    "This classroom room is unavailable.",
  );
}

export function expiredSession(): never {
  throw new RoomError(
    401,
    "session_expired",
    "This classroom session is unavailable. Sign in or join again.",
  );
}

export function roomSummary(row: RoomRow) {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    state: row.state,
    revision: row.revision,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function roomRow(db: PoolClient, roomId: string, lock = false) {
  const result = await db.query<RoomRow>(
    lock
      ? "SELECT * FROM public.classroom_rooms WHERE id = $1 FOR UPDATE"
      : "SELECT * FROM public.classroom_rooms WHERE id = $1",
    [roomId],
  );
  return result.rows[0];
}

export async function teacherRooms(db: PoolClient, teacherId: string) {
  const { rows } = await db.query<RoomRow>(
    "SELECT * FROM public.classroom_rooms WHERE owner_id = $1 ORDER BY updated_at DESC, id",
    [teacherId],
  );
  return rows.map(roomSummary);
}

export async function teacherRoom(
  db: PoolClient,
  row: RoomRow,
  secret: string,
) {
  const groups = await db.query<{ id: string; name: string }>(
    "SELECT id, name FROM public.classroom_groups WHERE room_id = $1 ORDER BY created_at, id",
    [row.id],
  );
  const roster = await db.query<{
    id: string;
    display_name: string;
    group_id: string | null;
    position: number;
    joined_at: Date;
  }>(
    `SELECT id, display_name, group_id, position, joined_at
     FROM public.classroom_participants WHERE room_id = $1 AND removed_at IS NULL
     ORDER BY position, id`,
    [row.id],
  );
  const active =
    row.state === "open"
      ? (
          await db.query<{ id: string; code_hash: string; expires_at: Date }>(
            `SELECT id, code_hash, expires_at FROM public.classroom_room_invitations
     WHERE room_id = $1 AND revoked_at IS NULL AND expires_at > statement_timestamp()`,
            [row.id],
          )
        ).rows[0]
      : undefined;
  const code = active && invitationCode(secret, active.id);

  return {
    ...roomSummary(row),
    groups: groups.rows,
    participants: roster.rows.map((person) => ({
      id: person.id,
      displayName: person.display_name,
      groupId: person.group_id,
      position: person.position,
      joinedAt: person.joined_at.toISOString(),
    })),
    invitation:
      active && code && digest(code) === active.code_hash
        ? {
            code,
            expiresAt: active.expires_at.toISOString(),
          }
        : null,
  };
}

export async function activeParticipant(
  db: PoolClient,
  roomId: string,
  participantId: string,
) {
  const { rows } = await db.query<{
    id: string;
    display_name: string;
    group_id: string | null;
    group_name: string | null;
  }>(
    `SELECT p.id, p.display_name, g.id AS group_id, g.name AS group_name
     FROM public.classroom_participants AS p
     LEFT JOIN public.classroom_groups AS g ON g.room_id = p.room_id AND g.id = p.group_id
     WHERE p.room_id = $1 AND p.id = $2 AND p.removed_at IS NULL`,
    [roomId, participantId],
  );
  if (!rows[0]) return expiredSession();
  return rows[0];
}

export async function participantRoom(
  db: PoolClient,
  roomId: string,
  participantId: string,
) {
  const room = await roomRow(db, roomId);
  if (!room || room.state === "archived") return expiredSession();
  const self = await activeParticipant(db, roomId, participantId);
  return {
    id: room.id,
    title: room.title,
    mode: room.mode,
    state: room.state,
    revision: room.revision,
    self: {
      id: self.id,
      displayName: self.display_name,
      group:
        self.group_id && self.group_name
          ? { id: self.group_id, name: self.group_name }
          : null,
    },
  };
}

export type ReplayEvent = { event: "room" | "reset"; revision: number };

export async function pollRoom(
  db: PoolClient,
  roomId: string,
  cursor: number | null,
  participantId?: string,
): Promise<ReplayEvent[]> {
  const {
    rows: [room],
  } = await db.query<{
    revision: number;
    state: RoomState;
    active: boolean;
    revisions: number[];
  }>(
    `SELECT r.revision, r.state,
       ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM public.classroom_participants AS member
         WHERE member.room_id = r.id AND member.id = $3 AND member.removed_at IS NULL
       )) AS active,
       COALESCE((
         SELECT jsonb_agg(events.revision ORDER BY events.revision)
         FROM (
           SELECT revision FROM public.classroom_room_events
           WHERE room_id = r.id AND $2::integer IS NOT NULL AND revision > $2
             AND revision <= r.revision ORDER BY revision LIMIT $4
         ) AS events
       ), '[]'::jsonb) AS revisions
     FROM public.classroom_rooms AS r WHERE r.id = $1`,
    [roomId, cursor, participantId ?? null, limits.replay],
  );
  if (!room) return participantId ? expiredSession() : missingRoom();
  if (participantId && (!room.active || room.state === "archived"))
    return expiredSession();
  if (
    cursor === null ||
    cursor > room.revision ||
    room.revision - cursor > limits.replay ||
    room.revisions.length !== room.revision - cursor ||
    room.revisions.some((revision, index) => revision !== cursor + index + 1)
  )
    return [{ event: "reset", revision: room.revision }];
  return room.revisions.map((revision) => ({ event: "room", revision }));
}
