import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { storedMime } from "./image.ts";

type ObjectInfo = { bytes: number; mime: typeof storedMime };
type MediaObject = ObjectInfo & { body: Readable };

export interface MediaStore {
  put(key: string, bytes: Buffer): Promise<void>;
  inspect(key: string): Promise<ObjectInfo | undefined>;
  open(key: string): Promise<MediaObject | undefined>;
  delete(key: string): Promise<void>;
}

type S3MediaConfig = {
  driver: "s3";
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type MediaConfig =
  | { driver: "disabled" }
  | { driver: "local"; directory: string }
  | S3MediaConfig;

function required(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} must be configured.`);
  return value;
}

function endpointUrl(input: string) {
  let parsed: URL | undefined;
  try {
    parsed = new URL(input);
  } catch {
    /* Report only the setting name. */
  }
  if (
    !parsed ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  )
    throw new Error(
      "CLASSROOM_MEDIA_ENDPOINT must be a canonical HTTPS origin.",
    );
  return parsed.origin;
}

export function loadMediaConfig(
  env: NodeJS.ProcessEnv = process.env,
): MediaConfig {
  const driver = env.CLASSROOM_MEDIA_DRIVER?.trim() || "disabled";
  switch (driver) {
    case "disabled":
      return { driver };
    case "local": {
      if (
        env.NODE_ENV === "production" ||
        env.RENDER === "true" ||
        env.VERCEL === "1"
      )
        throw new Error(
          "The local classroom media store is unavailable in production.",
        );
      const directory = required(env, "CLASSROOM_MEDIA_LOCAL_DIR");
      if (!isAbsolute(directory))
        throw new Error(
          "CLASSROOM_MEDIA_LOCAL_DIR must be an absolute private directory.",
        );
      const path = resolve(directory);
      if (path === dirname(path))
        throw new Error(
          "CLASSROOM_MEDIA_LOCAL_DIR must be a dedicated directory.",
        );
      return { driver, directory: path };
    }
    case "s3": {
      const endpoint = endpointUrl(required(env, "CLASSROOM_MEDIA_ENDPOINT"));
      const bucket = required(env, "CLASSROOM_MEDIA_BUCKET");
      if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(bucket))
        throw new Error(
          "CLASSROOM_MEDIA_BUCKET must use 3 to 63 lowercase letters, numbers or hyphens.",
        );
      const region = env.CLASSROOM_MEDIA_REGION?.trim() || "auto";
      if (!/^[a-z0-9-]{1,64}$/.test(region))
        throw new Error("CLASSROOM_MEDIA_REGION is invalid.");
      return {
        driver,
        endpoint,
        bucket,
        region,
        accessKeyId: required(env, "CLASSROOM_MEDIA_ACCESS_KEY_ID"),
        secretAccessKey: required(env, "CLASSROOM_MEDIA_SECRET_ACCESS_KEY"),
      };
    }
    default:
      throw new Error("CLASSROOM_MEDIA_DRIVER must be disabled, local or s3.");
  }
}

const idPattern =
  "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const keyPattern = new RegExp(
  `^classroom-media/${idPattern}/${idPattern}/${idPattern}/(?:image|thumbnail)\\.jpg$`,
);

function objectKey(key: string) {
  if (!keyPattern.test(key))
    throw new Error("Classroom media object key is invalid.");
  return key;
}

export function mediaObjectKeys(
  roomId: string,
  mediaId: string,
  attemptId: string,
) {
  const prefix = `classroom-media/${roomId}/${mediaId}/${attemptId}`;
  return {
    image: objectKey(`${prefix}/image.jpg`),
    thumbnail: objectKey(`${prefix}/thumbnail.jpg`),
  };
}

function localMissing(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

export class LocalMediaStore implements MediaStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  private path(key: string) {
    return join(this.directory, objectKey(key));
  }

  async put(key: string, bytes: Buffer) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async inspect(key: string): Promise<ObjectInfo | undefined> {
    try {
      const item = await stat(this.path(key));
      if (!item.isFile()) throw new Error("Classroom media is not a file.");
      return { bytes: item.size, mime: storedMime };
    } catch (error) {
      if (!localMissing(error)) throw error;
    }
  }

  async open(key: string) {
    const item = await this.inspect(key);
    return item && { ...item, body: createReadStream(this.path(key)) };
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

const storeTimeout = 8_000;

function remoteMissing(error: unknown) {
  return (
    (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode === 404
  );
}

function objectInfo(
  bytes: number | undefined,
  mime: string | undefined,
): ObjectInfo {
  if (
    bytes === undefined ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    mime !== storedMime
  )
    throw new Error("Classroom media store returned invalid metadata.");
  return { bytes, mime: storedMime };
}

export class S3MediaStore implements MediaStore {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(config: S3MediaConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      maxAttempts: 2,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async put(key: string, bytes: Buffer) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey(key),
        Body: bytes,
        ContentLength: bytes.length,
        ContentType: storedMime,
        CacheControl: "private, no-store",
      }),
      { abortSignal: AbortSignal.timeout(storeTimeout) },
    );
  }

  async inspect(key: string) {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey(key) }),
        { abortSignal: AbortSignal.timeout(storeTimeout) },
      );
      return objectInfo(result.ContentLength, result.ContentType);
    } catch (error) {
      if (!remoteMissing(error)) throw error;
    }
  }

  async open(key: string) {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey(key) }),
        { abortSignal: AbortSignal.timeout(storeTimeout) },
      );
      if (!(result.Body instanceof Readable))
        throw new Error("Classroom media store did not return a stream.");
      try {
        return {
          ...objectInfo(result.ContentLength, result.ContentType),
          body: result.Body,
        };
      } catch (error) {
        result.Body.destroy();
        throw error;
      }
    } catch (error) {
      if (!remoteMissing(error)) throw error;
    }
  }

  async delete(key: string) {
    // DeleteObject already succeeds for an absent key in an existing bucket.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey(key) }),
      { abortSignal: AbortSignal.timeout(storeTimeout) },
    );
  }
}

export function createMediaStore(config: MediaConfig): MediaStore | undefined {
  if (config.driver === "local") return new LocalMediaStore(config.directory);
  if (config.driver === "s3") return new S3MediaStore(config);
}
