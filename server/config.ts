import { isIP } from "node:net";

const apiPrefix = "/api/classroom";
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isClassroomRequest(url: string) {
  const path = url.split("?", 1)[0];
  return path === apiPrefix || path.startsWith(apiPrefix + "/");
}

export function isClassroomMutation(method: string, url: string) {
  return isClassroomRequest(url) && !["GET", "HEAD", "OPTIONS"].includes(method);
}

export type ClassroomConfig = {
  origin: string;
  host: string;
  port: number;
  databaseUrl: string;
  google: { clientId: string; clientSecret: string };
  roomSecret: string;
  serveDist: boolean;
  trustedProxies: string[];
};

function value(env: NodeJS.ProcessEnv, name: string) {
  const result = env[name]?.trim();
  if (!result) throw new Error(name + " must be configured.");
  return result;
}

function urlSetting(input: string, name: string) {
  try {
    return new URL(input);
  } catch {
    throw new Error(name + " must be a valid URL.");
  }
}

export function loadClassroomConfig(env: NodeJS.ProcessEnv = process.env): ClassroomConfig {
  const origin = value(env, "CLASSROOM_ORIGIN");
  const publicUrl = urlSetting(origin, "CLASSROOM_ORIGIN");
  if (origin !== publicUrl.origin) throw new Error("CLASSROOM_ORIGIN must be a canonical origin without a path.");
  if (publicUrl.protocol !== "https:" &&
    (env.NODE_ENV === "production" || publicUrl.protocol !== "http:" || !loopback.has(publicUrl.hostname)))
    throw new Error("CLASSROOM_ORIGIN requires HTTPS except on development loopback.");

  const databaseUrl = value(env, "CLASSROOM_DATABASE_URL");
  const database = urlSetting(databaseUrl, "CLASSROOM_DATABASE_URL");
  if (!["postgresql:", "postgres:"].includes(database.protocol) || database.username !== "lessonboard_app")
    throw new Error("CLASSROOM_DATABASE_URL must connect as lessonboard_app.");
  if (env.NODE_ENV === "production" &&
    (database.searchParams.getAll("sslmode").join() !== "verify-full" || database.searchParams.has("uselibpqcompat")))
    throw new Error("Production CLASSROOM_DATABASE_URL must use sslmode=verify-full.");

  const roomSecret = value(env, "CLASSROOM_ROOM_SECRET");
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(roomSecret))
    throw new Error("CLASSROOM_ROOM_SECRET must contain at least 32 random bytes encoded as base64url.");
  const host = env.CLASSROOM_BIND_HOST?.trim() || (env.RENDER === "true" ? "0.0.0.0" : "127.0.0.1");
  if (!isIP(host)) throw new Error("CLASSROOM_BIND_HOST must be an IP address.");
  const port = Number(env.PORT ?? env.CLASSROOM_PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT or CLASSROOM_PORT must be a valid port.");
  const serveDist = env.CLASSROOM_SERVE_DIST ?? "false";
  if (!["true", "false"].includes(serveDist)) throw new Error("CLASSROOM_SERVE_DIST must be true or false.");
  const proxySetting = env.CLASSROOM_TRUST_PROXIES?.trim();
  const trustedProxies = proxySetting ? proxySetting.split(",").map((ip) => ip.trim()) : [];
  if (trustedProxies.some((ip) => !isIP(ip))) throw new Error("CLASSROOM_TRUST_PROXIES must list exact proxy IP addresses.");

  return {
    origin,
    host,
    port,
    databaseUrl,
    roomSecret,
    serveDist: serveDist === "true",
    trustedProxies,
    google: {
      clientId: value(env, "CLASSROOM_GOOGLE_CLIENT_ID"),
      clientSecret: value(env, "CLASSROOM_GOOGLE_CLIENT_SECRET"),
    },
  };
}
