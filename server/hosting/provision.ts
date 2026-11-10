import type { Pool, PoolClient } from "pg";

const runtimeRole = "lessonboard_app";

function identifier(value: string) {
  return '"' + value.replaceAll('"', '""') + '"';
}

async function inspectRole(db: PoolClient) {
  const { rows } = await db.query<{ restricted: boolean }>(`
    SELECT r.rolcanlogin
      AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
      AND NOT r.rolreplication AND NOT r.rolbypassrls
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relowner = r.oid AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      )
      AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = r.oid)
      AND NOT has_schema_privilege(r.oid, 'public', 'CREATE')
      AS restricted
    FROM pg_roles r WHERE r.rolname = $1
  `, [runtimeRole]);
  return rows[0];
}

/** Owner-run setup only. Existing passwords, role memberships and table grants remain unchanged. */
export async function ensureClassroomRole(owner: Pool, runtimePassword: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(runtimePassword))
    throw new Error("An independent strong runtime password is required.");
  const db = await owner.connect();
  let reusable = false;
  try {
    await db.query("BEGIN");
    const context = await db.query<{ actor: string; database: string }>(
      "SELECT current_user AS actor, current_database() AS database",
    );
    if (context.rows[0].actor === runtimeRole)
      throw new Error("A separate database owner connection is required for role setup.");
    await db.query("SELECT pg_advisory_xact_lock(964082015)");
    let role = await inspectRole(db);
    const created = !role;
    if (created) {
      // PostgreSQL role DDL does not accept parameter placeholders. The generated
      // password alphabet is checked above and cannot contain SQL delimiters.
      await db.query(`CREATE ROLE lessonboard_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`);
      role = await inspectRole(db);
    }
    if (role?.restricted !== true)
      throw new Error("The existing application role is not restricted. Review its ownership, memberships and privileges before continuing.");
    await db.query("GRANT USAGE ON SCHEMA public TO lessonboard_app");
    const database = identifier(context.rows[0].database);
    await db.query("ALTER ROLE lessonboard_app IN DATABASE " + database + " SET statement_timeout = '8s'");
    await db.query("ALTER ROLE lessonboard_app IN DATABASE " + database + " SET idle_in_transaction_session_timeout = '10s'");
    await db.query("COMMIT");
    reusable = true;
    return { created };
  } finally {
    if (!reusable) {
      try { await db.query("ROLLBACK"); reusable = true; }
      catch { /* Discard a connection whose transaction state is unknown. */ }
    }
    db.release(!reusable);
  }
}
