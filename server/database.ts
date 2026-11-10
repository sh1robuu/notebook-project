import { Pool } from "pg";

export function openClassroomPool(connectionString: string) {
  return new Pool({
    connectionString,
    max: 12,
    connectionTimeoutMillis: 4_000,
    idleTimeoutMillis: 15_000,
    statement_timeout: 8_000,
    idle_in_transaction_session_timeout: 10_000,
  });
}

export async function assertClassroomDatabase(pool: Pool) {
  const { rows } = await pool.query<{ permitted: boolean }>(`
    SELECT session_user = 'lessonboard_app'
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb
      AND NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE left(relname, 10) = 'classroom_'
          AND relkind IN ('r', 'p')
          AND pg_has_role(relowner, 'MEMBER')
      )
      AND to_regclass('public.classroom_rooms') IS NOT NULL
      AND to_regclass('public.classroom_users') IS NOT NULL
      AS permitted
    FROM pg_roles WHERE rolname = current_user
  `);
  if (rows[0]?.permitted !== true) {
    throw new Error("Classroom migrations or restricted database role are missing.");
  }
}
