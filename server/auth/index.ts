import type { FastifyInstance } from "fastify";
import * as oidc from "openid-client";
import type { Pool } from "pg";
import { assertMutation, digestSecret, equalSecret, newSecret } from "./security.ts";
import {
  clearCookie,
  cookieHash,
  createTeacherSession,
  readTeacherSession,
  revokeParticipantSession,
  revokeTeacherSession,
  setCookie,
} from "./sessions.ts";

export { assertMutation } from "./security.ts";
export { authenticateTeacher, authenticateParticipant, createParticipantSession } from "./sessions.ts";
export type { TeacherActor, ParticipantActor, Entitlement } from "./sessions.ts";

const base = "/api/classroom/auth";
const callbackPath = base + "/google/callback";
const attemptLifetime = 10 * 60;
const googleIssuer = new URL("https://accounts.google.com");

export type AuthOptions = {
  pool: Pool;
  origin: string;
  google: { clientId: string; clientSecret: string };
  // Tests can exercise the real token exchange against a signed loopback issuer.
  oidcConfiguration?: () => Promise<oidc.Configuration>;
};

type Identity = { issuer: string; subject: string; displayName: string; email: string | null };

function googleIdentity(claims: oidc.IDToken, issuer: string): Identity {
  if (claims.iss !== issuer || !/^[\x21-\x7e]{1,255}$/.test(claims.sub))
    throw new Error("The provider returned an invalid account identity.");
  const rawName = typeof claims.name === "string" ? claims.name : "";
  const displayName = Array.from(rawName.normalize("NFC").replace(/\p{Cc}|\p{Cf}/gu, "").trim()).slice(0, 120).join("") || "Giáo viên";
  const email =
    claims.email_verified === true &&
    typeof claims.email === "string" &&
    /^[^\s\x00@]+@[^\s\x00@]+$/.test(claims.email) &&
    Array.from(claims.email).length <= 254 ? claims.email : null;
  return { issuer, subject: claims.sub, displayName, email };
}

async function commitTeacherLogin(pool: Pool, identity: Identity, oldToken: string | null, participantToken: string | null) {
  const db = await pool.connect();
  let discard = false;
  try {
    await db.query("BEGIN");
    const { rows } = await db.query<{ id: string; account_status: string }>(
      `INSERT INTO public.classroom_users (provider_issuer, provider_subject, display_name, verified_email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider_issuer, provider_subject) DO UPDATE
       SET display_name = excluded.display_name, verified_email = excluded.verified_email,
         updated_at = statement_timestamp()
       RETURNING id, account_status`,
      [identity.issuer, identity.subject, identity.displayName, identity.email],
    );
    if (rows[0].account_status !== "active") throw new Error("This account is disabled.");
    if (oldToken) await revokeTeacherSession(db, oldToken);
    if (participantToken) await revokeParticipantSession(db, participantToken);
    const session = await createTeacherSession(db, rows[0].id);
    await db.query("COMMIT");
    return session;
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    db.release(discard);
  }
}

export function registerAuth(app: FastifyInstance, { pool, origin, google, oidcConfiguration }: AuthOptions) {
  const address = new URL(origin);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(address.hostname);
  if (address.origin !== origin || (address.protocol !== "https:" && !(address.protocol === "http:" && loopback)))
    throw new Error("Classroom authentication requires an exact HTTPS origin or HTTP loopback.");
  if (!google.clientId.trim() || !google.clientSecret.trim())
    throw new Error("Google authentication requires a client ID and client secret.");

  const redirectUri = origin + callbackPath;
  let configuration: Promise<oidc.Configuration> | undefined;
  const getConfiguration = () => configuration ??= (async () => {
    const config = await (oidcConfiguration
      ? oidcConfiguration()
      : oidc.discovery(
        googleIssuer,
        google.clientId,
        { client_secret: google.clientSecret, id_token_signed_response_alg: "RS256" },
        oidc.ClientSecretPost(google.clientSecret),
      ));
    oidc.enableNonRepudiationChecks(config);
    return config;
  })().catch((error: unknown) => {
    configuration = undefined;
    throw error;
  });

  const rateLimit = { max: 12, timeWindow: "1 minute" };
  app.get(base + "/google", { config: { rateLimit } }, async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    try {
      const config = await getConfiguration();
      const token = newSecret(), state = newSecret(), nonce = newSecret();
      const verifier = oidc.randomPKCECodeVerifier();
      const challenge = await oidc.calculatePKCECodeChallenge(verifier);
      const authorization = oidc.buildAuthorizationUrl(config, {
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "openid profile email",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      await pool.query(
        `DELETE FROM public.classroom_oauth_attempts
         WHERE token_hash = $1 OR token_hash IN (
           SELECT token_hash FROM public.classroom_oauth_attempts
           WHERE expires_at <= statement_timestamp() ORDER BY expires_at LIMIT 128
         )`,
        [cookieHash(request, origin, "oauth")],
      );
      await pool.query(
        `INSERT INTO public.classroom_oauth_attempts (token_hash, oauth_state, nonce, verifier, expires_at)
         VALUES ($1, $2, $3, $4, statement_timestamp() + $5 * interval '1 second')`,
        [digestSecret(token), state, nonce, verifier, attemptLifetime],
      );
      setCookie(reply, origin, "oauth", token, attemptLifetime);
      return reply.code(302).redirect(authorization.href);
    } catch {
      return reply.code(303).redirect("/classroom?auth=failed");
    }
  });

  app.get(callbackPath, { config: { rateLimit } }, async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    clearCookie(reply, origin, "oauth");
    try {
      const tokenHash = cookieHash(request, origin, "oauth");
      if (!tokenHash) return reply.code(303).redirect("/classroom?auth=failed");
      const { rows } = await pool.query<{ oauth_state: string; nonce: string; verifier: string }>(
        `DELETE FROM public.classroom_oauth_attempts
         WHERE token_hash = $1 AND expires_at > statement_timestamp()
         RETURNING oauth_state, nonce, verifier`,
        [tokenHash],
      );
      const attempt = rows[0];
      const callback = new URL(redirectUri);
      const queryAt = request.url.indexOf("?");
      if (!attempt || queryAt < 0 || request.url.length - queryAt > 8192)
        return reply.code(303).redirect("/classroom?auth=failed");
      callback.search = request.url.slice(queryAt);
      const params = callback.searchParams;
      if (params.getAll("state").length !== 1 || !equalSecret(params.get("state"), attempt.oauth_state))
        return reply.code(303).redirect("/classroom?auth=failed");
      if (params.getAll("error").length === 1 && params.get("error") === "access_denied" && !params.has("code"))
        return reply.code(303).redirect("/classroom?auth=cancelled");
      if (params.getAll("code").length !== 1 || params.has("error"))
        return reply.code(303).redirect("/classroom?auth=failed");

      const config = await getConfiguration();
      const tokens = await oidc.authorizationCodeGrant(config, callback, {
        expectedState: attempt.oauth_state,
        expectedNonce: attempt.nonce,
        pkceCodeVerifier: attempt.verifier,
      });
      const claims = tokens.claims();
      if (!claims) return reply.code(303).redirect("/classroom?auth=failed");
      const identity = googleIdentity(claims, config.serverMetadata().issuer);
      const session = await commitTeacherLogin(
        pool, identity, cookieHash(request, origin, "teacher"), cookieHash(request, origin, "participant"),
      );
      setCookie(reply, origin, "teacher", session.token, session.lifetime);
      clearCookie(reply, origin, "participant");
      return reply.code(303).redirect("/classroom");
    } catch {
      // OAuth state, provider responses and database errors are never returned.
      return reply.code(303).redirect("/classroom?auth=failed");
    }
  });

  app.get(base + "/session", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const session = await readTeacherSession(pool, request, origin);
    if (session.status !== "active") return { teacher: null, status: session.status };
    const { csrfToken, ...teacher } = session.actor;
    return { teacher, csrfToken, status: "active" };
  });

  app.post(base + "/logout", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    assertMutation(request, origin);
    const session = await readTeacherSession(pool, request, origin);
    if (session.status === "active") {
      assertMutation(request, origin, session.actor.csrfToken);
    }
    const participantToken = cookieHash(request, origin, "participant");
    const oauthToken = cookieHash(request, origin, "oauth");
    const db = await pool.connect();
    let discard = false;
    try {
      await db.query("BEGIN");
      if (session.status === "active") await revokeTeacherSession(db, session.tokenHash);
      if (participantToken) await revokeParticipantSession(db, participantToken);
      if (oauthToken) await db.query("DELETE FROM public.classroom_oauth_attempts WHERE token_hash = $1", [oauthToken]);
      await db.query("COMMIT");
    } catch (error) {
      try { await db.query("ROLLBACK"); }
      catch { discard = true; }
      throw error;
    } finally { db.release(discard); }
    clearCookie(reply, origin, "teacher");
    clearCookie(reply, origin, "participant");
    clearCookie(reply, origin, "oauth");
    return reply.code(204).send();
  });
}
