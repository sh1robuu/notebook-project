import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";

export async function migrateClassroom(pool: Pool) {
  const directory = new URL("./migrations/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => /^\d{3}-[a-z-]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error("Classroom migration files are missing.");
  const client = await pool.connect();
  let completed = false;
  try {
    await client.query("SELECT pg_advisory_lock(964082014)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.classroom_schema_migrations (
        name text PRIMARY KEY,
        sha256 text NOT NULL CHECK (length(sha256) = 64),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("REVOKE ALL ON public.classroom_schema_migrations FROM PUBLIC, lessonboard_app");
    const { rows } = await client.query<{ name: string; sha256: string }>(
      "SELECT name, sha256 FROM public.classroom_schema_migrations",
    );
    const history = new Map(rows.map(({ name, sha256 }) => [name, sha256]));
    if (rows.some(({ name }) => !names.includes(name))) throw new Error("Database contains a newer classroom migration.");
    for (const name of names) {
      const sql = await readFile(new URL(name, directory), "utf8");
      const sha = createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex");
      if (history.has(name)) {
        if (history.get(name) !== sha) throw new Error("An applied classroom migration has changed: " + name);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO public.classroom_schema_migrations(name, sha256) VALUES ($1, $2)",
          [name, sha],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    await client.query("SELECT pg_advisory_unlock(964082014)");
    completed = true;
    return names;
  } finally {
    client.release(!completed);
  }
}
