import { setTimeout as delay } from "node:timers/promises";
import type { OutgoingHttpHeaders } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import {
  assertMutation,
  authenticateParticipant,
  authenticateTeacher,
  createParticipantSession,
} from "../auth/index.ts";
import { cookieHash } from "../auth/sessions.ts";
import {
  RoomError,
  parseCommand,
  parseJoin,
  parseRoom,
  replayCursor,
  uuid,
} from "./model.ts";
import { commandRoom, createRoom, joinRoom } from "./mutations.ts";
import {
  expiredSession,
  missingRoom,
  participantRoom,
  pollRoom,
  roomRow,
  setScope,
  teacherRoom,
  teacherRooms,
  transaction,
} from "./store.ts";
import type { ReplayEvent } from "./store.ts";

type RoomOptions = {
  pool: Pool;
  origin: string;
  secret: string;
  inviteTtlSeconds?: number;
};

const base = "/api/classroom";
type RoomParams = { id: string };
type ReplayQuery = { after?: string };
const realtimeLimit = 1500;

function rateLimit(max: number) {
  return { config: { rateLimit: { max, timeWindow: "1 minute" } } };
}

function noStore(reply: FastifyReply) {
  reply.header("Cache-Control", "private, no-store");
  reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function payloadFormat(revision: number) {
  return JSON.stringify({ revision });
}

function streamMessage(event: ReplayEvent) {
  return `id: ${event.revision}\nevent: ${event.event}\ndata: ${payloadFormat(event.revision)}\n\n`;
}

export function registerRoomRoutes(
  app: FastifyInstance,
  { pool, origin, secret, inviteTtlSeconds = 24 * 60 * 60 }: RoomOptions,
) {
  if (
    !Number.isInteger(inviteTtlSeconds) ||
    inviteTtlSeconds < 1 ||
    inviteTtlSeconds > 7 * 24 * 60 * 60
  )
    throw new Error("Invalid classroom invitation TTL.");
  if (Buffer.byteLength(secret) < 32)
    throw new Error("The classroom invitation secret is too short.");

  const streams = new Set<AbortController>();
  const perActor = new Map<string, number>();
  let shuttingDown = false;
  app.addHook("preClose", async () => {
    shuttingDown = true;
    for (const stream of streams) stream.abort();
  });

  async function teacher(
    db: PoolClient,
    request: FastifyRequest,
    mutation = false,
  ) {
    const actor = await authenticateTeacher(db, request, origin);
    if (!actor) return expiredSession();
    if (actor.entitlement !== "active")
      throw new RoomError(
        403,
        "entitlement_required",
        "Classroom access is unavailable for this account.",
      );
    if (mutation) assertMutation(request, origin, actor.csrfToken);
    await setScope(db, { actor: "teacher", actorId: actor.id });
    return actor;
  }

  async function participant(db: PoolClient, request: FastifyRequest) {
    const actor = await authenticateParticipant(db, request, origin);
    if (!actor) return expiredSession();
    await setScope(db, {
      actor: "participant",
      actorId: actor.id,
      roomId: actor.roomId,
    });
    return actor;
  }

  app.get(base + "/rooms", rateLimit(600), async (request, reply) => {
    noStore(reply);
    return transaction(
      pool,
      async (db) => {
        const actor = await teacher(db, request);
        return { rooms: await teacherRooms(db, actor.id) };
      },
      true,
    );
  });

  app.post(base + "/rooms", rateLimit(180), async (request, reply) => {
    noStore(reply);
    const input = parseRoom(request.body),
      key = uuid(request.headers["idempotency-key"]);
    const result = await transaction(pool, async (db) => {
      const actor = await teacher(db, request, true);
      return createRoom(db, actor.id, key, input, secret);
    });
    return reply.code(201).send(result);
  });

  app.get<{ Params: RoomParams }>(
    base + "/rooms/:id",
    rateLimit(600),
    async (request, reply) => {
      noStore(reply);
      const id = uuid(request.params.id);
      return transaction(
        pool,
        async (db) => {
          const actor = await teacher(db, request);
          const room = await roomRow(db, id);
          if (!room || room.owner_id !== actor.id) return missingRoom();
          return { room: await teacherRoom(db, room, secret) };
        },
        true,
      );
    },
  );

  app.post<{ Params: RoomParams }>(
    base + "/rooms/:id/commands",
    rateLimit(600),
    async (request, reply) => {
      noStore(reply);
      const id = uuid(request.params.id),
        command = parseCommand(request.body);
      const key = uuid(request.headers["idempotency-key"]);
      return transaction(pool, async (db) => {
        const actor = await teacher(db, request, true);
        return commandRoom(
          db,
          actor.id,
          id,
          key,
          command,
          secret,
          inviteTtlSeconds,
        );
      });
    },
  );

  app.post(base + "/join", rateLimit(300), async (request, reply) => {
    noStore(reply);
    assertMutation(request, origin);
    const input = parseJoin(request.body),
      key = uuid(request.headers["idempotency-key"]);
    const oldSession = cookieHash(request, origin, "participant");
    const { room, session } = await transaction(pool, async (db) => {
      const { room, participantId, roomId } = await joinRoom(
        db,
        input,
        key,
        secret,
      );
      if (oldSession)
        await db.query(
          `UPDATE public.classroom_participant_sessions SET revoked_at = statement_timestamp()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
          [oldSession],
        );
      const session = await createParticipantSession(db, reply, {
        participantId,
        roomId,
        origin,
      });
      return { room, session };
    });
    session.commitCookie();
    return reply.code(201).send({ room, csrfToken: session.csrfToken });
  });

  app.get(
    base + "/participant/room",
    rateLimit(2400),
    async (request, reply) => {
      noStore(reply);
      return transaction(
        pool,
        async (db) => {
          const actor = await participant(db, request);
          return {
            room: await participantRoom(db, actor.roomId, actor.id),
            csrfToken: actor.csrfToken,
          };
        },
        true,
      );
    },
  );

  async function eventBatch(
    request: FastifyRequest,
    roomId: string | undefined,
    cursor: number | null,
  ) {
    return transaction(
      pool,
      async (db) => {
        if (roomId) {
          const actor = await teacher(db, request);
          return {
            actor: "teacher:" + actor.id,
            events: await pollRoom(db, roomId, cursor),
          };
        }
        const actor = await participant(db, request);
        return {
          actor: "participant:" + actor.roomId + ":" + actor.id,
          events: await pollRoom(db, actor.roomId, cursor, actor.id),
        };
      },
      true,
    );
  }

  async function events(
    request: FastifyRequest<{ Querystring: ReplayQuery }>,
    reply: FastifyReply,
    roomId?: string,
  ) {
    noStore(reply);
    if (request.headers.origin && request.headers.origin !== origin)
      throw new RoomError(
        403,
        "forbidden_origin",
        "This classroom request is unavailable.",
      );
    if (shuttingDown || streams.size >= realtimeLimit)
      throw new RoomError(
        503,
        "stream_busy",
        "Classroom updates are busy. Try again shortly.",
      );
    let cursor = replayCursor(
      request.headers["last-event-id"],
      request.query.after,
    );
    const first = await eventBatch(request, roomId, cursor);
    const count = perActor.get(first.actor) ?? 0;
    if (shuttingDown || streams.size >= realtimeLimit || count >= 5)
      throw new RoomError(
        503,
        "stream_busy",
        "Classroom updates are busy. Try again shortly.",
      );

    const stream = new AbortController();
    streams.add(stream);
    perActor.set(first.actor, count + 1);
    const raw = reply.raw;
    function close() {
      stream.abort();
      if (!raw.writableEnded && !raw.destroyed) raw.end();
    }
    function write(message: string) {
      if (!stream.signal.aborted && !raw.write(message)) close();
    }
    function publish(batch: ReplayEvent[]) {
      for (const event of batch) {
        write(streamMessage(event));
        cursor = event.revision;
      }
    }
    raw.once("close", close);
    stream.signal.addEventListener("abort", close, { once: true });
    try {
      reply.hijack();
      const headers = {
        ...reply.getHeaders(),
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "private, no-store, no-transform",
        connection: "close",
        "x-accel-buffering": "no",
      } as OutgoingHttpHeaders;
      raw.writeHead(200, headers);
      raw.flushHeaders();
      write("retry: 1500\nevent: heartbeat\ndata: {}\n\n");
      publish(first.events);
      let nextHeartbeat = Date.now() + 10_000;
      while (!stream.signal.aborted) {
        await delay(1000, undefined, { signal: stream.signal, ref: false });
        const batch = await eventBatch(request, roomId, cursor);
        publish(batch.events);
        if (Date.now() >= nextHeartbeat) {
          write("event: heartbeat\ndata: {}\n\n");
          nextHeartbeat = Date.now() + 10_000;
        }
      }
    } catch (error) {
      if (
        error instanceof RoomError &&
        [401, 403, 404].includes(error.statusCode)
      )
        write('event: authorization\ndata: {"error":"session_expired"}\n\n');
      // Other failures close the stream. The client retries from its durable cursor.
    } finally {
      close();
      raw.removeListener("close", close);
      streams.delete(stream);
      const remaining = (perActor.get(first.actor) ?? 1) - 1;
      if (remaining > 0) perActor.set(first.actor, remaining);
      else perActor.delete(first.actor);
    }
  }

  app.get<{ Params: RoomParams; Querystring: ReplayQuery }>(
    base + "/rooms/:id/events",
    rateLimit(2400),
    (request, reply) => events(request, reply, uuid(request.params.id)),
  );
  app.get<{ Querystring: ReplayQuery }>(
    base + "/participant/events",
    rateLimit(2400),
    (request, reply) => events(request, reply),
  );
}
