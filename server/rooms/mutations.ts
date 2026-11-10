import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResult } from "pg";
import {
  RoomError,
  digest,
  invitationCode,
  isTransition,
  limits,
  transition,
} from "./model.ts";
import type { RoomCommand, RoomMode } from "./model.ts";
import {
  expiredSession,
  missingRoom,
  participantRoom,
  roomRow,
  setScope,
  teacherRoom,
} from "./store.ts";
import type { RoomRow } from "./store.ts";

type Receipt = { room_id: string; request_hash: string; revision: number };

function changed(result: QueryResult) {
  if (!result.rowCount)
    throw new RoomError(
      404,
      "room_record_not_found",
      "This classroom record is unavailable.",
    );
}

async function readReceipt(
  db: PoolClient,
  ownerId: string,
  key: string,
  requestHash: string,
) {
  // A teacher's key is unique across create and room commands. The same lock
  // covers a missing receipt, including concurrent first attempts.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    ownerId + ":" + key,
  ]);
  const { rows } = await db.query<Receipt>(
    `SELECT room_id, request_hash, revision FROM public.classroom_room_command_receipts
     WHERE owner_id = $1 AND key = $2`,
    [ownerId, key],
  );
  if (rows[0] && rows[0].request_hash !== requestHash)
    throw new RoomError(
      409,
      "idempotency_conflict",
      "This request key was already used for another action.",
    );
  return rows[0];
}

async function recordReceipt(
  db: PoolClient,
  row: RoomRow,
  key: string,
  requestHash: string,
) {
  await db.query(
    `INSERT INTO public.classroom_room_command_receipts
       (owner_id, key, room_id, request_hash, revision) VALUES ($1, $2, $3, $4, $5)`,
    [row.owner_id, key, row.id, requestHash, row.revision],
  );
}

async function appendEvent(db: PoolClient, room: RoomRow) {
  await db.query(
    "INSERT INTO public.classroom_room_events (room_id, revision) VALUES ($1, $2)",
    [room.id, room.revision],
  );
}

async function teacherResult(
  db: PoolClient,
  room: RoomRow,
  revision: number,
  secret: string,
) {
  return { room: await teacherRoom(db, room, secret), receipt: { revision } };
}

export async function createRoom(
  db: PoolClient,
  ownerId: string,
  key: string,
  input: { title: string; mode: RoomMode },
  secret: string,
) {
  const hash = digest(JSON.stringify(["create", input]));
  const prior = await readReceipt(db, ownerId, key, hash);
  if (prior) {
    const room = await roomRow(db, prior.room_id, true);
    if (!room) return missingRoom();
    return teacherResult(db, room, prior.revision, secret);
  }
  const {
    rows: [room],
  } = await db.query<RoomRow>(
    `INSERT INTO public.classroom_rooms (id, owner_id, title, mode)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [randomUUID(), ownerId, input.title, input.mode],
  );
  await appendEvent(db, room);
  await recordReceipt(db, room, key, hash);
  return teacherResult(db, room, room.revision, secret);
}

async function revokeInvitation(db: PoolClient, roomId: string) {
  await db.query(
    `UPDATE public.classroom_room_invitations SET revoked_at = statement_timestamp()
     WHERE room_id = $1 AND revoked_at IS NULL`,
    [roomId],
  );
}

async function rotateInvitation(
  db: PoolClient,
  room: RoomRow,
  secret: string,
  inviteTtlSeconds: number,
) {
  if (room.state !== "open" && room.state !== "locked")
    throw new RoomError(
      409,
      "join_closed",
      "Open the room before generating an invitation.",
    );
  await revokeInvitation(db, room.id);
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.classroom_room_invitations (room_id, id, code_hash, expires_at)
     VALUES ($1, $2, $3, statement_timestamp() + ($4::integer * interval '1 second'))`,
    [room.id, id, digest(invitationCode(secret, id)), inviteTtlSeconds],
  );
}

async function removeParticipant(
  db: PoolClient,
  roomId: string,
  participantId: string,
) {
  changed(
    await db.query(
      `UPDATE public.classroom_participants SET removed_at = statement_timestamp()
     WHERE room_id = $1 AND id = $2 AND removed_at IS NULL`,
      [roomId, participantId],
    ),
  );
  await db.query(
    `UPDATE public.classroom_participant_sessions SET revoked_at = statement_timestamp()
     WHERE room_id = $1 AND participant_id = $2 AND revoked_at IS NULL`,
    [roomId, participantId],
  );
  await db.query(
    "UPDATE public.classroom_rooms SET active_participants = active_participants - 1 WHERE id = $1",
    [roomId],
  );
}

async function reorder(db: PoolClient, room: RoomRow, ids: string[]) {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM public.classroom_participants WHERE room_id = $1 AND removed_at IS NULL",
    [room.id],
  );
  const wanted = new Set(ids);
  if (
    ids.length !== rows.length ||
    wanted.size !== ids.length ||
    rows.some(({ id }) => !wanted.has(id))
  )
    throw new RoomError(
      409,
      "roster_changed",
      "Refresh the room before reordering the roster.",
    );
  await db.query(
    `UPDATE public.classroom_participants AS person SET position = incoming.position::integer
     FROM unnest($2::uuid[]) WITH ORDINALITY AS incoming(id, position)
     WHERE person.room_id = $1 AND person.id = incoming.id AND person.removed_at IS NULL`,
    [room.id, ids],
  );
}

async function applyCommand(
  db: PoolClient,
  room: RoomRow,
  command: RoomCommand,
  secret: string,
  inviteTtlSeconds: number,
) {
  if (isTransition(command.type)) {
    const state = transition(room.state, command.type);
    if (state === "ended" || state === "archived")
      await revokeInvitation(db, room.id);
    await db.query(
      "UPDATE public.classroom_rooms SET state = $2 WHERE id = $1",
      [room.id, state],
    );
    return;
  }
  if (room.state === "archived" || room.state === "ended")
    throw new RoomError(
      409,
      "room_closed",
      "Reopen the room before making changes.",
    );
  switch (command.type) {
    case "configure":
      await db.query(
        "UPDATE public.classroom_rooms SET title = $2, mode = $3 WHERE id = $1",
        [room.id, command.title, command.mode],
      );
      return;
    case "rotateInvitation":
      return rotateInvitation(db, room, secret, inviteTtlSeconds);
    case "revokeInvitation":
      return revokeInvitation(db, room.id);
    case "renameParticipant":
      changed(
        await db.query(
          `UPDATE public.classroom_participants SET display_name = $3
         WHERE room_id = $1 AND id = $2 AND removed_at IS NULL`,
          [room.id, command.participantId, command.displayName],
        ),
      );
      return;
    case "removeParticipant":
      return removeParticipant(db, room.id, command.participantId);
    case "reorderParticipants":
      return reorder(db, room, command.participantIds);
    case "assignGroup": {
      if (command.groupId !== null) {
        changed(
          await db.query(
            "SELECT 1 FROM public.classroom_groups WHERE room_id = $1 AND id = $2",
            [room.id, command.groupId],
          ),
        );
      }
      changed(
        await db.query(
          `UPDATE public.classroom_participants SET group_id = $3
         WHERE room_id = $1 AND id = $2 AND removed_at IS NULL`,
          [room.id, command.participantId, command.groupId],
        ),
      );
      return;
    }
    case "createGroup": {
      const result = await db.query<{ total: number }>(
        "SELECT count(*)::integer AS total FROM public.classroom_groups WHERE room_id = $1",
        [room.id],
      );
      if (result.rows[0].total >= limits.groups)
        throw new RoomError(
          409,
          "group_limit",
          "The room has reached its group limit.",
        );
      await db.query(
        "INSERT INTO public.classroom_groups (room_id, id, name) VALUES ($1, $2, $3)",
        [room.id, randomUUID(), command.name],
      );
      return;
    }
    case "renameGroup":
      changed(
        await db.query(
          "UPDATE public.classroom_groups SET name = $3 WHERE room_id = $1 AND id = $2",
          [room.id, command.groupId, command.name],
        ),
      );
      return;
    case "deleteGroup":
      await db.query(
        "UPDATE public.classroom_participants SET group_id = NULL WHERE room_id = $1 AND group_id = $2",
        [room.id, command.groupId],
      );
      changed(
        await db.query(
          "DELETE FROM public.classroom_groups WHERE room_id = $1 AND id = $2",
          [room.id, command.groupId],
        ),
      );
      return;
  }
}

export async function commandRoom(
  db: PoolClient,
  ownerId: string,
  roomId: string,
  key: string,
  command: RoomCommand,
  secret: string,
  inviteTtlSeconds: number,
) {
  const hash = digest(JSON.stringify(["command", roomId, command]));
  const prior = await readReceipt(db, ownerId, key, hash);
  const room = await roomRow(db, roomId, true);
  if (!room || room.owner_id !== ownerId) return missingRoom();
  if (prior) return teacherResult(db, room, prior.revision, secret);
  await applyCommand(db, room, command, secret, inviteTtlSeconds);
  const {
    rows: [updated],
  } = await db.query<RoomRow>(
    `UPDATE public.classroom_rooms SET revision = revision + 1, updated_at = statement_timestamp()
     WHERE id = $1 RETURNING *`,
    [roomId],
  );
  await appendEvent(db, updated);
  await recordReceipt(db, updated, key, hash);
  return teacherResult(db, updated, updated.revision, secret);
}

async function activeInvitation(
  db: PoolClient,
  inviteHash: string,
  secret: string,
) {
  const { rows } = await db.query<{ id: string; room_id: string }>(
    `SELECT id, room_id FROM public.classroom_room_invitations
     WHERE code_hash = $1 AND revoked_at IS NULL AND expires_at > statement_timestamp()`,
    [inviteHash],
  );
  if (!rows[0] || digest(invitationCode(secret, rows[0].id)) !== inviteHash)
    throw new RoomError(
      404,
      "invalid_invitation",
      "This invitation is unavailable.",
    );
  return rows[0];
}

export async function joinRoom(
  db: PoolClient,
  input: { code: string; displayName: string },
  key: string,
  secret: string,
) {
  const inviteHash = digest(input.code);
  await setScope(db, { actor: "invite", inviteHash, joinKey: key });
  const { room_id: roomId } = await activeInvitation(db, inviteHash, secret);
  await setScope(db, { actor: "invite", roomId, inviteHash, joinKey: key });
  const room = await roomRow(db, roomId, true);
  const invitation = await activeInvitation(db, inviteHash, secret);
  if (!room) return missingRoom();

  const requestHash = digest(
    JSON.stringify(["join", invitation.id, input.displayName]),
  );
  const {
    rows: [prior],
  } = await db.query<{
    id: string;
    join_request_hash: string;
    removed_at: Date | null;
  }>(
    `SELECT id, join_request_hash, removed_at FROM public.classroom_participants
     WHERE room_id = $1 AND join_key = $2`,
    [roomId, key],
  );
  let participantId: string;
  if (prior) {
    if (prior.join_request_hash !== requestHash)
      throw new RoomError(
        409,
        "idempotency_conflict",
        "This request key was already used for another action.",
      );
    if (prior.removed_at) return expiredSession();
    participantId = prior.id;
  } else {
    if (room.state !== "open")
      throw new RoomError(
        409,
        "join_closed",
        "This room is not accepting new participants.",
      );
    if (room.active_participants >= limits.participants)
      throw new RoomError(
        409,
        "participant_limit",
        "This room has reached its participant limit.",
      );
    participantId = randomUUID();
    await db.query(
      `INSERT INTO public.classroom_participants
         (room_id, id, display_name, position, join_key, join_invitation_id, join_request_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        roomId,
        participantId,
        input.displayName,
        room.next_position,
        key,
        invitation.id,
        requestHash,
      ],
    );
    const {
      rows: [updated],
    } = await db.query<RoomRow>(
      `UPDATE public.classroom_rooms SET active_participants = active_participants + 1,
         next_position = next_position + 1, revision = revision + 1, updated_at = statement_timestamp()
       WHERE id = $1 RETURNING *`,
      [roomId],
    );
    await appendEvent(db, updated);
  }
  await setScope(db, { actor: "participant", actorId: participantId, roomId });
  return {
    roomId,
    participantId,
    room: await participantRoom(db, roomId, participantId),
  };
}
