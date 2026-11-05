import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { Zip, ZipDeflate } from "fflate";
import { createInflateRaw } from "node:zlib";

const exec = promisify(execFile);
const MAX_BYTES = 3_500_000_000,
  MAX_FILE = 1_000_000_000,
  MAX_ENTRIES = 10_000;
const ROOTS = ["src", "public", "scripts", "docs", "tests", "experiments"];
const OMIT = new Set([
  "node_modules",
  ".git",
  ".recovery",
  "dist",
  "test-results",
  "coverage",
  ".cache",
  "__pycache__",
  ".playwright-cli",
  ".s00-npm-cache",
  "tmp",
  "profiles",
  "browser-profile",
]);
const SECRET =
  /(^|\/)(\.env(?:\..*)?|\.npmrc|\.git-credentials|auth\.json|credentials?|secrets?|tokens?|passwords?|private|students?|hoc[-_ ]?sinh)(\/|$)|\.(pem|key|pfx|p12|sqlite3?|db)$/i;
const ROOT_FILE =
  /^(README\.md|package(?:-lock)?\.json|index\.html|vite\.config\.ts|tsconfig[^/]*\.json|playwright[^/]*\.(ts|mjs)|vercel\.json|\.gitignore|\.vercelignore|s01-install\.log|s02-baseline-(?:build|tests)\.log)$/;
const RESERVED = "__recovery__/git-state.json";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
function fail(message) {
  throw new Error(message);
}
function safeName(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 500 ||
    /[\\:\0]/.test(name) ||
    name.startsWith("/") ||
    name.split("/").some((p) => !p || p === "." || p === "..")
  )
    fail(`Unsafe recovery entry path: ${name}`);
  if (name === RESERVED) return name;
  if (SECRET.test(name) || name.split("/").some((p) => OMIT.has(p)))
    fail(`Excluded recovery entry path: ${name}`);
  if (!ROOTS.includes(name.split("/")[0]) && !ROOT_FILE.test(name))
    fail(`Unowned recovery entry path: ${name}`);
  return name;
}
function classification(name, version = 2) {
  safeName(name);
  if (name === RESERVED)
    return {
      category: "metadata",
      cleanupEligible: false,
      defaultRestore: false,
    };
  if (version >= 2 && /^docs\/verification\/.*\/error-context\.md$/.test(name))
    return {
      category: "evidence",
      cleanupEligible: true,
      defaultRestore: false,
    };
  if (name.startsWith("docs/verification/") && !name.endsWith(".md"))
    return {
      category: "evidence",
      cleanupEligible: true,
      defaultRestore: false,
    };
  if (
    /^experiments\/s00\/(results|test-results)\//.test(name) ||
    (ROOT_FILE.test(name) && name.endsWith(".log"))
  )
    return {
      category: "evidence",
      cleanupEligible: true,
      defaultRestore: false,
    };
  if (name.startsWith("experiments/"))
    return {
      category: name.includes("/fixtures/") ? "fixture" : "experiment",
      cleanupEligible: true,
      defaultRestore: true,
    };
  if (name.startsWith("tests/"))
    return {
      category: name.startsWith("tests/deploy/") ? "deployment-test" : "test",
      cleanupEligible: !name.startsWith("tests/deploy/"),
      defaultRestore: true,
    };
  if (
    /^playwright\.(?:legacy|performance|s0[345]-performance)\.config\.ts$/.test(
      name,
    )
  )
    return {
      category: "test-config",
      cleanupEligible: true,
      defaultRestore: true,
    };
  if (/^scripts\/s0[45]-(?:evidence|handoff)\.mjs$/.test(name))
    return {
      category: "test-helper",
      cleanupEligible: true,
      defaultRestore: true,
    };
  if (
    version >= 2 &&
    ["scripts/capture-product.mjs", "scripts/deploy-evidence.mjs"].includes(
      name,
    )
  )
    return {
      category: "test-helper",
      cleanupEligible: true,
      defaultRestore: true,
    };
  return {
    category:
      name.startsWith("docs/") || name === "README.md"
        ? "documentation"
        : "source",
    cleanupEligible: false,
    defaultRestore: true,
  };
}
async function rootPath(root) {
  const absolute = path.resolve(root);
  if ((await lstat(absolute)).isSymbolicLink())
    fail("Workspace root must not be a symbolic link.");
  return realpath(absolute);
}
function within(root, relative) {
  const target = path.resolve(root, relative);
  if (!target.toLowerCase().startsWith(root.toLowerCase() + path.sep))
    fail(`Path escapes workspace: ${relative}`);
  return target;
}
async function noLinks(root, relative) {
  let current = root;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink())
        fail(`Recovery path contains a link: ${relative}`);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
  }
}
async function hashFile(file) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}
export async function inventoryRecovery(workspaceRoot = process.cwd()) {
  const root = await rootPath(workspaceRoot),
    entries = [],
    skipped = [];
  async function visit(relative) {
    const info = await lstat(within(root, relative));
    if (info.isSymbolicLink()) {
      skipped.push({
        path: relative,
        reason: "symbolic link/junction; never followed",
      });
      return;
    }
    if (OMIT.has(path.basename(relative)) || SECRET.test(relative)) {
      skipped.push({
        path: relative,
        reason: "cache, generated output, credential-like or private path",
      });
      return;
    }
    if (info.isDirectory()) {
      for (const name of (await readdir(within(root, relative))).sort())
        await visit(`${relative}/${name}`);
    } else if (info.isFile()) {
      const type = classification(relative);
      if (info.size > MAX_FILE) fail(`Recovery file exceeds 1 GB: ${relative}`);
      entries.push({ path: relative, bytes: info.size, ...type });
    } else skipped.push({ path: relative, reason: "not a regular file" });
  }
  for (const name of (await readdir(root)).sort()) {
    if (ROOTS.includes(name) || ROOT_FILE.test(name)) await visit(name);
    else
      skipped.push({
        path: name,
        reason:
          "not a curated source/config/test/evidence root; left untouched",
      });
  }
  const totalBytes = entries.reduce((n, e) => n + e.bytes, 0);
  if (entries.length + 1 > MAX_ENTRIES || totalBytes > MAX_BYTES)
    fail("Recovery scope exceeds declared ZIP limits (10k entries / 3.5 GB).");
  return { root, entries, skipped, totalBytes };
}
async function gitState(root) {
  try {
    const [head, branch, status] = await Promise.all([
      exec("git", ["rev-parse", "HEAD"], { cwd: root }),
      exec("git", ["branch", "--show-current"], { cwd: root }),
      exec("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
        cwd: root,
        maxBuffer: 4_000_000,
      }),
    ]);
    return {
      available: true,
      head: head.stdout.trim(),
      branch: branch.stdout.trim(),
      statusPorcelainNul: status.stdout,
      note: "Read-only metadata; Git index, branch and working files are not modified.",
    };
  } catch {
    return {
      available: false,
      note: "No readable Git state; filesystem hashes remain authoritative.",
    };
  }
}
function snapshotName(name) {
  if (
    typeof name !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,90}$/.test(name)
  )
    fail("Invalid recovery snapshot name.");
  return name;
}
async function location(root, snapshot) {
  const base = ".recovery/deploy-01";
  await noLinks(root, base);
  if (!snapshot) {
    const names = (await readdir(within(root, base))).sort().reverse();
    for (const name of names) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,90}$/.test(name)) continue;
      try {
        await stat(within(root, `${base}/${name}/manifest.json`));
        snapshot = name;
        break;
      } catch {
        /* Incomplete backups are not selected. */
      }
    }
    if (!snapshot) fail("No completed recovery snapshot exists.");
  }
  const relative = `${base}/${snapshotName(snapshot)}`;
  await noLinks(root, relative);
  return {
    snapshot,
    relative,
    directory: within(root, relative),
    bundle: within(root, `${relative}/bundle.zip`),
    manifest: within(root, `${relative}/manifest.json`),
  };
}
export async function backupRecovery({
  workspaceRoot = process.cwd(),
  snapshot,
} = {}) {
  const inventory = await inventoryRecovery(workspaceRoot),
    root = inventory.root;
  const git = await gitState(root),
    createdAt = new Date().toISOString();
  snapshot ??= createdAt.replace(/[:.]/g, "-");
  const place = await location(root, snapshot);
  await mkdir(path.dirname(place.directory), { recursive: true });
  await mkdir(place.directory); // Existing snapshots are never replaced.
  const output = createWriteStream(place.bundle, { flags: "wx" });
  let streamError,
    blocked = false;
  output.on("error", (error) => {
    streamError = error;
  });
  const finished = once(output, "finish");
  finished.catch(() => {});
  const zip = new Zip((error, data, final) => {
    if (error) {
      streamError = error;
      output.destroy(error);
      return;
    }
    if (!output.write(data)) blocked = true;
    if (final) output.end();
  });
  const drain = async () => {
    if (streamError) throw streamError;
    if (blocked) {
      blocked = false;
      await once(output, "drain");
    }
  };
  const entries = [];
  try {
    const metadata = Buffer.from(JSON.stringify({ createdAt, git }, null, 2));
    const meta = new ZipDeflate(RESERVED, { level: 3 });
    zip.add(meta);
    meta.push(metadata, true);
    await drain();
    entries.push({
      path: RESERVED,
      bytes: metadata.length,
      sha256: digest(metadata),
      ...classification(RESERVED),
    });
    for (const entry of inventory.entries) {
      await noLinks(root, entry.path);
      const file = within(root, entry.path),
        before = await stat(file);
      const source = new ZipDeflate(entry.path, { level: 3 });
      zip.add(source);
      const hash = createHash("sha256");
      let bytes = 0;
      for await (const chunk of createReadStream(file, {
        highWaterMark: 65_536,
      })) {
        hash.update(chunk);
        bytes += chunk.length;
        source.push(chunk, false);
        await drain();
      }
      source.push(new Uint8Array(), true);
      await drain();
      const after = await stat(file);
      if (
        bytes !== before.size ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      )
        fail(
          `Source changed during backup; retain it and retry: ${entry.path}`,
        );
      entries.push({ ...entry, bytes, sha256: hash.digest("hex") });
    }
    zip.end();
    await finished;
    const archive = await hashFile(place.bundle);
    const manifest = {
      format: "lessonboard-deploy-recovery",
      version: 2,
      snapshot,
      createdAt,
      archive: { file: "bundle.zip", ...archive },
      entries,
      skipped: inventory.skipped,
      limits: {
        maxFileBytes: MAX_FILE,
        maxTotalBytes: MAX_BYTES,
        maxEntries: MAX_ENTRIES,
      },
      note: "Contains working-tree bytes, not an automatic Git commit. No cleanup has been performed. Review skipped paths before deleting any directory.",
    };
    await writeFile(place.manifest, JSON.stringify(manifest, null, 2), {
      flag: "wx",
    });
    const verified = await verifyRecovery({ workspaceRoot: root, snapshot });
    return { ...verified, skipped: inventory.skipped.length };
  } catch (error) {
    zip.terminate();
    output.destroy();
    throw error;
  }
}
async function readManifest(root, place) {
  await noLinks(root, `${place.relative}/manifest.json`);
  await noLinks(root, `${place.relative}/bundle.zip`);
  const manifest = await json(place.manifest);
  if (
    manifest.format !== "lessonboard-deploy-recovery" ||
    ![1, 2].includes(manifest.version) ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length > MAX_ENTRIES ||
    manifest.archive?.file !== "bundle.zip"
  )
    fail("Invalid recovery manifest.");
  const expected = new Map();
  let bytes = 0;
  for (const entry of manifest.entries) {
    safeName(entry.path);
    if (
      expected.has(entry.path.toLowerCase()) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      entry.bytes > MAX_FILE ||
      !/^[0-9a-f]{64}$/.test(entry.sha256)
    )
      fail(`Invalid recovery entry: ${entry.path}`);
    const type = classification(entry.path, manifest.version);
    if (Object.keys(type).some((key) => entry[key] !== type[key]))
      fail(`Recovery entry classification differs: ${entry.path}`);
    expected.set(entry.path.toLowerCase(), entry);
    bytes += entry.bytes;
  }
  if (bytes > MAX_BYTES || !expected.has(RESERVED.toLowerCase()))
    fail("Recovery manifest resource or metadata limit.");
  const actual = await hashFile(place.bundle);
  if (
    actual.bytes > MAX_BYTES ||
    actual.bytes !== manifest.archive.bytes ||
    actual.sha256 !== manifest.archive.sha256
  )
    fail(
      "Recovery archive checksum/length differs. Do not delete the originals.",
    );
  return { manifest, expected };
}
// Central-directory lengths are authoritative. Streaming signature scanning can
// mistake a ZIP nested inside an incompressible deflate block for outer entries.
async function readZip(root, place, expected, selected = new Set(), stage) {
  const handle = await open(place.bundle, "r");
  const total = (await handle.stat()).size;
  async function readAt(offset, length) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      length < 0 ||
      offset + length > total
    )
      fail("ZIP bounds differ.");
    const bytes = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const chunk = await handle.read(
        bytes,
        read,
        length - read,
        offset + read,
      );
      if (!chunk.bytesRead) fail("Truncated recovery ZIP.");
      read += chunk.bytesRead;
    }
    return bytes;
  }
  try {
    const tailOffset = Math.max(0, total - 65557),
      tail = await readAt(tailOffset, total - tailOffset);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (
        tail.readUInt32LE(i) === 0x06054b50 &&
        i + 22 + tail.readUInt16LE(i + 20) === tail.length
      ) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0 || tail.readUInt16LE(eocd + 4) || tail.readUInt16LE(eocd + 6))
      fail("Missing or multi-disk ZIP directory.");
    const count = tail.readUInt16LE(eocd + 10),
      size = tail.readUInt32LE(eocd + 12),
      offset = tail.readUInt32LE(eocd + 16);
    if (
      count !== expected.size ||
      count > MAX_ENTRIES ||
      size > 8_000_000 ||
      offset + size !== tailOffset + eocd
    )
      fail("Missing or unexpected ZIP directory entries.");
    const central = await readAt(offset, size),
      seen = new Set(),
      ranges = [];
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      if (
        cursor + 46 > central.length ||
        central.readUInt32LE(cursor) !== 0x02014b50
      )
        fail("Malformed ZIP directory entry.");
      const flags = central.readUInt16LE(cursor + 8),
        method = central.readUInt16LE(cursor + 10);
      const compressed = central.readUInt32LE(cursor + 20),
        expanded = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28),
        extra = central.readUInt16LE(cursor + 30),
        comment = central.readUInt16LE(cursor + 32);
      const localOffset = central.readUInt32LE(cursor + 42),
        end = cursor + 46 + nameLength + extra + comment;
      if (end > central.length || flags & 1 || ![0, 8].includes(method))
        fail("Unsupported recovery ZIP entry.");
      const nameBytes = central.subarray(cursor + 46, cursor + 46 + nameLength),
        name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
      safeName(name);
      const key = name.toLowerCase(),
        entry = expected.get(key);
      if (
        !entry ||
        entry.path !== name ||
        seen.has(key) ||
        expanded !== entry.bytes
      )
        fail(`Undeclared, duplicate or length-mismatched ZIP entry: ${name}`);
      seen.add(key);
      const local = await readAt(localOffset, 30);
      if (
        local.readUInt32LE(0) !== 0x04034b50 ||
        local.readUInt16LE(6) !== flags ||
        local.readUInt16LE(8) !== method ||
        local.readUInt16LE(26) !== nameLength
      )
        fail("Local ZIP header differs.");
      const localName = await readAt(localOffset + 30, nameLength);
      if (!localName.equals(nameBytes)) fail("Local ZIP path differs.");
      const start = localOffset + 30 + nameLength + local.readUInt16LE(28),
        finish = start + compressed;
      if (
        finish > offset ||
        start < localOffset ||
        compressed > MAX_FILE + 10_000_000
      )
        fail("ZIP data bounds differ.");
      ranges.push([localOffset, finish]);
      const hash = createHash("sha256");
      let bytes = 0,
        output;
      const extract = stage && selected.has(name);
      if (extract) output = await open(within(stage, name), "wx");
      try {
        if (compressed) {
          const input = createReadStream(place.bundle, {
            start,
            end: finish - 1,
          });
          const stream = method === 8 ? input.pipe(createInflateRaw()) : input;
          input.on("error", (error) => stream.destroy(error));
          try {
            for await (const chunk of stream) {
              bytes += chunk.length;
              if (bytes > entry.bytes)
                fail(`Expanded entry exceeds declared length: ${name}`);
              hash.update(chunk);
              if (output) {
                let written = 0;
                while (written < chunk.length) {
                  const result = await output.write(
                    chunk,
                    written,
                    chunk.length - written,
                  );
                  if (!result.bytesWritten) fail("Staging write failed.");
                  written += result.bytesWritten;
                }
              }
            }
          } finally {
            input.destroy();
            stream.destroy();
          }
        }
        if (bytes !== entry.bytes || hash.digest("hex") !== entry.sha256)
          fail(`Recovery entry checksum/length differs: ${name}`);
      } finally {
        await output?.close();
      }
      cursor = end;
    }
    if (cursor !== central.length) fail("Unexpected ZIP directory data.");
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++)
      if (ranges[i][0] < ranges[i - 1][1])
        fail("Overlapping recovery ZIP entries.");
  } finally {
    await handle.close();
  }
}
export async function verifyRecovery({
  workspaceRoot = process.cwd(),
  snapshot,
} = {}) {
  const root = await rootPath(workspaceRoot),
    place = await location(root, snapshot);
  const { manifest, expected } = await readManifest(root, place);
  await readZip(root, place, expected);
  return {
    verified: true,
    snapshot: place.snapshot,
    manifest: place.manifest,
    bundle: place.bundle,
    entries: expected.size,
    sourceBytes: manifest.entries.reduce((n, e) => n + e.bytes, 0),
    archiveBytes: manifest.archive.bytes,
    archiveSha256: manifest.archive.sha256,
    cleanupEligibleEntries: manifest.entries.filter((e) => e.cleanupEligible)
      .length,
  };
}
export async function restoreRecovery({
  workspaceRoot = process.cwd(),
  snapshot,
  includeEvidence = false,
  scope = "all",
} = {}) {
  if (!["all", "tests"].includes(scope))
    fail("Restore scope must be all or tests.");
  const root = await rootPath(workspaceRoot),
    place = await location(root, snapshot);
  const { manifest, expected } = await readManifest(root, place);
  await readZip(root, place, expected);
  const testTypes = new Set([
    "test",
    "fixture",
    "experiment",
    "test-config",
    "test-helper",
  ]);
  const candidates = manifest.entries.filter(
    (e) =>
      e.path !== RESERVED &&
      (e.defaultRestore || includeEvidence) &&
      (scope === "all" ||
        testTypes.has(e.category) ||
        (includeEvidence && e.category === "evidence")),
  );
  const missing = [],
    existing = [];
  for (const entry of candidates) {
    await noLinks(root, entry.path);
    try {
      const target = within(root, entry.path);
      if (!(await lstat(target)).isFile())
        fail(`Restore conflict, not a regular file: ${entry.path}`);
      const data = await hashFile(target);
      if (data.bytes !== entry.bytes || data.sha256 !== entry.sha256)
        fail(
          `Restore conflict: different existing bytes at ${entry.path}; no files have been overwritten.`,
        );
      existing.push(entry.path);
    } catch (error) {
      if (error.code === "ENOENT") missing.push(entry);
      else throw error;
    }
  }
  if (!missing.length)
    return {
      restored: 0,
      identicalExisting: existing.length,
      snapshot: place.snapshot,
      scope,
      includeEvidence,
    };
  const stageRelative = `${place.relative}/restore-staging-${randomUUID()}`,
    stage = within(root, stageRelative);
  await noLinks(root, stageRelative);
  await mkdir(stage);
  for (const entry of missing)
    await mkdir(path.dirname(within(stage, entry.path)), { recursive: true });
  // A complete second per-entry validation precedes installation. The staging
  // directory stays recoverable if interrupted; no recursive deletion is used.
  await readZip(
    root,
    place,
    expected,
    new Set(missing.map((e) => e.path)),
    stage,
  );
  let restored = 0;
  for (const entry of missing) {
    await noLinks(root, entry.path);
    const target = within(root, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    await noLinks(root, entry.path);
    await copyFile(within(stage, entry.path), target, constants.COPYFILE_EXCL);
    const actual = await hashFile(target);
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256)
      fail(
        `Installed recovery checksum differs: ${entry.path}; inspect the staging directory.`,
      );
    await unlink(within(stage, entry.path));
    restored++;
  }
  return {
    restored,
    identicalExisting: existing.length,
    snapshot: place.snapshot,
    scope,
    includeEvidence,
    note: "Existing files are never replaced. Archive and staging remain recoverable after interruption; a partial newly copied destination must be reviewed or moved before retry. Empty staging directories are retained.",
  };
}
export async function statusRecovery(options = {}) {
  const verified = await verifyRecovery(options),
    manifest = await json(verified.manifest);
  return {
    ...verified,
    categories: Object.fromEntries(
      [...new Set(manifest.entries.map((e) => e.category))].map((category) => [
        category,
        manifest.entries.filter((e) => e.category === category).length,
      ]),
    ),
    skippedPaths: manifest.skipped,
    note: "Only manifest entries marked cleanupEligible are recoverable cleanup candidates. Protected source/docs/runtime assets are never cleanup candidates. This helper never deletes project files.",
  };
}
async function cli() {
  const [command, ...args] = process.argv.slice(2),
    options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace") options.workspaceRoot = args[++i];
    else if (args[i] === "--snapshot") options.snapshot = args[++i];
    else if (args[i] === "--scope") options.scope = args[++i];
    else if (args[i] === "--include-evidence") options.includeEvidence = true;
    else fail(`Unknown recovery argument: ${args[i]}`);
  }
  const action = {
    backup: backupRecovery,
    verify: verifyRecovery,
    status: statusRecovery,
    restore: restoreRecovery,
  }[command];
  if (!action)
    fail(
      "Usage: node scripts/deploy-recovery.mjs backup|verify|status|restore [--snapshot ID] [--scope all|tests] [--include-evidence]",
    );
  console.log(JSON.stringify(await action(options), null, 2));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  cli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
