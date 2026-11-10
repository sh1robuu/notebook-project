import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { Pool } from "pg";
import type { Configuration } from "openid-client";
import { registerAuth } from "./auth/index.ts";
import { registerRoomRoutes } from "./rooms/index.ts";
import { isClassroomMutation, isClassroomRequest } from "./config.ts";
import type { ClassroomConfig } from "./config.ts";
import { assertClassroomDatabase } from "./database.ts";
import { registerClassroomSite } from "./site.ts";

export async function buildClassroomApp(
  config: ClassroomConfig,
  dependencies: { pool: Pool; oidcConfiguration?: () => Promise<Configuration>; dist?: string },
) {
  const app = Fastify({
    bodyLimit: 16_384,
    requestTimeout: 30_000,
    trustProxy: config.trustedProxies.length ? config.trustedProxies : false,
    logger: false,
  });
  app.addHook("onRequest", async (request, reply) => {
    if (!isClassroomRequest(request.url)) return;
    reply.headers({
      "Cache-Control": "private, no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
    if (isClassroomMutation(request.method, request.url) && request.headers.origin !== config.origin) {
      return reply.code(403).send({ error: "origin", message: "The request must originate from Lessonboard." });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const { statusCode, code, validation, message } = error as Error & {
      statusCode?: number;
      code?: string;
      validation?: unknown;
    };
    const status = statusCode && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    if (status === 500)
      return reply.code(500).send({ error: "internal", message: "Classroom service could not complete the request." });
    if (validation || !code || /^FST_/.test(code)) {
      const detail = status === 429 ? "Too many requests. Try again shortly." : "Invalid classroom request.";
      return reply.code(status).send({ error: status === 429 ? "rate_limit" : "invalid_request", message: detail });
    }
    return reply.code(status).send({ error: code, message });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: "not_found", message: "Classroom resource not found." }),
  );
  try {
    await app.register(cookie);
    await app.register(rateLimit, { global: false, cache: 10_000 });
    app.get("/api/classroom/health", async () => ({ status: "ok" }));
    app.get("/api/classroom/ready", async (_request, reply) => {
      try {
        await assertClassroomDatabase(dependencies.pool);
        return { status: "ready" };
      } catch {
        return reply.code(503).send({ status: "unavailable" });
      }
    });
    await registerAuth(app, {
      pool: dependencies.pool,
      origin: config.origin,
      google: config.google,
      oidcConfiguration: dependencies.oidcConfiguration,
    });
    await registerRoomRoutes(app, {
      pool: dependencies.pool,
      origin: config.origin,
      secret: config.roomSecret,
    });
    if (config.serveDist) await registerClassroomSite(app, dependencies.dist ?? "dist");
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
