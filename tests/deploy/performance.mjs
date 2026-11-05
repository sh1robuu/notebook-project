import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { cpus, totalmem, release } from "node:os";
const samples = [];
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
try {
  for (let run = 0; run < 3; run++) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 1_600_000 / 8,
      uploadThroughput: 750_000 / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.addInitScript(() => {
      window.__landingLab = { lcp: 0, cls: 0 };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          window.__landingLab.lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (!entry.hadRecentInput) window.__landingLab.cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    const failures = [];
    page.on("pageerror", (e) => failures.push(e.message));
    if (run === 2)
      await cdp.send("Tracing.start", {
        categories: "devtools.timeline,loading,blink.user_timing",
        transferMode: "ReturnAsStream",
      });
    await page.goto("http://127.0.0.1:5186/", { waitUntil: "networkidle" });
    await page
      .locator(".hero-picture img")
      .evaluate(async (image) => await image.decode());
    await page.evaluate(async () => await document.fonts.ready);
    await page.waitForTimeout(1000);
    samples.push(
      await page.evaluate((failures) => {
        const navigation = performance.getEntriesByType("navigation")[0];
        const resources = performance.getEntriesByType("resource").map((r) => ({
          url: new URL(r.name).pathname,
          initiator: r.initiatorType,
          encodedBodyBytes: r.encodedBodySize,
          transferBytes: r.transferSize,
        }));
        return {
          ...window.__landingLab,
          domContentLoadedMs: navigation.domContentLoadedEventEnd,
          loadMs: navigation.loadEventEnd,
          resources,
          failures,
        };
      }, failures),
    );
    if (run === 2) {
      const completed = new Promise((resolve) =>
        cdp.once("Tracing.tracingComplete", resolve),
      );
      await cdp.send("Tracing.end");
      const { stream } = await completed;
      let text = "";
      while (true) {
        const chunk = await cdp.send("IO.read", { handle: stream });
        text += chunk.data;
        if (chunk.eof) break;
      }
      await cdp.send("IO.close", { handle: stream });
      await writeFile("docs/verification/deploy-01/landing-trace.json", text);
    }
    await context.close();
  }
  const metric = (key) => {
    const values = samples.map((s) => s[key]).sort((a, b) => a - b);
    return { min: values[0], median: values[1], max: values[2] };
  };
  const output = {
    environment: {
      browser: browser.version(),
      os: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      ramBytes: totalmem(),
      viewport: [390, 844],
      dpr: 1,
      cpuThrottle: 4,
      network: {
        latencyMs: 150,
        downloadBitsPerSecond: 1_600_000,
        uploadBitsPerSecond: 750_000,
      },
      cache: "fresh context + CDP cache disabled",
      host: "local static header adapter, uncompressed HTTP transport",
      fieldData: "unavailable",
    },
    samples,
    summary: {
      lcpMs: metric("lcp"),
      cls: metric("cls"),
      domContentLoadedMs: metric("domContentLoadedMs"),
    },
    limits: [
      "Three synthetic mobile-sized Chrome navigations, no physical device or field percentile.",
      "Local HTTP host does not measure Vercel CDN, TLS, Brotli or geographic network behavior.",
      "LCP/CLS are lab observations; no INP or production improvement claim.",
    ],
  };
  await writeFile(
    "docs/verification/deploy-01/landing-performance.json",
    JSON.stringify(output, null, 2),
  );
  console.log(JSON.stringify(output.summary, null, 2));
  if (
    samples.some(
      (s) =>
        s.failures.length ||
        s.resources.some((r) =>
          /EditorEntry|tldraw|pdf\.worker|import\.worker/.test(r.url),
        ),
    )
  )
    throw new Error("Landing isolation/console regression in lab run");
} finally {
  await browser.close();
}
