import { randomBytes } from "node:crypto";
import { chmod, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isIP } from "node:net";
import { parseEnv } from "node:util";
import { neonDirectUrl, neonRuntimeUrl, normalizeNeonUrl } from "./neon.ts";

const googleClientId = "315644332060-t77v2q8l3o7k5nur6cc4h115un3l1m3d.apps.googleusercontent.com";
const defaultOrigin = "https://noteboardbymaikhuyen.vercel.app";
const recoverable = [
  "CLASSROOM_ORIGIN", "CLASSROOM_DATABASE_URL", "CLASSROOM_ROOM_SECRET",
  "CLASSROOM_GOOGLE_CLIENT_ID", "CLASSROOM_GOOGLE_CLIENT_SECRET",
] as const;
type Environment = Record<string, string | undefined>;

function protectedKey(key: string) {
  return key.startsWith("CLASSROOM_") || key.startsWith("NODE_") ||
    ["PORT", "RENDER", "VITE_CLASSROOM_ENABLED"].includes(key);
}

function safeValue(value: string) {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error("An environment value contains unsupported control characters.");
  return value;
}

function parsedEnvironment(source: string): Environment {
  if (source.includes("\0")) throw new Error("An environment file contains invalid characters.");
  const seen = new Set<string>();
  for (const match of source.matchAll(/^[\uFEFF \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/gm)) {
    const key = match[1];
    if (!protectedKey(key)) continue;
    if (seen.has(key)) throw new Error("Duplicate protected environment variable: " + key);
    seen.add(key);
  }
  const values = parseEnv(source);
  for (const [key, value] of Object.entries(values)) if (protectedKey(key) && value !== undefined) safeValue(value);
  return values;
}

async function destination(path: string) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Environment destinations must be regular files, never symbolic links.");
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function serializedValue(value: string) {
  safeValue(value);
  if (parseEnv("VALUE=" + value).VALUE === value) return value;
  for (const quote of ["'", '"', "`"]) {
    if (value.includes(quote)) continue;
    const candidate = quote + value + quote;
    if (parseEnv("VALUE=" + candidate).VALUE === value) return candidate;
  }
  throw new Error("An environment value cannot be safely serialized.");
}

function canonicalHttps(value: string | undefined) {
  try { return !!value && value.startsWith("https://") && new URL(value).origin === value; }
  catch { return false; }
}

function validNeon(value: string | undefined, runtime: boolean) {
  if (!value) return false;
  try {
    const normalized = new URL(normalizeNeonUrl(value)), original = new URL(value);
    if (original.searchParams.get("sslmode") !== "verify-full") return false;
    return runtime ? normalized.username === "lessonboard_app" :
      normalized.username !== "lessonboard_app" && !normalized.hostname.split(".")[0].endsWith("-pooler");
  } catch { return false; }
}

function validRecovered(key: typeof recoverable[number], value: string | undefined) {
  if (!value) return false;
  if (key === "CLASSROOM_ORIGIN") return canonicalHttps(value);
  if (key === "CLASSROOM_DATABASE_URL") return validNeon(value, true);
  if (key === "CLASSROOM_ROOM_SECRET") return /^[A-Za-z0-9_-]{43,128}$/.test(value);
  if (key === "CLASSROOM_GOOGLE_CLIENT_ID") return value === googleClientId;
  return value.trim().length > 0;
}

async function googleSettings(path: string) {
  try {
    const source = await readFile(path, "utf8");
    if (Buffer.byteLength(source) > 65_536) throw new Error();
    const json: unknown = JSON.parse(source);
    if (!json || typeof json !== "object" || !("web" in json) || !json.web || typeof json.web !== "object") throw new Error();
    const web = json.web as { client_id?: unknown; client_secret?: unknown };
    if (web.client_id !== googleClientId || typeof web.client_secret !== "string" || !web.client_secret.trim()) throw new Error();
    return { id: googleClientId, secret: safeValue(web.client_secret) };
  } catch {
    throw new Error("The Google Web Application configuration is invalid or does not match the requested OAuth client.");
  }
}

async function atomicEnvironment(path: string, content: string, previous: string | undefined, directory: string) {
  const current = await destination(path);
  if (current !== previous) throw new Error("Local configuration changed during preparation. Retry with the current files.");
  if (current === content) { await chmod(path, 0o600); return; }
  const temporary = join(directory, ".env.classroom-" + randomBytes(16).toString("hex") + ".tmp");
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(content, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    if (await destination(path) !== previous) throw new Error("Local configuration changed during preparation. Retry with the current files.");
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
  }
}

export async function prepareClassroomEnvironment(options: {
  directory: string;
  googleClientFile?: string;
  ownerUrl?: string;
}): Promise<{ envPath: string; renderPath: string; missing: string[] }> {
  const directory = resolve(options.directory);
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("The configuration directory must be a real directory.");
  const envPath = join(directory, ".env.local"), renderPath = join(directory, "render-env.local.txt");
  const original = await destination(envPath), previousRender = await destination(renderPath);
  let source = original ?? "";
  const values = parsedEnvironment(source), oldRender = parsedEnvironment(previousRender ?? "");
  let recoveredRuntime: string | undefined;
  if (oldRender.CLASSROOM_DATABASE_URL) {
    try {
      const normalized = normalizeNeonUrl(oldRender.CLASSROOM_DATABASE_URL);
      if (new URL(normalized).username === "lessonboard_app") recoveredRuntime = normalized;
    } catch { /* Keep an unrecognized credential for explicit operator review. */ }
  }
  const preserveUnresolvedExport = !values.CLASSROOM_DATABASE_URL &&
    !!oldRender.CLASSROOM_DATABASE_URL && !recoveredRuntime;
  const google = options.googleClientFile ? await googleSettings(options.googleClientFile) : undefined;
  const suppliedOwner = options.ownerUrl ? normalizeNeonUrl(options.ownerUrl) : undefined;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";

  function fill(key: string, value: string | undefined) {
    if ((values[key] !== undefined && values[key] !== "") || value === undefined) return;
    const encoded = serializedValue(value);
    const assignment = new RegExp("^([\\uFEFF \\t]*(?:export[ \\t]+)?" + key + "[ \\t]*=[ \\t]*)([^\\r\\n]*)", "m");
    if (assignment.test(source)) {
      source = source.replace(assignment, (_match, prefix: string, rest: string) => {
        const comment = rest.match(/^(?:''|"")?[ \t]*(#.*)$/)?.[1];
        return prefix + encoded + (comment ? " " + comment : "");
      });
    } else {
      if (source && !source.endsWith("\n")) source += newline;
      source += key + "=" + encoded + newline;
    }
    values[key] = value;
  }

  // Recover valid previously exported runtime credentials if the local file was
  // removed. Host/bind flags remain separate local and Render settings.
  for (const key of recoverable) {
    const recovered = key === "CLASSROOM_DATABASE_URL" ? recoveredRuntime : oldRender[key];
    if (validRecovered(key, recovered)) fill(key, recovered);
  }
  fill("NODE_ENV", "production");
  fill("CLASSROOM_ORIGIN", defaultOrigin);
  fill("CLASSROOM_BIND_HOST", "127.0.0.1");
  fill("CLASSROOM_PORT", "8787");
  fill("CLASSROOM_SERVE_DIST", "false");
  fill("VITE_CLASSROOM_ENABLED", "false");
  fill("CLASSROOM_GOOGLE_CLIENT_ID", google?.id ?? googleClientId);
  fill("CLASSROOM_GOOGLE_CLIENT_SECRET", google?.secret);
  if (!values.CLASSROOM_ROOM_SECRET) fill("CLASSROOM_ROOM_SECRET", randomBytes(32).toString("base64url"));

  let ownerSeed = suppliedOwner;
  if (values.CLASSROOM_MIGRATION_URL) {
    try { ownerSeed = normalizeNeonUrl(values.CLASSROOM_MIGRATION_URL); }
    catch { ownerSeed = undefined; }
  }
  if (ownerSeed) {
    fill("CLASSROOM_MIGRATION_URL", neonDirectUrl(ownerSeed));
    if (!values.CLASSROOM_DATABASE_URL && !preserveUnresolvedExport)
      fill("CLASSROOM_DATABASE_URL", neonRuntimeUrl(ownerSeed, randomBytes(32).toString("base64url")));
  }

  const missing: string[] = [];
  for (const key of recoverable) if (!validRecovered(key, values[key])) missing.push(key);
  if (!validNeon(values.CLASSROOM_MIGRATION_URL, false)) missing.push("CLASSROOM_MIGRATION_URL");
  const render: Environment = {
    NODE_VERSION: "24.19.0", NODE_ENV: "production", CLASSROOM_BIND_HOST: "0.0.0.0", CLASSROOM_SERVE_DIST: "false",
  };
  for (const key of recoverable) if (validRecovered(key, values[key])) render[key] = values[key];
  if (values.CLASSROOM_TRUST_PROXIES) {
    const proxies = values.CLASSROOM_TRUST_PROXIES.split(",").map(value => value.trim());
    if (proxies.every(value => isIP(value)))
      render.CLASSROOM_TRUST_PROXIES = values.CLASSROOM_TRUST_PROXIES;
    else missing.push("CLASSROOM_TRUST_PROXIES");
  }
  const renderSource = Object.entries(render).map(([key, value]) => key + "=" + serializedValue(value!)).join("\n") + "\n";
  // Persist the independently generated runtime credential before an operator
  // provisions its role. Neither migration nor network access occurs here.
  await atomicEnvironment(envPath, source, original, directory);
  await atomicEnvironment(renderPath, preserveUnresolvedExport ? previousRender! : renderSource, previousRender, directory);
  return { envPath, renderPath, missing: missing.toSorted() };
}
