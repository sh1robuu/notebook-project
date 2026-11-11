import type { Pool } from "pg";
import { transaction } from "./rooms/store.ts";
import { pruneStoredMedia } from "./media/maintenance.ts";
import type { MediaStore } from "./media/store.ts";

export async function pruneClassroomData(
  pool: Pool,
  options: { retentionDays: number; apply: boolean; roomId?: string; mediaStore?: MediaStore },
) {
  if (!Number.isSafeInteger(options.retentionDays) || options.retentionDays < 1 || options.retentionDays > 3650)
    throw new Error("Classroom retention must be between 1 and 3650 days.");
  if (options.roomId !== undefined && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(options.roomId))
    throw new Error("Classroom room ID is invalid.");
  const { eligibleRooms, mediaSchema } = await transaction(pool, async (db) => {
    const role = await db.query<{ permitted: boolean; media_schema: boolean }>(
      `SELECT rolsuper OR rolbypassrls AS permitted,
         to_regclass('public.classroom_media') IS NOT NULL AS media_schema
       FROM pg_roles WHERE rolname = current_user`,
    );
    if (role.rows[0]?.permitted !== true)
      throw new Error("A separate privileged maintenance role is required to inspect forced-RLS retention data.");
    const { rows } = await db.query<{ id: string }>(`
      SELECT id FROM classroom_rooms
      WHERE state = 'archived'
        AND updated_at < statement_timestamp() - ($1::integer * interval '1 day')
        AND ($2::uuid IS NULL OR id = $2)
      ORDER BY updated_at, id LIMIT 100
    `, [options.retentionDays, options.roomId ?? null]);
    return { eligibleRooms: rows.map((row) => row.id), mediaSchema: role.rows[0].media_schema };
  }, true);

  if (!options.apply) return { eligibleRooms, purgedRooms: 0, deletedMedia: 0, deferredMedia: 0 };
  const media = mediaSchema
    ? await pruneStoredMedia(pool, { archivedRooms: eligibleRooms, roomId: options.roomId, store: options.mediaStore })
    : { deletedMedia: 0, deferredMedia: 0 };
  const purgedRooms = await transaction(pool, async (db) => {
    const { rows } = await db.query<{ id: string }>(`
      SELECT r.id FROM public.classroom_rooms r
      WHERE r.id=ANY($1::uuid[]) AND r.state='archived'
        AND r.updated_at<statement_timestamp()-($2::int*interval '1 day')
        ${mediaSchema ? `AND NOT EXISTS (
          SELECT 1 FROM public.classroom_media m WHERE m.room_id=r.id AND m.state<>'deleted'
        )` : ""}
      ORDER BY r.updated_at,r.id FOR UPDATE OF r SKIP LOCKED
    `, [eligibleRooms, options.retentionDays]);
    const ids = rows.map((row) => row.id);
    if (ids.length) {
      if (mediaSchema) {
        // Products and capture grants cascade to the media references and insertion receipts.
        await db.query("DELETE FROM public.classroom_products WHERE room_id=ANY($1::uuid[])", [ids]);
        await db.query("DELETE FROM public.classroom_capture_grants WHERE room_id=ANY($1::uuid[])", [ids]);
        await db.query("DELETE FROM public.classroom_media WHERE room_id=ANY($1::uuid[])", [ids]);
      }
      for (const table of [
        "classroom_participant_sessions",
        "classroom_participants",
        "classroom_groups",
        "classroom_room_command_receipts",
        "classroom_room_events",
        "classroom_room_invitations",
      ]) {
        await db.query("DELETE FROM " + table + " WHERE room_id = ANY($1::uuid[])", [ids]);
      }
      await db.query("DELETE FROM classroom_rooms WHERE id = ANY($1::uuid[])", [ids]);
    }
    await db.query("DELETE FROM classroom_oauth_attempts WHERE expires_at < statement_timestamp()");
    for (const table of ["classroom_sessions", "classroom_participant_sessions"]) {
      await db.query("DELETE FROM " + table +
        " WHERE expires_at < statement_timestamp() - interval '1 day' OR revoked_at < statement_timestamp() - interval '1 day'");
    }
    return ids.length;
  });
  return { eligibleRooms, purgedRooms, ...media };
}
