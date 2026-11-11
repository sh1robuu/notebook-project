import type { PoolClient } from "pg";
import type { FastifyRequest } from "fastify";
import {
  assertMutation,
  authenticateParticipant,
  authenticateTeacher,
} from "../auth/index.ts";
import { cookieHash } from "../auth/sessions.ts";
import { RoomError, type RoomState } from "./model.ts";
import {
  activeParticipant,
  expiredSession,
  missingRoom,
  roomRow,
  setScope,
} from "./store.ts";

export type ParticipationActor = {
  kind: "teacher" | "participant" | "capture";
  id: string;
  roomId: string;
  csrfToken: string;
  grantId?: string;
  roomState?: RoomState;
};
type Authorization = { roomId?: string; mutation?: boolean; capture?: boolean };

export async function authorizeParticipation(
  db: PoolClient,
  request: FastifyRequest,
  origin: string,
  { roomId, mutation, capture }: Authorization,
): Promise<ParticipationActor> {
  let actor: ParticipationActor;
  if (capture) {
    const hash = cookieHash(request, origin, "capture");
    if (!hash) return expiredSession();
    await setScope(db, { actor: "capture-session", captureHash: hash });
    const {
      rows: [session],
    } = await db.query<{
      id: string;
      room_id: string;
      grant_id: string;
      csrf_token: string;
    }>(
      `SELECT id,room_id,grant_id,csrf_token FROM public.classroom_capture_sessions
        WHERE token_hash=$1 AND expires_at > statement_timestamp()`,
      [hash],
    );
    if (!session) return expiredSession();
    await setScope(db, {
      actor: "capture",
      actorId: session.id,
      roomId: session.room_id,
      captureGrantId: session.grant_id,
    });
    const {
      rows: [status],
    } = await db.query<{ allowed: boolean }>(
      "SELECT public.classroom_s10_capture($1) AS allowed",
      [session.room_id],
    );
    if (!status?.allowed) return expiredSession();
    actor = {
      kind: "capture",
      id: session.id,
      roomId: session.room_id,
      grantId: session.grant_id,
      csrfToken: session.csrf_token,
    };
  } else if (roomId) {
    const session = await authenticateTeacher(db, request, origin);
    if (!session) return expiredSession();
    if (session.entitlement !== "active")
      throw new RoomError(
        403,
        "entitlement_required",
        "Classroom access is unavailable for this account.",
      );
    await setScope(db, { actor: "teacher", actorId: session.id, roomId });
    const room = await roomRow(db, roomId);
    if (!room || room.owner_id !== session.id) return missingRoom();
    actor = {
      kind: "teacher",
      id: session.id,
      roomId,
      csrfToken: session.csrfToken,
      roomState: room.state,
    };
  } else {
    const session = await authenticateParticipant(db, request, origin);
    if (!session) return expiredSession();
    await setScope(db, {
      actor: "participant",
      actorId: session.id,
      roomId: session.roomId,
    });
    const room = await roomRow(db, session.roomId);
    if (!room || room.state === "archived") return expiredSession();
    await activeParticipant(db, session.roomId, session.id);
    actor = {
      kind: "participant",
      id: session.id,
      roomId: session.roomId,
      csrfToken: session.csrfToken,
      roomState: room.state,
    };
  }
  if (mutation) assertMutation(request, origin, actor.csrfToken);
  return actor;
}

export async function authorizeMediaRead(
  db: PoolClient,
  actor: ParticipationActor,
  mediaId: string,
) {
  const {
    rows: [allowed],
  } = await db.query<{ allowed: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM public.classroom_media m
      WHERE m.room_id=$1 AND m.id=$2 AND m.state='finalized' AND m.attached_at IS NOT NULL
        AND (
          EXISTS(SELECT 1 FROM public.classroom_product_media j JOIN public.classroom_products p
            ON p.room_id=j.room_id AND p.id=j.product_id
            WHERE j.room_id=m.room_id AND j.media_id=m.id AND p.removed_at IS NULL)
          OR EXISTS(SELECT 1 FROM public.classroom_captures c WHERE c.room_id=m.room_id AND c.media_id=m.id)
        )
    ) AS allowed`,
    [actor.roomId, mediaId],
  );
  if (!allowed?.allowed)
    throw new RoomError(
      404,
      "media_not_found",
      "Classroom media is unavailable.",
    );
}
