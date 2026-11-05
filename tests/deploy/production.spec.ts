import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile, readFile, readdir } from "node:fs/promises";

test("production landing and unavailable editor never initialize lesson data or load heavy modules", async ({
  page,
}) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Giảng theo mạch riêng", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Mở bảng giảng", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("heading", { name: "Bảng giảng chưa mở", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Bảng giảng chưa mở", exact: true }),
  ).toBeVisible();
  await page.goto("/app?enableEditor=true&licenseKey=fake");
  await expect(
    page.getByRole("heading", { name: "Bảng giảng chưa mở", exact: true }),
  ).toBeVisible();
  // Wait beyond the SDK's documented five-second production license stop.
  // The gate must remain stable without ever mounting the SDK.
  await page.waitForTimeout(5500);
  await expect(
    page.getByRole("button", { name: "Pen", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(async () => await indexedDB.databases())).toEqual(
    [],
  );
  expect(
    requests.filter((u) =>
      /EditorEntry|pdf\.worker|import\.worker|tldraw|docx-preview/.test(u),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await page.goBack();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Giảng theo mạch riêng", exact: true }),
  ).toBeVisible();
});

for (const width of [1440, 768, 390])
  test(`landing interactions and accessibility at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    if (width === 390) {
      await page
        .getByRole("button", { name: "Mở trình đơn", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Đóng trình đơn", exact: true }),
      ).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Mở trình đơn", exact: true }),
      ).toBeFocused();
    }
    const first = page.getByRole("tab").first();
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "Nháp độc lập", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel").getByRole("img")).toHaveAttribute(
      "src",
      "/product/scratchpad.webp",
    );
    await page.keyboard.press("End");
    await expect(
      page.getByRole("tab", { name: "Word và công thức", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tabpanel").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    await writeFile(
      `docs/verification/deploy-01/axe-${width}.json`,
      JSON.stringify(audit.violations, null, 2),
    );
    expect(audit.violations).toEqual([]);
    await page.screenshot({
      path: `docs/verification/deploy-01/landing-${width}.png`,
      fullPage: true,
    });
  });

test("static routes, headers, runtime assets and hidden development data", async ({
  page,
  request,
}) => {
  const app = await request.get("/app");
  expect(app.status()).toBe(200);
  expect(app.headers()["x-robots-tag"]).toContain("noindex");
  const appUnknown = await request.get("/app/unknown");
  expect(appUnknown.status()).toBe(200);
  expect(appUnknown.headers()["x-robots-tag"]).toContain("noindex");
  const csp = app.headers()["content-security-policy"];
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("'unsafe-eval'");
  await page.goto("/app/unknown");
  await expect(
    page.getByRole("heading", { name: "Không tìm thấy trang", exact: true }),
  ).toBeVisible();
  expect((await request.get("/unknown")).status()).toBe(404);
  for (const route of [
    "/api/nope",
    "/assets/nope.js",
    "/pdfjs/nope.wasm",
    "/tests/e2e/helpers.ts",
    "/experiments/s05/fixtures/small-math.docx",
    "/docs/deployment.md",
    "/.env",
    "/.recovery/deploy-01/bundle.zip",
  ]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(404);
    expect(response.headers()["content-type"], route).not.toContain(
      "text/html",
    );
  }
  for (const route of [
    "/pdfjs/wasm/qcms_bg.wasm",
    "/pdfjs/wasm/openjpeg.wasm",
  ]) {
    const response = await request.get(route);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/wasm");
  }
  const compiled = await page.evaluate(async () => {
    const r = await fetch("/pdfjs/wasm/qcms_bg.wasm");
    await WebAssembly.compileStreaming(r);
    return true;
  });
  expect(compiled).toBe(true);
  expect(
    (await request.get("/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap")).status(),
  ).toBe(200);
  expect(
    (
      await request.get("/pdfjs/standard_fonts/LiberationSans-Regular.ttf")
    ).status(),
  ).toBe(200);
});

test("reduced motion keeps content visible and all real pictures load", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const image of await page.locator("main img").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect(image).toBeVisible();
    expect(
      await image.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    ).toBe(true);
  }
  const animation = await page
    .locator(".hero-picture img")
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe("none");
  await page.screenshot({
    path: "docs/verification/deploy-01/reduced-motion.png",
    fullPage: true,
  });
});

test("emitted DOCX and PDF resource workers execute under the deployment CSP", async ({
  page,
  request,
}) => {
  const assets = await readdir("dist/assets");
  const docx = assets.find((f) => /^import\.worker-.*\.js$/.test(f))!;
  const pdf = assets.find((f) => /^source-check\.worker-.*\.js$/.test(f))!;
  for (const file of assets.filter((f) => /worker.*\.(js|mjs)$/.test(f))) {
    const response = await request.get("/assets/" + file);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("javascript");
    expect(response.headers()["cache-control"]).toContain("immutable");
  }
  const docxBytes = [...(await readFile("tests/deploy/fixtures/smoke.docx"))],
    pdfBytes = [...(await readFile("tests/deploy/fixtures/smoke.pdf"))];
  await page.goto("/");
  const result = await page.evaluate(
    async ({ docx, pdf, docxBytes, pdfBytes }) => {
      async function run(url: string, bytes: number[], name?: string) {
        const worker = new Worker("/assets/" + url, { type: "module" });
        try {
          return await new Promise<any>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Worker timeout")),
              15000,
            );
            worker.onerror = (e) => {
              clearTimeout(timer);
              reject(new Error(e.message));
            };
            worker.onmessage = (e) => {
              if (e.data.type === "progress") return;
              clearTimeout(timer);
              resolve(e.data);
            };
            worker.postMessage({ bytes: new Uint8Array(bytes), name });
          });
        } finally {
          worker.terminate();
        }
      }
      const word = await run(docx, docxBytes, "smoke.docx"),
        pdfCheck = await run(pdf, pdfBytes);
      return {
        wordType: word.type,
        wordBlocks: word.result?.document.blocks.length,
        pdfCheck,
      };
    },
    { docx, pdf, docxBytes, pdfBytes },
  );
  expect(result.wordType).toBe("result");
  expect(result.wordBlocks).toBe(17);
  expect(result.pdfCheck).toEqual({ ok: true });
});
