import { buildClassroomApp } from "./app.ts";
import { loadClassroomConfig } from "./config.ts";
import { assertClassroomDatabase, openClassroomPool } from "./database.ts";

async function main() {
  const config = loadClassroomConfig();
  const pool = openClassroomPool(config.databaseUrl);
  // Pool errors can contain connection details. Only the state is logged.
  pool.on("error", () => console.error("An idle classroom database connection closed."));
  try {
    await assertClassroomDatabase(pool);
    const app = await buildClassroomApp(config, { pool });
    try {
      await app.listen({ host: config.host, port: config.port });
      console.log(`Classroom server listening on ${config.host}:${config.port}.`);
    } catch (error) {
      await app.close();
      throw error;
    }
    let closing = false;
    const stop = async () => {
      if (closing) return;
      closing = true;
      try { await app.close(); }
      finally { await pool.end(); }
    };
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        void stop().catch(() => { process.exitCode = 1; });
      });
    }
  } catch {
    await pool.end();
    throw new Error("Classroom startup failed. Check the restricted database role, migrations and bind address.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Classroom startup failed.");
  process.exitCode = 1;
});
