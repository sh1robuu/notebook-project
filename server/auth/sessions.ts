import "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { digestSecret, newSecret, validSecret } from "./security.ts";

type Cookie = "oauth" | "teacher" | "participant";
type Database = Pick<Pool, "query">;

export type Entitlement = "active" | "trial" | "expired" | "suspended" | "unknown";
export type TeacherActor = {
  id: string;
  displayName: string;
  email?: string;
  entitlement: Entitlement;
  csrfToken: string;
};
export type ParticipantActor = { id: string; roomId: string; csrfToken: string };

const teacherLifetime = 8 * 60 * 60;
const participantLifetime = 12 * 60 * 60;

function cookieScope(kind: Cookie, origin: string) {
  const secure = origin.startsWith("https://");
  return {
    name: (secure ? "__Host-lessonboard-" : "lessonboard-local-") + kind,
    options: { httpOnly: true, secure, sameSite: "lax" as const, path: "/" },
  };
}

export function cookieHash(request: FastifyRequest, origin: string, kind: Cookie) {
  const cookie = request.cookies[cookieScope(kind, origin).name];
  return validSecret(cookie) ? digestSecret(cookie) : null;
}

export function setCookie(reply: FastifyReply, origin: string, kind: Cookie, token: string, maxAge: number) {
  const { name, options } = cookieScope(kind, origin);
  reply.setCookie(name, token, { ...options, maxAge });
}

export function clearCookie(reply: FastifyReply, origin: string, kind: Cookie) {
  const { name, options } = cookieScope(kind, origin);
  reply.clearCookie(name, options);
}

type TeacherSession =
  | { status: "signed-out" | "expired" | "revoked" }
  | { status: "active"; actor: TeacherActor; tokenHash: string };

export async function readTeacherSession(db: Database, request: FastifyRequest, origin: string): Promise<TeacherSession> {
  const tokenHash = cookieHash(request, origin, "teacher");
  if (!tokenHash) return { status: "signed-out" };
  const { rows } = await db.query<{
    id: string;
    display_name: string;
    verified_email: string | null;
    account_status: string;
    entitlement: Entitlement;
    csrf_token: string;
    revoked: boolean;
    expired: boolean;
  }>(
    `SELECT u.id, u.display_name, u.verified_email, u.account_status, u.entitlement,
       s.csrf_token, s.revoked_at IS NOT NULL AS revoked,
       s.expires_at <= statement_timestamp() AS expired
     FROM public.classroom_sessions s
     JOIN public.classroom_users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return { status: "signed-out" };
  if (row.revoked || row.account_status !== "active") return { status: "revoked" };
  if (row.expired) return { status: "expired" };
  return {
    status: "active",
    tokenHash,
    actor: {
      id: row.id,
      displayName: row.display_name,
      ...(row.verified_email === null ? {} : { email: row.verified_email }),
      entitlement: row.entitlement,
      csrfToken: row.csrf_token,
    },
  };
}

export async function authenticateTeacher(db: Database, request: FastifyRequest, origin: string) {
  const session = await readTeacherSession(db, request, origin);
  return session.status === "active" ? session.actor : null;
}

export async function authenticateParticipant(db: Database, request: FastifyRequest, origin: string): Promise<ParticipantActor | null> {
  const tokenHash = cookieHash(request, origin, "participant");
  if (!tokenHash) return null;
  const { rows } = await db.query<ParticipantActor>(
    `SELECT participant_id AS id, room_id AS "roomId", csrf_token AS "csrfToken"
     FROM public.classroom_participant_sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > statement_timestamp()`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function createParticipantSession(
  db: Database,
  reply: FastifyReply,
  input: { participantId: string; roomId: string; origin: string },
) {
  const token = newSecret(), csrfToken = newSecret();
  await db.query(
    `INSERT INTO public.classroom_participant_sessions
       (token_hash, room_id, participant_id, csrf_token, expires_at)
     VALUES ($1, $2, $3, $4, statement_timestamp() + $5 * interval '1 second')`,
    [digestSecret(token), input.roomId, input.participantId, csrfToken, participantLifetime],
  );
  return {
    csrfToken,
    commitCookie() {
      setCookie(reply, input.origin, "participant", token, participantLifetime);
    },
  };
}

export async function revokeTeacherSession(db: Database, tokenHash: string) {
  await db.query(
    `UPDATE public.classroom_sessions SET revoked_at = statement_timestamp()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
}

export async function revokeParticipantSession(db: Database, tokenHash: string) {
  await db.query(
    `UPDATE public.classroom_participant_sessions SET revoked_at = statement_timestamp()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
}

export async function createTeacherSession(db: Database, userId: string) {
  const token = newSecret();
  await db.query(
    `INSERT INTO public.classroom_sessions (token_hash, user_id, csrf_token, expires_at)
     VALUES ($1, $2, $3, statement_timestamp() + $4 * interval '1 second')`,
    [digestSecret(token), userId, newSecret(), teacherLifetime],
  );
  return { token, lifetime: teacherLifetime };
}
