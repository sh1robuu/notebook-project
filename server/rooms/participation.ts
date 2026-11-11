import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { setCookie } from "../auth/sessions.ts";
import { assertMutation, digestSecret, newSecret } from "../auth/security.ts";
import { RoomError, uuid } from "./model.ts";
import { authorizeParticipation } from "./participation-auth.ts";
import { executeParticipation } from "./participation-commands.ts";
import {
  parseCaptureCode,
  parseCaptureCommand,
  parseStudentParticipation,
  parseTeacherParticipation,
} from "./participation-model.ts";
import {
  captureSessionView,
  participationView,
  targetView,
  teacherParticipationView,
  type GrantRow,
} from "./participation-store.ts";
import { setScope, transaction } from "./store.ts";

type Options = { pool: Pool; origin: string; secret: string };
const base = "/api/classroom";

function rateLimit(max: number) {
  return { config: { rateLimit: { max, timeWindow: "1 minute" } } };
}

export function registerParticipationRoutes(
  app: FastifyInstance,
  { pool, origin, secret }: Options,
) {
  app.get<{ Params: { id: string } }>(
    base + "/rooms/:id/participation",
    rateLimit(600),
    async (request) => {
      const roomId = uuid(request.params.id);
      return transaction(
        pool,
        async (db) => {
          const actor = await authorizeParticipation(db, request, origin, {
            roomId,
          });
          return {
            participation: await teacherParticipationView(db, actor, secret),
          };
        },
        true,
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    base + "/rooms/:id/participation/commands",
    {
      ...rateLimit(300),
      bodyLimit: 40_000,
    },
    async (request) => {
      const roomId = uuid(request.params.id);
      const key = uuid(request.headers["idempotency-key"]);
      const command = parseTeacherParticipation(request.body);
      return transaction(pool, async (db) => {
        const actor = await authorizeParticipation(db, request, origin, {
          roomId,
          mutation: true,
        });
        const receipt = await executeParticipation(
          db,
          actor,
          key,
          command,
          secret,
        );
        return {
          receipt,
          participation: await teacherParticipationView(db, actor, secret),
        };
      });
    },
  );

  app.get(
    base + "/participant/participation",
    rateLimit(1200),
    async (request) =>
      transaction(
        pool,
        async (db) => {
          const actor = await authorizeParticipation(db, request, origin, {});
          return {
            participation: await participationView(db, actor),
            csrfToken: actor.csrfToken,
          };
        },
        true,
      ),
  );

  app.post(
    base + "/participant/participation/commands",
    rateLimit(600),
    async (request) => {
      const key = uuid(request.headers["idempotency-key"]);
      const command = parseStudentParticipation(request.body);
      return transaction(pool, async (db) => {
        const actor = await authorizeParticipation(db, request, origin, {
          mutation: true,
        });
        const receipt = await executeParticipation(
          db,
          actor,
          key,
          command,
          secret,
        );
        return { receipt, participation: await participationView(db, actor) };
      });
    },
  );

  app.post(base + "/capture/redeem", rateLimit(30), async (request, reply) => {
    assertMutation(request, origin);
    const code = digestSecret(parseCaptureCode(request.body));
    const token = newSecret();
    const csrfToken = newSecret();
    const grant = await transaction(pool, async (db) => {
      await setScope(db, { actor: "capture-redeem", captureHash: code });
      const {
        rows: [row],
      } = await db.query<GrantRow & { max_age: number }>(
        `SELECT id, room_id, lesson_id, surface, page_id, expires_at, revoked_at,
            greatest(1,ceil(extract(epoch from expires_at-clock_timestamp())))::integer AS max_age
          FROM public.classroom_s10_redeem_capture($1,$2,$3,$4)`,
        [code, randomUUID(), digestSecret(token), csrfToken],
      );
      if (!row)
        throw new RoomError(
          404,
          "capture_unavailable",
          "This capture QR is unavailable. Ask for a new code.",
        );
      return row;
    });
    setCookie(reply, origin, "capture", token, grant.max_age);
    return reply.code(201).send({
      session: {
        grantId: grant.id,
        expiresAt: grant.expires_at.toISOString(),
        target: targetView(grant),
      },
      csrfToken,
    });
  });

  app.get(base + "/capture/session", rateLimit(180), async (request) =>
    transaction(
      pool,
      async (db) => {
        const actor = await authorizeParticipation(db, request, origin, {
          capture: true,
        });
        return {
          session: await captureSessionView(db, actor),
          csrfToken: actor.csrfToken,
        };
      },
      true,
    ),
  );

  app.post(base + "/capture/commands", rateLimit(90), async (request) => {
    const key = uuid(request.headers["idempotency-key"]);
    const command = parseCaptureCommand(request.body);
    return transaction(pool, async (db) => {
      const actor = await authorizeParticipation(db, request, origin, {
        capture: true,
        mutation: true,
      });
      const receipt = await executeParticipation(
        db,
        actor,
        key,
        command,
        secret,
      );
      return { receipt, session: await captureSessionView(db, actor) };
    });
  });
}
