import type { Pool } from "pg";
import { openClassroomPool } from "../database.ts";
import { normalizeNeonUrl } from "./neon.ts";

/** Explicit operator fallback for networks blocking PostgreSQL TCP port 5432. */
export async function openClassroomAdminPool(
  connectionString: string,
  options: { websocket: boolean },
): Promise<Pool> {
  if (!options.websocket) return openClassroomPool(connectionString);
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
    throw new Error("Neon administration requires TLS verification to remain enabled.");
  if (typeof globalThis.WebSocket !== "function")
    throw new Error("Neon WebSocket administration requires the built-in Node 24 WebSocket.");
  const verified = normalizeNeonUrl(connectionString);
  const { Pool: NeonPool, neonConfig } = await import("@neondatabase/serverless");
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  neonConfig.useSecureWebSocket = true;
  // Official Neon WSS mode uses its verified TLS tunnel instead of a second
  // PostgreSQL TLS layer. Native production pg retains its own TLS settings.
  neonConfig.forceDisablePgSSL = true;
  neonConfig.poolQueryViaFetch = false;
  neonConfig.pipelineConnect = false;
  const pool = new NeonPool({
    connectionString: verified,
    max: 2,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 2_000,
  });
  // Neon documents this Pool as the pg-compatible session/transaction adapter.
  // Its bundled pg type version differs from this project's pg type package.
  return pool as unknown as Pool;
}
