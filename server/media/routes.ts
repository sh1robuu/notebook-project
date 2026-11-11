import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { RoomError, uuid } from "../rooms/model.ts";
import {
  authorizeMediaRead,
  authorizeParticipation,
} from "../rooms/participation-auth.ts";
import type { ParticipationActor } from "../rooms/participation-auth.ts";
import { transaction } from "../rooms/store.ts";
import { mediaLimits, normalizeMedia, storedMime } from "./image.ts";
import {
  busyMedia,
  claimUpload,
  completeUpload,
  finalizeUpload,
  initUpload,
  parseUpload,
  readMedia,
  readOwnedMedia,
  releaseUpload,
  uploadReceipt,
} from "./records.ts";
import type { MediaStore } from "./store.ts";

const binaryMime = "application/octet-stream";
const uploadReadTimeout = 25_000;
const basePath = "/api/classroom";
type RouteParams = { id: string; roomId?: string };
type Options = { pool: Pool; origin: string; store?: MediaStore };

class MediaUnavailable extends Error {}

async function objectOperation<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch {
    throw new MediaUnavailable();
  }
}

function invalidBytes() {
  return new RoomError(
    422,
    "media_bytes_mismatch",
    "The uploaded bytes do not match the selected file.",
  );
}

function declaredLength(request: FastifyRequest) {
  if (
    request.headers["content-type"] !== binaryMime ||
    request.headers["content-encoding"]
  )
    throw new RoomError(
      415,
      "invalid_media_request",
      "Send the original image as a binary upload.",
    );
  const length = request.headers["content-length"];
  if (length === undefined) return undefined;
  const bytes = Number(length);
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > mediaLimits.uploadBytes
  )
    throw new RoomError(413, "media_too_large", "Images may be up to 10 MB.");
  return bytes;
}

async function readUpload(body: unknown, expected: number) {
  if (!(body instanceof Readable)) throw invalidBytes();
  const bytes = Buffer.allocUnsafe(expected);
  let position = 0;
  const deadline = setTimeout(
    () => body.destroy(new Error("Image transfer timed out.")),
    uploadReadTimeout,
  );
  deadline.unref();
  try {
    for await (const chunk of body.iterator({ destroyOnReturn: false })) {
      if (!Buffer.isBuffer(chunk) || position + chunk.length > expected)
        throw invalidBytes();
      chunk.copy(bytes, position);
      position += chunk.length;
    }
  } finally {
    clearTimeout(deadline);
  }
  if (position !== expected) throw invalidBytes();
  return bytes;
}

function rateLimit(max: number) {
  return { config: { rateLimit: { max, timeWindow: "1 minute" } } };
}

export async function registerMediaRoutes(
  app: FastifyInstance,
  { pool, origin, store }: Options,
) {
  let processing = false;
  await app.register(async (scope) => {
    scope.addContentTypeParser(binaryMime, (_request, payload, done) =>
      done(null, payload),
    );
    scope.setErrorHandler((error, _request, reply) => {
      if (error instanceof MediaUnavailable)
        return reply
          .code(503)
          .send({
            error: "media_unavailable",
            message: "Image storage is temporarily unavailable.",
          });
      throw error;
    });
    scope.get(basePath + "/media/capabilities", rateLimit(600), async () => ({
      images: !!store,
    }));

    for (const actorKind of ["participant", "capture", "teacher"] as const) {
      const base =
        basePath +
        (actorKind === "teacher"
          ? "/rooms/:roomId/media"
          : `/${actorKind}/media`);
      function authorized<T>(
        request: FastifyRequest<{ Params: RouteParams }>,
        mutation: boolean,
        operation: (db: PoolClient, actor: ParticipationActor) => Promise<T>,
        readOnly = !mutation,
      ) {
        return transaction(
          pool,
          async (db) => {
            const actor = await authorizeParticipation(db, request, origin, {
              mutation,
              roomId:
                actorKind === "teacher"
                  ? uuid(request.params.roomId)
                  : undefined,
              capture: actorKind === "capture",
            });
            if (!store) throw new MediaUnavailable();
            return operation(db, actor);
          },
          readOnly,
        );
      }

      scope.post<{ Params: RouteParams }>(
        base,
        rateLimit(120),
        async (request) =>
          authorized(request, true, (db, actor) =>
            initUpload(db, actor, parseUpload(request.body)),
          ),
      );

      scope.put<{ Params: RouteParams }>(
        base + "/:id",
        {
          ...rateLimit(120),
          bodyLimit: mediaLimits.uploadBytes,
        },
        async (request, reply) => {
          const id = uuid(request.params.id);
          const length = declaredLength(request);
          const existing = await authorized(
            request,
            true,
            (db, actor) => readOwnedMedia(db, actor, id),
            true,
          );
          const previous = uploadReceipt(existing);
          if (length !== undefined && length !== existing.expected_bytes)
            throw invalidBytes();
          if (previous.state !== "pending") return previous;
          if (processing) {
            reply.header("Retry-After", "3");
            throw busyMedia();
          }
          processing = true;
          try {
            const claimed = await authorized(request, true, (db, actor) =>
              claimUpload(db, actor, id),
            );
            if (claimed.state !== "processing") return uploadReceipt(claimed);
            try {
              const input = await readUpload(
                request.body,
                claimed.expected_bytes,
              );
              if (
                createHash("sha256").update(input).digest("hex") !==
                claimed.expected_sha256
              )
                throw invalidBytes();
              const normalized = await normalizeMedia(
                input,
                claimed.expected_mime,
              );
              await objectOperation(async () => {
                const writes = await Promise.allSettled([
                  store!.put(claimed.object_key!, normalized.image),
                  store!.put(claimed.thumbnail_key!, normalized.thumbnail),
                ]);
                if (writes.some((item) => item.status === "rejected"))
                  throw new MediaUnavailable();
              });
              return await authorized(request, true, (db, actor) =>
                completeUpload(db, actor, claimed, normalized),
              );
            } catch (error) {
              const rejected =
                error instanceof RoomError && error.code === "invalid_image";
              // If authorization changed, the durable claim remains eligible for expiration cleanup.
              await authorized(request, true, (db, actor) =>
                releaseUpload(db, actor, claimed, rejected),
              ).catch(() => {});
              throw error;
            }
          } finally {
            processing = false;
          }
        },
      );

      scope.post<{ Params: RouteParams }>(
        base + "/:id/finalize",
        rateLimit(120),
        async (request) => {
          const id = uuid(request.params.id);
          const row = await authorized(
            request,
            true,
            (db, actor) => readOwnedMedia(db, actor, id),
            true,
          );
          const previous = uploadReceipt(row);
          if (previous.state === "finalized") return previous;
          if (
            previous.state !== "uploaded" ||
            !row.object_key ||
            !row.thumbnail_key
          )
            throw new RoomError(
              409,
              "media_incomplete",
              "Upload the image before finishing.",
            );
          await objectOperation(async () => {
            const [image, thumbnail] = await Promise.all([
              store!.inspect(row.object_key!),
              store!.inspect(row.thumbnail_key!),
            ]);
            if (
              image?.bytes !== row.image_bytes ||
              thumbnail?.bytes !== row.thumbnail_bytes
            )
              throw new MediaUnavailable();
          });
          return authorized(request, true, (db, actor) =>
            finalizeUpload(db, actor, row),
          );
        },
      );

      scope.get<{ Params: RouteParams; Querystring: { variant?: string } }>(
        base + "/:id",
        rateLimit(2400),
        async (request, reply) => {
          const id = uuid(request.params.id);
          const variant = request.query.variant ?? "image";
          if (variant !== "image" && variant !== "thumbnail")
            throw new RoomError(
              400,
              "invalid_media_request",
              "Choose an image or thumbnail.",
            );
          const row = await authorized(request, false, async (db, actor) => {
            await authorizeMediaRead(db, actor, id);
            return readMedia(db, actor, id);
          });
          const key = variant === "image" ? row.object_key : row.thumbnail_key;
          const bytes =
            variant === "image" ? row.image_bytes : row.thumbnail_bytes;
          if (!key || !bytes) throw new MediaUnavailable();
          const object = await objectOperation(() => store!.open(key));
          if (object?.bytes !== bytes || object?.mime !== storedMime) {
            object?.body.destroy();
            throw new MediaUnavailable();
          }
          return reply
            .header("Content-Length", object.bytes)
            .type(storedMime)
            .send(object.body);
        },
      );
    }
  });
}
