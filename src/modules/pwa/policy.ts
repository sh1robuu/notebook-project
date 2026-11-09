export type OfflineAssetGroup = "core" | "pdf";
export type WorkerRequest = {
  version: 1;
  id: string;
  type: "STATUS" | "PREPARE" | "ACTIVATE" | "CONFIRM_BUILD";
  buildId?: string;
};
export type PrecacheAsset = {
  url: string;
  revision: string;
  integrity: string;
  bytes: number;
};
export type OfflineBuild = {
  protocol: 1;
  buildId: string;
  appVersion: string;
  databaseVersion: number;
  coreBytes: number;
  pdfBytes: number;
  coreCount: number;
  pdfCount: number;
};
export type WorkerStatus = OfflineBuild & {
  coreReady: boolean;
  pdfReady: boolean;
  appClients: number;
};
export type WorkerReply = {
  version: 1;
  id: string;
  ok: boolean;
  status?: WorkerStatus;
  error?: string;
};

export function offlineAssetGroup(path: string): OfflineAssetGroup | null {
  if (
    !path.startsWith("/") ||
    /[\\%?#\u0000-\u0020]/.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  ) return null;
  if (
    path === "/app" ||
    path === "/manifest.webmanifest" ||
    path === "/mark.svg" ||
    /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|jpe?g|webp)$/.test(path) ||
    /^\/app\/runtime\/[A-Za-z0-9_.-]+\.(?:js|mjs)$/.test(path) ||
    /^\/fonts\/[A-Za-z0-9_.-]+\.woff2$/.test(path) ||
    /^\/tldraw\/fonts\/[A-Za-z0-9_.-]+\.woff2$/.test(path) ||
    path === "/tldraw/icons/icon/0_merged.svg" ||
    /^\/tldraw\/embed-icons\/[A-Za-z0-9_.-]+\.png$/.test(path) ||
    /^\/icons\/[A-Za-z0-9_.-]+\.png$/.test(path)
  ) return "core";
  if (
    /^\/pdfjs\/(?:cmaps|standard_fonts|wasm|iccs)\/[A-Za-z0-9_.-]+\.(?:bcmap|pfb|ttf|otf|wasm|js|icc)$/.test(path)
  ) return "pdf";
  return null;
}

export function isWorkspaceClient(value: string, origin: string) {
  try {
    const url = new URL(value);
    return url.origin === origin && /^\/app(?:\/|$)/.test(url.pathname) &&
      !url.pathname.startsWith("/app/runtime/");
  } catch {
    return false;
  }
}

export function readWorkerRequest(input: unknown): WorkerRequest | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== (value.type === "CONFIRM_BUILD" ? 4 : 3) ||
    !Object.hasOwn(value, "version") || !Object.hasOwn(value, "id") || !Object.hasOwn(value, "type") ||
    value.version !== 1 ||
    typeof value.id !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id) ||
    typeof value.type !== "string" ||
    !["STATUS", "PREPARE", "ACTIVATE", "CONFIRM_BUILD"].includes(value.type) ||
    (value.type === "CONFIRM_BUILD" &&
      (!Object.hasOwn(value, "buildId") || typeof value.buildId !== "string" || !/^[a-f0-9]{20}$/.test(value.buildId)))
  ) return null;
  return value as WorkerRequest;
}
