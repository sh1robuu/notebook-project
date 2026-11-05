import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/deploy",
  testMatch: "routes.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: [
    ["list"],
    ["json", { outputFile: "docs/verification/deploy-01/dev-browser.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5188",
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
    command: "npm run dev -- --port 5188",
    url: "http://127.0.0.1:5188",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
