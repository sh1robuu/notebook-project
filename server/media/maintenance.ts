import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "../rooms/store.ts";
import type { MediaStore } from "./store.ts";

type Deletion = {
  room_id: string;
  id: string;
  object_key: string | null;
  thumbnail_key: string | null;
};

const unreferenced = `NOT EXISTS (SELECT 1 FROM public.classroom_product_media p WHERE p.room_id=m.room_id AND p.media_id=m.id)
  AND NOT EXISTS (SELECT 1 FROM public.classroom_captures c WHERE c.room_id=m.room_id AND c.media_id=m.id)
  AND NOT EXISTS (SELECT 1 FROM public.classroom_board_insertions i WHERE i.room_id=m.room_id AND i.media_id=m.id)`;

export async function pruneStoredMedia(
  pool: Pool,
  {
    archivedRooms,
    roomId,
    store,
  }: { archivedRooms: string[]; roomId?: string; store?: MediaStore },
) {
  const claim = randomUUID();
  const { rows } = await pool.query<Deletion>(
    `WITH eligible AS (
       SELECT m.room_id,m.id FROM public.classroom_media m
       WHERE ($2::uuid IS NULL OR m.room_id=$2)
         AND m.state<>'deleted'
         AND ($3::boolean OR (m.object_key IS NULL AND m.thumbnail_key IS NULL))
         AND (m.state NOT IN ('processing','deleting') OR m.process_token IS NULL
           OR m.updated_at<statement_timestamp()-interval '2 minutes')
         AND (m.room_id=ANY($1::uuid[]) OR
           (m.attached_at IS NULL AND m.expires_at<statement_timestamp() AND ${unreferenced}))
       ORDER BY m.updated_at,m.room_id,m.id LIMIT 200 FOR UPDATE OF m SKIP LOCKED
     )
     UPDATE public.classroom_media m SET state='deleting',process_token=$4,
       attached_at=NULL,updated_at=statement_timestamp()
     FROM eligible e WHERE m.room_id=e.room_id AND m.id=e.id
     RETURNING m.room_id,m.id,m.object_key,m.thumbnail_key`,
    [archivedRooms, roomId ?? null, !!store, claim],
  );

  const completed: Deletion[] = [];
  for (const row of rows) {
    const keys = [row.object_key, row.thumbnail_key].filter(
      (key): key is string => key !== null,
    );
    if (keys.length) {
      const results = await Promise.allSettled(
        keys.map((key) => store!.delete(key)),
      );
      if (results.some((result) => result.status === "rejected")) break;
    }
    completed.push(row);
  }

  await transaction(pool, async (db) => {
    if (completed.length) {
      await db.query(
        `UPDATE public.classroom_media m
         SET state='deleted',process_token=NULL,object_key=NULL,thumbnail_key=NULL,
           image_bytes=NULL,thumbnail_bytes=NULL,width=NULL,height=NULL,sha256=NULL,updated_at=statement_timestamp()
         FROM unnest($2::uuid[],$3::uuid[]) AS done(room_id,id)
         WHERE m.room_id=done.room_id AND m.id=done.id AND m.process_token=$1`,
        [
          claim,
          completed.map((row) => row.room_id),
          completed.map((row) => row.id),
        ],
      );
    }
    // A failed deletion retains its keys, so the next owner run can resume it.
    await db.query(
      "UPDATE public.classroom_media SET process_token=NULL WHERE process_token=$1",
      [claim],
    );
    await db.query(
      `DELETE FROM public.classroom_media m WHERE m.state='deleted'
         AND ($1::uuid IS NULL OR m.room_id=$1)
         AND m.updated_at<statement_timestamp()-interval '1 day' AND ${unreferenced}`,
      [roomId ?? null],
    );
  });

  return {
    deletedMedia: completed.length,
    deferredMedia: rows.length - completed.length,
  };
}
