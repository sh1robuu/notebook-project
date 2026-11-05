import test from "node:test";
import assert from "node:assert/strict";
import { editorReleaseState } from "../../src/config/release.ts";

test("local development preserves the existing editor without deployment credentials", () => {
  for (const enabled of [undefined, "false", "true"])
    for (const licenseKey of [undefined, "", " ", "public-sdk-key"])
      assert.equal(
        editorReleaseState({ production: false, enabled, licenseKey }),
        "development",
      );
});

test("production editor requires the exact deliberate release flag", () => {
  for (const enabled of [undefined, "", "false", "1", "TRUE", " true", "true "])
    assert.equal(
      editorReleaseState({
        production: true,
        enabled,
        licenseKey: "public-sdk-key",
      }),
      "unavailable",
    );
});

test("production editor stays unavailable when its public SDK key is absent or blank", () => {
  for (const licenseKey of [undefined, "", " ", "\t\n"])
    assert.equal(
      editorReleaseState({ production: true, enabled: "true", licenseKey }),
      "unavailable",
    );
});

test("explicit production configuration allows SDK loading without claiming license validity", () => {
  assert.equal(
    editorReleaseState({
      production: true,
      enabled: "true",
      licenseKey: "public-sdk-key",
    }),
    "enabled",
  );
});
