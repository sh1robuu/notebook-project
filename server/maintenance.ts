import type { Pool } from "pg";

export async function pruneClassroomData(
  pool: Pool,
  options: { retentionDays: number; apply: boolean; roomId?: string },
) {
  if (!Number.isSafeInteger(options.retentionDays) || options.retentionDays < 1 || options.retentionDays > 3650)
    throw new Error("Classroom retention must be between 1 and 3650 days.");
  if (options.roomId !== undefined && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(options.roomId))
    throw new Error("Classroom room ID is invalid.");
  const db = await pool.connect();
  let reusable = false;
  try {
    await db.query("BEGIN");
    const role = await db.query<{ permitted: boolean }>(
      "SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname = current_user",
    );
    if (role.rows[0]?.permitted !== true)
      throw new Error("A separate privileged maintenance role is required to inspect forced-RLS retention data.");
    const { rows } = await db.query<{ id: string }>(`
      SELECT id FROM classroom_rooms
      WHERE state = 'archived'
        AND updated_at < statement_timestamp() - ($1::integer * interval '1 day')
        AND ($2::uuid IS NULL OR id = $2)
      ORDER BY updated_at, id LIMIT 100 FOR UPDATE SKIP LOCKED
    `, [options.retentionDays, options.roomId ?? null]);
    const ids = rows.map(row => row.id);
    if (options.apply && ids.length) {
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
    if (options.apply) {
      await db.query("DELETE FROM classroom_oauth_attempts WHERE expires_at < statement_timestamp()");
      for (const table of ["classroom_sessions", "classroom_participant_sessions"]) {
        await db.query("DELETE FROM " + table +
          " WHERE expires_at < statement_timestamp() - interval '1 day' OR revoked_at < statement_timestamp() - interval '1 day'");
      }
    }
    await db.query("COMMIT");
    reusable = true;
    return { eligibleRooms: ids, purgedRooms: options.apply ? ids.length : 0 };
  } finally {
    if (!reusable) {
      try { await db.query("ROLLBACK"); reusable = true; }
      catch { /* A broken transaction connection is discarded. */ }
    }
    db.release(!reusable);
  }
}
