import { access } from "node:fs/promises";
for (const file of [
  "playwright.legacy.config.ts",
  "tests/unit/s05-storage.test.ts",
  "tests/e2e/helpers.ts",
  "experiments/s05/fixtures/small-math.docx",
]) {
  try {
    await access(file);
  } catch {
    throw new Error(
      "Legacy verification material is archived. Verify and restore after-deploy-01-validation with --scope tests; see docs/cleanup-inventory.md. No tests were run.",
    );
  }
}
console.log(
  "Restored legacy suite is present. Run node --test tests/unit/*.test.ts and npx playwright test -c playwright.legacy.config.ts.",
);
