import type { Pool } from "pg";
import { assertClassroomDatabase } from "../database.ts";
import { migrateClassroom } from "../migrations.ts";
import { neonDirectUrl, normalizeNeonUrl } from "./neon.ts";
import { ensureClassroomRole } from "./provision.ts";
import { openClassroomAdminPool } from "./admin-pool.ts";

async function bootstrap() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1 || (arguments_.length === 1 && arguments_[0] !== "--websocket"))
    throw new Error("Only the optional --websocket transport flag is supported.");
  const websocket = arguments_[0] === "--websocket";
  const ownerUrl = neonDirectUrl(process.env.CLASSROOM_MIGRATION_URL ?? "");
  const runtimeUrl = normalizeNeonUrl(process.env.CLASSROOM_DATABASE_URL ?? "");
  const owner = new URL(ownerUrl), runtime = new URL(runtimeUrl);
  if (owner.username === "lessonboard_app" || runtime.username !== "lessonboard_app" ||
      new URL(neonDirectUrl(runtimeUrl)).hostname !== owner.hostname || runtime.pathname !== owner.pathname ||
      runtime.password === owner.password)
    throw new Error("Separate owner and runtime credentials for the same database are required.");

  const admin = await openClassroomAdminPool(ownerUrl, { websocket });
  let app: Pool | undefined;
  admin.on("error", () => console.error("An administrative database connection closed."));
  try {
    app = await openClassroomAdminPool(runtimeUrl, { websocket });
    app.on("error", () => console.error("A runtime verification database connection closed."));
    const role = await ensureClassroomRole(admin, decodeURIComponent(runtime.password));
    const migrations = await migrateClassroom(admin);
    await assertClassroomDatabase(app);
    const { rows } = await app.query<{ protected_tables: number }>(`
      SELECT count(*)::integer AS protected_tables FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relrowsecurity AND c.relforcerowsecurity
        AND c.relname IN ('classroom_rooms','classroom_groups','classroom_participants',
          'classroom_room_invitations','classroom_room_events','classroom_room_command_receipts')
    `);
    if (rows[0]?.protected_tables !== 6) throw new Error("Classroom forced RLS is incomplete.");
    console.log(JSON.stringify({ roleCreated: role.created, migrations, runtimeRole: "lessonboard_app", forcedRlsTables: rows[0].protected_tables, transport: websocket ? "neon-wss-443" : "postgres-tcp" }));
  } finally {
    try { await app?.end(); }
    finally { await admin.end(); }
  }
}

bootstrap().catch((error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  console.error("Neon setup did not complete. Existing data was not reset.",
    typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? "Database code " + code : "Check owner/runtime credentials, access and schema compatibility.");
  process.exitCode = 1;
});
