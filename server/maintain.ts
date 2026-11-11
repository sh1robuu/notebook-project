import { openClassroomPool } from "./database.ts";
import { pruneClassroomData } from "./maintenance.ts";
import { createMediaStore, loadMediaConfig } from "./media/store.ts";

const url = process.env.CLASSROOM_MIGRATION_URL;
if (!url) {
  console.error("CLASSROOM_MIGRATION_URL is required for owner-run retention maintenance.");
  process.exitCode = 1;
} else {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some(value => value !== "--apply" && !/^--room=[a-f0-9-]+$/i.test(value)))
    throw new Error("Only --apply and --room=<UUID> are supported.");
  const roomId = arguments_.find(value => value.startsWith("--room="))?.slice(7);
  const pool = openClassroomPool(url);
  try {
    const apply = arguments_.includes("--apply");
    const result = await pruneClassroomData(pool, {
      retentionDays: Number(process.env.CLASSROOM_ARCHIVED_RETENTION_DAYS ?? "30"),
      apply,
      roomId,
      mediaStore: apply ? createMediaStore(loadMediaConfig()) : undefined,
    });
    console.log(JSON.stringify(result));
    if (apply && (result.deferredMedia || result.purgedRooms < result.eligibleRooms.length))
      process.exitCode = 1;
  } catch {
    console.error("Classroom maintenance did not complete. Rerun it to retry pending deletions.");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
