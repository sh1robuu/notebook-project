import { verifyRecovery } from "./deploy-recovery.mjs";
import { readFile, lstat, realpath, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function cleanupArchived({
  workspaceRoot = process.cwd(),
  snapshot,
  apply = false,
} = {}) {
  const verified = await verifyRecovery({ workspaceRoot, snapshot });
  const root = await realpath(workspaceRoot),
    manifest = JSON.parse(await readFile(verified.manifest, "utf8"));
  const planned = [],
    removed = [];
  async function target(entry) {
    const full = path.resolve(root, entry.path);
    if (!full.toLowerCase().startsWith(root.toLowerCase() + path.sep))
      throw new Error("Cleanup path escapes workspace");
    let parent = root;
    for (const part of entry.path.split("/")) {
      parent = path.join(parent, part);
      const st = await lstat(parent);
      if (st.isSymbolicLink())
        throw new Error("Cleanup path contains link: " + entry.path);
    }
    const info = await lstat(full);
    if (!info.isFile()) throw new Error("Cleanup path is not a regular file");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(full)) hash.update(chunk);
    if (info.size !== entry.bytes || hash.digest("hex") !== entry.sha256)
      throw new Error("Archived file changed; cleanup stopped: " + entry.path);
    return full;
  }
  for (const entry of manifest.entries) {
    if (
      !entry.cleanupEligible ||
      entry.path.startsWith("docs/verification/deploy-01/") ||
      entry.path.startsWith("tests/deploy/")
    )
      continue;
    try {
      await target(entry);
      planned.push(entry);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  // Complete preflight first. Existing changes or unarchived files are never
  // selected; each selected file is rechecked immediately before unlink.
  if (apply)
    for (const entry of planned) {
      const file = await target(entry);
      await unlink(file);
      removed.push(entry);
    }
  return {
    snapshot: verified.snapshot,
    archiveSha256: verified.archiveSha256,
    apply,
    planned,
    removed,
    bytes: removed.reduce((sum, e) => sum + e.bytes, 0),
    note: "Exact verified files only. Parent directories, caches, unarchived work and current deployment evidence are untouched.",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2),
    snapshot = args.includes("--snapshot")
      ? args[args.indexOf("--snapshot") + 1]
      : undefined;
  cleanupArchived({ snapshot, apply: args.includes("--apply") })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
