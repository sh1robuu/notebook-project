import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupRecovery } from "../../scripts/deploy-recovery.mjs";
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "lessonboard-cleanup-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.match(path.basename(root), /^lessonboard-cleanup-/);
    await rm(root, { recursive: true, force: true });
  });
  for (const p of [
    "src",
    "tests/unit",
    "tests/deploy",
    "experiments/s05",
    "docs/verification/deploy-01",
  ])
    await mkdir(path.join(root, p), { recursive: true });
  for (const p of [
    "src/app.ts",
    "tests/unit/old.test.ts",
    "tests/deploy/keep.test.ts",
    "experiments/s05/fixture.txt",
    "docs/verification/deploy-01/result.json",
  ])
    await writeFile(path.join(root, p), p);
  await backupRecovery({ workspaceRoot: root, snapshot: "fixture" });
  return root;
}
test("cleanup plan and apply remove exact archived development files, retaining runtime and current verification", async (t) => {
  const root = await fixture(t);
  const { cleanupArchived } = await import("../../scripts/deploy-cleanup.mjs");
  const plan = await cleanupArchived({
    workspaceRoot: root,
    snapshot: "fixture",
  });
  assert.equal(plan.removed.length, 0);
  assert.equal(plan.planned.length, 2);
  await writeFile(
    path.join(root, "experiments/s05/unarchived-user-note.txt"),
    "keep",
  );
  const result = await cleanupArchived({
    workspaceRoot: root,
    snapshot: "fixture",
    apply: true,
  });
  assert.equal(result.removed.length, 2);
  for (const p of [
    "src/app.ts",
    "tests/deploy/keep.test.ts",
    "experiments/s05/unarchived-user-note.txt",
    "docs/verification/deploy-01/result.json",
  ])
    assert.ok((await stat(path.join(root, p))).isFile());
  await assert.rejects(stat(path.join(root, "tests/unit/old.test.ts")), {
    code: "ENOENT",
  });
});
test("a changed archived file stops all deletion before cleanup begins", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "tests/unit/old.test.ts"), "new user work");
  const { cleanupArchived } = await import("../../scripts/deploy-cleanup.mjs");
  await assert.rejects(
    cleanupArchived({ workspaceRoot: root, snapshot: "fixture", apply: true }),
    /changed|differs/i,
  );
  assert.equal(
    await readFile(path.join(root, "tests/unit/old.test.ts"), "utf8"),
    "new user work",
  );
  assert.ok(
    (await stat(path.join(root, "experiments/s05/fixture.txt"))).isFile(),
  );
});
