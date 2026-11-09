import { PrecacheController, PrecacheRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { isWorkspaceClient, readWorkerRequest } from "./policy.ts";
import type { OfflineBuild, PrecacheAsset, WorkerReply, WorkerStatus } from "./policy.ts";

declare const self: ServiceWorkerGlobalScope;
declare const __PWA_CORE_ASSETS__: PrecacheAsset[];
declare const __PWA_PDF_ASSETS__: PrecacheAsset[];
declare const __PWA_BUILD__: OfflineBuild;

const build = __PWA_BUILD__;
const coreAssets = __PWA_CORE_ASSETS__;
const pdfAssets = __PWA_PDF_ASSETS__;
const core = new PrecacheController({
  cacheName: "lessonboard-core-" + build.buildId,
  fallbackToNetwork: false,
});
const pdf = new PrecacheController({
  cacheName: "lessonboard-pdf-" + build.buildId,
});
core.addToCacheList(coreAssets);
pdf.addToCacheList(pdfAssets);
const exact = { ignoreURLParametersMatching: [], cleanURLs: false, directoryIndex: "" };
registerRoute(new NavigationRoute(core.createHandlerBoundToURL("/app"), {
  allowlist: [/^\/app(?:[/?]|$)/],
  denylist: [/^\/app\/runtime\//],
}));
registerRoute(new PrecacheRoute(core, exact));
registerRoute(new PrecacheRoute(pdf, exact));

async function workspaceClients() {
  return (await self.clients.matchAll({ type: "window", includeUncontrolled: true }))
    .filter((client) => isWorkspaceClient(client.url, self.location.origin));
}

async function complete(controller: PrecacheController) {
  const cache = await caches.open(controller.strategy.cacheName);
  for (const key of controller.getURLsToCacheKeys().values())
    if (!(await cache.match(key))) return false;
  return true;
}

async function status(): Promise<WorkerStatus> {
  return {
    ...build,
    coreReady: await complete(core),
    pdfReady: await complete(pdf),
    appClients: (await workspaceClients()).length,
  };
}

async function prepareAssets(
  controller: PrecacheController,
  assets: readonly PrecacheAsset[],
) {
  const cache = await caches.open(controller.strategy.cacheName);
  for (const asset of assets) {
    const key = controller.getCacheKeyForURL(asset.url);
    if (!key || await cache.match(key)) continue;
    const request = new Request(new URL(asset.url, self.location.origin), {
      integrity: asset.integrity,
      credentials: "same-origin",
      cache: "reload",
      redirect: "error",
    });
    const response = await fetch(request);
    if (!response.ok) throw new Error("Không tải được tệp ngoại tuyến. Hãy thử lại khi có mạng.");
    await cache.put(key, response);
  }
}

self.addEventListener("install", (event) => {
  // A failed or incomplete candidate never displaces the current worker.
  event.waitUntil(core.install(event));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(core.activate(event));
  // Activation never claims an uncontrolled tab or changes IndexedDB.
});

let preparing: Promise<void> | undefined;
self.addEventListener("message", (event) => {
  const request = readWorkerRequest(event.data);
  const source = event.source;
  const port = event.ports[0];
  if (
    !request || !source || !("id" in source) || !port ||
    !isWorkspaceClient(source.url, self.location.origin)
  ) return;
  event.waitUntil((async () => {
    const reply = (value: Omit<WorkerReply, "version" | "id">) =>
      port.postMessage({ ...value, version: 1, id: request.id } satisfies WorkerReply);
    try {
      if (request.type === "PREPARE") {
        preparing ??= (async () => {
          if (!(await complete(core))) await prepareAssets(core, coreAssets);
          if (!(await complete(pdf))) await prepareAssets(pdf, pdfAssets);
        })().finally(() => { preparing = undefined; });
        await preparing;
      }
      const current = await status();
      if (request.type === "PREPARE" && (!current.coreReady || !current.pdfReady))
        throw new Error("Chưa tải đủ tệp ngoại tuyến. Hãy thử lại khi có mạng.");
      if (
        request.type === "CONFIRM_BUILD" &&
        request.buildId === build.buildId &&
        !self.registration.waiting &&
        !self.registration.installing &&
        current.appClients === 1 &&
        current.coreReady
      ) {
        const retained = new Set([core.strategy.cacheName, pdf.strategy.cacheName]);
        const names = await caches.keys();
        for (const name of names) {
          if (self.registration.installing || self.registration.waiting) break;
          if (/^lessonboard-(?:core|pdf)-[a-f0-9]{20}$/.test(name) && !retained.has(name))
            await caches.delete(name);
        }
      }
      if (request.type === "ACTIVATE") {
        if (!current.coreReady || !current.pdfReady)
          throw new Error("Chưa tải xong tệp ngoại tuyến của bản mới.");
        const clients = await workspaceClients();
        if (clients.length !== 1 || clients[0].id !== source.id)
          throw new Error("Hãy đóng các tab bảng giảng khác trước khi cập nhật.");
        await self.skipWaiting();
        reply({ ok: true, status: current });
      } else reply({ ok: true, status: current });
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? error.message : "Không thể chuẩn bị tệp ngoại tuyến." });
    }
  })());
});
