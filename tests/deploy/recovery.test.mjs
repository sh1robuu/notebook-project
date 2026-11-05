import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { zipSync } from "fflate";

const exec = promisify(execFile);
const helper = fileURLToPath(
  new URL("../../scripts/deploy-recovery.mjs", import.meta.url),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function workspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), "lessonboard-recovery-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.match(path.basename(root), /^lessonboard-recovery-test-/);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function put(root, name, bytes) {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}
async function run(root, action, ...extra) {
  try {
    const result = await exec(process.execPath, [
      helper,
      action,
      "--workspace",
      root,
      "--snapshot",
      "fixture",
      ...extra,
    ]);
    return { code: 0, ...result };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}
const bundle = (root) =>
  path.join(root, ".recovery/deploy-01/fixture/bundle.zip");
const manifestPath = (root) =>
  path.join(root, ".recovery/deploy-01/fixture/manifest.json");

test("nested trace ZIPs with stored random data are verified by their outer archive entries", async (t) => {
  const root = await workspace(t);
  const nested = zipSync(
    {
      "test.trace": randomBytes(100_000),
      "1-trace.trace": randomBytes(100_000),
    },
    { level: 0 },
  );
  await put(root, "docs/verification/s05/failure/trace.zip", nested);
  const backup = await run(root, "backup");
  assert.equal(backup.code, 0, backup.stderr);
  assert.equal((await run(root, "verify")).code, 0);
});

test("recovery streams source and fixture bytes while skipping credentials, caches and runtime output", async (t) => {
  const root = await workspace(t);
  await put(root, "src/app.ts", "source before cleanup\n");
  await put(root, "tests/unit/source.test.ts", "reusable test\n");
  await put(
    root,
    "experiments/s05/fixtures/known.docx",
    Uint8Array.of(80, 75, 1, 2, 3),
  );
  await put(
    root,
    "docs/verification/s05/trace.json",
    Buffer.alloc(2_000_000, 65),
  );
  await put(root, ".env.local", "NOT_A_REAL_TOKEN=synthetic\n");
  await put(root, "node_modules/a/index.js", "reinstallable\n");
  await put(root, "dist/index.html", "build output\n");
  await put(root, "tmp/temporary.txt", "disposable\n");
  const backup = await run(root, "backup");
  assert.equal(backup.code, 0, backup.stderr);
  const manifest = JSON.parse(await readFile(manifestPath(root), "utf8"));
  assert.ok(manifest.entries.some((entry) => entry.path === "src/app.ts"));
  assert.ok(
    manifest.entries.some(
      (entry) => entry.path === "docs/verification/s05/trace.json",
    ),
  );
  assert.ok(
    manifest.entries.every(
      (entry) => !/\.env|node_modules|dist\/|tmp\//.test(entry.path),
    ),
  );
  assert.equal((await run(root, "verify")).code, 0);
  for (const name of [
    "src/app.ts",
    "tests/unit/source.test.ts",
    "experiments/s05/fixtures/known.docx",
    "docs/verification/s05/trace.json",
  ])
    await rm(path.join(root, name));
  assert.equal((await run(root, "restore")).code, 0);
  assert.equal(
    await readFile(path.join(root, "src/app.ts"), "utf8"),
    "source before cleanup\n",
  );
  assert.deepEqual(
    [
      ...(await readFile(
        path.join(root, "experiments/s05/fixtures/known.docx"),
      )),
    ],
    [80, 75, 1, 2, 3],
  );
  await assert.rejects(
    stat(path.join(root, "docs/verification/s05/trace.json")),
    { code: "ENOENT" },
  );
  assert.equal((await run(root, "restore", "--include-evidence")).code, 0);
  assert.equal(
    (await stat(path.join(root, "docs/verification/s05/trace.json"))).size,
    2_000_000,
  );
});

test("restore refuses changed user files before restoring any missing file", async (t) => {
  const root = await workspace(t);
  await put(root, "src/a.ts", "original A");
  await put(root, "src/b.ts", "original B");
  assert.equal((await run(root, "backup")).code, 0);
  await rm(path.join(root, "src/a.ts"));
  await put(root, "src/b.ts", "unrelated user change");
  const result = await run(root, "restore");
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /conflict|different|overwrite/i);
  await assert.rejects(stat(path.join(root, "src/a.ts")), { code: "ENOENT" });
  assert.equal(
    await readFile(path.join(root, "src/b.ts"), "utf8"),
    "unrelated user change",
  );
});

test("corrupt archive cannot be verified or restored", async (t) => {
  const root = await workspace(t);
  await put(root, "src/app.ts", "keep source");
  assert.equal((await run(root, "backup")).code, 0);
  const data = await readFile(bundle(root));
  data[Math.floor(data.length / 2)] ^= 1;
  await writeFile(bundle(root), data);
  await rm(path.join(root, "src/app.ts"));
  assert.notEqual((await run(root, "verify")).code, 0);
  assert.notEqual((await run(root, "restore")).code, 0);
  await assert.rejects(stat(path.join(root, "src/app.ts")), { code: "ENOENT" });
});

test("even a recomputed archive checksum cannot authorize a traversal entry", async (t) => {
  const root = await workspace(t);
  await put(root, "src/app.ts", "safe");
  assert.equal((await run(root, "backup")).code, 0);
  const manifest = JSON.parse(await readFile(manifestPath(root), "utf8"));
  const bytes = Buffer.from("must not escape");
  const attack = zipSync({ "../escaped.txt": bytes });
  manifest.archive.sha256 = sha(attack);
  manifest.archive.bytes = attack.length;
  manifest.entries = [
    {
      path: "../escaped.txt",
      bytes: bytes.length,
      sha256: sha(bytes),
      category: "source",
      cleanupEligible: true,
    },
  ];
  await writeFile(bundle(root), attack);
  await writeFile(manifestPath(root), JSON.stringify(manifest));
  const result = await run(root, "restore");
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /path|traversal|entry/i);
  await assert.rejects(stat(path.join(root, "../escaped.txt")), {
    code: "ENOENT",
  });
});

test("undeclared ZIP entries are rejected before extraction", async (t) => {
  const root = await workspace(t);
  await put(root, "src/app.ts", "safe");
  assert.equal((await run(root, "backup")).code, 0);
  const manifest = JSON.parse(await readFile(manifestPath(root), "utf8"));
  const attack = zipSync({
    "src/app.ts": Buffer.from("safe"),
    "src/undeclared.ts": Buffer.from("intruder"),
  });
  manifest.archive.sha256 = sha(attack);
  manifest.archive.bytes = attack.length;
  await writeFile(bundle(root), attack);
  await writeFile(manifestPath(root), JSON.stringify(manifest));
  const result = await run(root, "verify");
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /undeclared|missing|entry/i);
});

test("source-directory junctions are excluded and never followed", async (t) => {
  const root = await workspace(t);
  const external = path.join(root, "unowned");
  await mkdir(external);
  await put(root, "unowned/private.txt", "do not archive");
  try {
    await symlink(
      external,
      path.join(root, "src"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("Directory links unavailable in this environment");
      return;
    }
    throw error;
  }
  assert.equal((await run(root, "backup")).code, 0);
  const manifest = JSON.parse(await readFile(manifestPath(root), "utf8"));
  assert.ok(manifest.entries.every((entry) => !entry.path.startsWith("src/")));
  assert.ok(
    manifest.skipped.some(
      (entry) => entry.path === "src" && /link/i.test(entry.reason),
    ),
  );
});
