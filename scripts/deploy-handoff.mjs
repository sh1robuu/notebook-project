import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
const evidence = "docs/verification/deploy-01",
  checks = [];
const json = async (name) =>
  JSON.parse(await readFile(`${evidence}/${name}`, "utf8"));
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  if (!pass) throw new Error("DEPLOY-01 handoff check failed: " + name);
}
for (const [name, count] of [
  ["production-browser.json", 7],
  ["dev-browser.json", 3],
  ["legacy-correction.json", 19],
]) {
  const report = await json(name);
  check(
    name,
    report.stats.expected === count &&
      report.stats.unexpected === 0 &&
      report.stats.skipped === 0 &&
      report.stats.flaky === 0,
    report.stats,
  );
}
const legacy = await json("legacy-browser.json");
check(
  "truthful legacy record",
  legacy.stats.expected === 141 && legacy.stats.unexpected === 1,
  "Full run141pass/one old-route assertion; corrected affected19-test run passes separately",
);
const testLog = await readFile(`${evidence}/final-tests.log`, "utf8");
check(
  "retained units/build",
  /pass 13/.test(testLog) &&
    /fail 0/.test(testLog) &&
    /built in/.test(testLog) &&
    /Prerendered Vietnamese/.test(testLog),
  "Fresh npm test after cleanup",
);
const restored = await readFile(`${evidence}/restored-unit.log`, "utf8");
check(
  "actual recovery proof",
  /pass 105/.test(restored) &&
    /fail 0/.test(restored) &&
    (await json("restore-proof.json")).restored === 195,
  "195 files restored,105 units pass, then cleaned again",
);
const audit = await json("final-audit.json");
check(
  "known dependency advisories",
  audit.metadata.vulnerabilities.total === 0,
  audit.metadata.vulnerabilities,
);
const build = await json("build-audit.json");
check(
  "output exclusion",
  build.sourceMaps === 0 &&
    build.privateOrDevelopmentOutputs.length === 0 &&
    build.prerendered &&
    build.workerFiles.length === 5,
  build,
);
const perf = await json("landing-performance.json");
check(
  "three recorded cold runs",
  perf.samples.length === 3 &&
    perf.samples.every(
      (s) =>
        s.failures.length === 0 &&
        !s.resources.some((r) =>
          /EditorEntry|tldraw|pdf\.worker|import\.worker/.test(r.url),
        ),
    ),
  perf.summary,
);
const cli = await readFile(`${evidence}/cli-flow.log`, "utf8");
check(
  "CLI recovery/menu",
  cli.includes('"verified":true') &&
    cli.includes('"mobileMenuVerified":true') &&
    cli.includes("Browser 'deploy-final' closed"),
  "Built CTA, vi notice, no database, mobile focus",
);
const layout = await readFile(`${evidence}/design-final.log`, "utf8");
check(
  "design inspector",
  layout.includes("RESULT: 0 FAIL"),
  "1440/768/390 screenshots inspected; documented warnings",
);
for (const width of [1440, 768, 390])
  check(
    `axe${width}`,
    (await json(`axe-${width}.json`)).length === 0,
    "Automated coverage, not WCAG certification",
  );
const removed = await json("removed-files.json"),
  cache = await json("removed-caches.json");
check(
  "cleanup exact ledger",
  removed.removed.length === 1602 && removed.bytes === 1025142022,
  "Archive IDs/SHA retained per file",
);
check(
  "cache ledger",
  cache.reduce((sum, c) => sum + c.files.length, 0) === 36492,
  "Regenerable caches separately listed",
);
for (const item of removed.removed) {
  try {
    await stat(item.path);
    throw new Error("Archived file still active: " + item.path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const independent = await json("recovery-independent-final.json");
check(
  "independent ZIP proof",
  independent.verified && independent.crcFailure === null,
  "Independent CRC plus recovery SHA/entry validation",
);
const documents = [
  "README.md",
  "docs/deployment.md",
  "docs/cleanup-inventory.md",
  "docs/decisions/deploy-01-hosting.md",
  "docs/design/deploy-01-landing.md",
  "docs/design/deploy-01-critique.md",
  "docs/verification/README.md",
  `${evidence}/results.md`,
  `${evidence}/review.md`,
  "docs/superpowers/plans/2026-11-05-deploy-01.md",
];
const missing = [];
for (const file of documents) {
  const contents = await readFile(file, "utf8");
  for (const match of contents.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    try {
      await stat(path.resolve(path.dirname(file), decodeURIComponent(target)));
    } catch {
      missing.push({ file, target });
    }
  }
}
check("current documentation links", missing.length === 0, missing);
async function walk(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      ),
    )
  ).flat();
}
async function fingerprint(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { file, bytes: (await stat(file)).size, sha256: hash.digest("hex") };
}
const blueprints = [
  "product-requirements",
  "technical-architecture",
  "implementation-roadmap",
  "feature-parity-matrix",
  "design-system",
  "reference-audit",
  "testing-strategy",
  "risks-and-unknowns",
].map((n) => `docs/${n}.md`);
const matrix = await readFile("docs/feature-parity-matrix.md", "utf8");
check(
  "all42 contracts retained",
  new Set([...matrix.matchAll(/^\|\s*(F\d{2})\s*\|/gm)].map((m) => m[1]))
    .size === 42,
  "S05A/S06 unstarted",
);
const configFiles = (await readdir(".")).filter((f) =>
  /^(package(-lock)?\.json|vite\.config\.ts|playwright.*\.ts|tsconfig.*\.json|index\.html|\.gitignore|\.vercelignore|vercel\.json|\.env\.example)$/.test(
    f,
  ),
);
const sourceFiles = [
  ...new Set([
    ...documents,
    ...blueprints,
    ...configFiles,
    ...(await walk("src")),
    ...(await walk("scripts")),
    ...(await walk("tests/deploy")),
    ...(await walk("public")),
  ]),
].sort();
await writeFile(
  `${evidence}/source-manifest.json`,
  JSON.stringify(
    { files: await Promise.all(sourceFiles.map(fingerprint)) },
    null,
    2,
  ),
);
const artifactFiles = (await walk(evidence))
  .filter(
    (f) =>
      /\.(json|png|jpg|log)$/.test(f) &&
      !/(source-manifest|artifact-manifest|final-handoff)\.(json|log)$/.test(
        f,
      ) &&
      !/server\.log$/.test(f),
  )
  .sort();
await writeFile(
  `${evidence}/artifact-manifest.json`,
  JSON.stringify(
    { files: await Promise.all(artifactFiles.map(fingerprint)) },
    null,
    2,
  ),
);
await writeFile(
  `${evidence}/final-handoff.json`,
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      checks,
      sourceFiles: sourceFiles.length,
      artifacts: artifactFiles.length,
      status:
        "Local landing-only deployment preparation verified; no hosted deployment. Public editor blocked by unconfigured license/domain/HTTPS verification. S05A/S06 unstarted; N01/N05 and legacy/device/reference gates unchanged.",
    },
    null,
    2,
  ),
);
console.log(
  `DEPLOY-01: ${checks.length} handoff checks; ${sourceFiles.length} source/config/doc files; ${artifactFiles.length} evidence files. No deployment claimed.`,
);
