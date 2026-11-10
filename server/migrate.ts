import { openClassroomPool } from "./database.ts";
import { migrateClassroom } from "./migrations.ts";

const url = process.env.CLASSROOM_MIGRATION_URL;
if (!url) {
  console.error("CLASSROOM_MIGRATION_URL must be configured for the database migration role.");
  process.exitCode = 1;
} else {
  const pool = openClassroomPool(url);
  try {
    const names = await migrateClassroom(pool);
    console.log("Classroom schema is current: " + names.join(", "));
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    console.error("Classroom migration stopped without applying a partial version.",
      typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? "PostgreSQL code " + code : "");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
