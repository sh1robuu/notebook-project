import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/deploy",
  testMatch: "production.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60000,
  outputDir: "docs/verification/deploy-01/browser-artifacts",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "docs/verification/deploy-01/production-browser.json" },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:5186",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH ||
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/deploy/static-host.mjs",
    url: "http://127.0.0.1:5186",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
