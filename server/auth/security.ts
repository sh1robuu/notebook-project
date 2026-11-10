import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

const secretPattern = /^[A-Za-z0-9_-]{43}$/;

export function newSecret() {
  return randomBytes(32).toString("base64url");
}

export function validSecret(value: unknown): value is string {
  return typeof value === "string" && secretPattern.test(value);
}

export function digestSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function equalSecret(value: unknown, expected: string) {
  return (
    validSecret(value) &&
    validSecret(expected) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}

export function assertMutation(
  request: FastifyRequest,
  origin: string,
  csrfToken?: string,
) {
  if (request.headers.origin !== origin)
    throw Object.assign(new Error("This request did not come from the classroom site."), { statusCode: 403 });
  if (csrfToken !== undefined && !equalSecret(request.headers["x-classroom-csrf"], csrfToken))
    throw Object.assign(new Error("Refresh the classroom page and try again."), { statusCode: 403 });
}
