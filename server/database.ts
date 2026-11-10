import { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";

export function openClassroomPool(connectionString: string) {
  return new Pool({
    connectionString,
    max: 12,
    connectionTimeoutMillis: 12_000,
    idleTimeoutMillis: 15_000,
    enableChannelBinding: true,
  });
}

const transientStartupCodes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN",
  "08000", "08001", "08003", "08006", "57P01", "57P02", "57P03",
]);
const connectionTimeoutMessages = new Set([
  "timeout expired",
  "timeout exceeded when trying to connect",
  "Connection terminated",
  "Connection terminated unexpectedly",
  "Connection terminated due to connection timeout",
]);

// Only the read-only startup check is retried. Room writes retain their existing
// transaction and idempotency contracts. Permanent configuration errors stop here.
export async function waitForClassroomDatabase(
  pool: Pool,
  pause: (milliseconds: number) => Promise<void> = delay,
) {
  const backoff = [1_000, 2_000, 4_000];
  for (let attempt = 0; ; attempt++) {
    try {
      await assertClassroomDatabase(pool);
      return;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      const transient = typeof code === "string"
        ? transientStartupCodes.has(code)
        : error instanceof Error && connectionTimeoutMessages.has(error.message);
      if (!transient || attempt === backoff.length) throw error;
      await pause(backoff[attempt]);
    }
  }
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
