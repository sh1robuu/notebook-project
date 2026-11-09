import { WORKSPACE_SCHEMA_VERSION } from "../../config/version.ts";
import type { WorkerReply, WorkerRequest, WorkerStatus } from "./policy.ts";

export type OfflineSnapshot = {
  supported: boolean;
  phase: "idle" | "preparing" | "ready" | "error" | "unsupported";
  coreReady: boolean;
  pdfReady: boolean;
  buildId?: string;
  coreBytes: number;
  pdfBytes: number;
  appClients: number;
  network: boolean;
  update: "current" | "checking" | "available" | "preparing" | "activating" | "error";
  error?: string;
  updateError?: string;
  installAvailable: boolean;
  installed: boolean;
};

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const failure = (error: unknown) =>
  error instanceof Error ? error.message : "Không thể chuẩn bị dùng ngoại tuyến.";

function workerRequest(
  worker: ServiceWorker,
  type: WorkerRequest["type"],
  buildId?: string,
): Promise<WorkerStatus> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const channel = new MessageChannel();
    const close = () => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
    };
    const timer = setTimeout(() => {
      close();
      reject(new Error("Tải tệp ngoại tuyến quá lâu. Hãy thử lại khi có mạng."));
    }, type === "PREPARE" ? 120_000 : 15_000);
    channel.port1.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (data?.version !== 1 || data.id !== id) return;
      close();
      if (data.ok && data.status) resolve(data.status);
      else reject(new Error(data.error || "Không thể hoàn tất yêu cầu ngoại tuyến."));
    };
    const request: WorkerRequest = {
      version: 1, id, type,
      ...(type === "CONFIRM_BUILD" ? { buildId } : {}),
    };
    try {
      worker.postMessage(request, [channel.port2]);
    } catch (error) {
      close();
      reject(error);
    }
  });
}

function waitForActivation(worker: ServiceWorker) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", change);
    };
    const change = () => {
      if (worker.state === "activated") {
        finish();
        resolve();
      } else if (worker.state === "redundant") {
        finish();
        reject(new Error("Bản cập nhật không thể kích hoạt. Bạn vẫn có thể dùng bản hiện tại."));
      }
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("Chưa kích hoạt được bản cập nhật. Hãy thử lại."));
    }, 20_000);
    worker.addEventListener("statechange", change);
    change();
  });
}

class OfflineWorkspace {
  #listeners = new Set<() => void>();
  #registration?: ServiceWorkerRegistration;
  #initializing?: Promise<void>;
  #observeRegistration?: () => void;
  #users = 0;
  #cleanup?: () => void;
  #installPrompt?: InstallPrompt;
  #documentBuild?: string;
  #state: OfflineSnapshot = {
    supported: false,
    phase: "idle",
    coreReady: false,
    pdfReady: false,
    coreBytes: 0,
    pdfBytes: 0,
    appClients: 0,
    network: typeof navigator === "undefined" ? true : navigator.onLine,
    update: "current",
    installAvailable: false,
    installed: false,
  };
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };
  getSnapshot = () => this.#state;
  #set(next: Partial<OfflineSnapshot>) {
    this.#state = { ...this.#state, ...next };
    for (const listener of this.#listeners) listener();
  }

  start = () => {
    this.#users++;
    if (this.#users === 1) {
      const network = () => this.#set({ network: navigator.onLine });
      const prompt = (event: Event) => {
        event.preventDefault();
        this.#installPrompt = event as InstallPrompt;
        this.#set({ installAvailable: true });
      };
      const installed = () => {
        this.#installPrompt = undefined;
        this.#set({ installed: true, installAvailable: false });
      };
      window.addEventListener("online", network);
      window.addEventListener("offline", network);
      window.addEventListener("beforeinstallprompt", prompt);
      window.addEventListener("appinstalled", installed);
      this.#cleanup = () => {
        window.removeEventListener("online", network);
        window.removeEventListener("offline", network);
        window.removeEventListener("beforeinstallprompt", prompt);
        window.removeEventListener("appinstalled", installed);
      };
      this.#set({ installed: matchMedia("(display-mode: standalone)").matches });
      this.#documentBuild = document.querySelector<HTMLMetaElement>('meta[name="lessonboard-build"]')?.content;
      this.#initializing ??= this.#register();
      if (this.#registration?.active) void this.#refreshStatus().catch((error: unknown) => {
        this.#set({ phase: "error", error: failure(error) });
      });
    }
    return () => {
      this.#users = Math.max(0, this.#users - 1);
      if (!this.#users) this.#cleanup?.();
    };
  };

  async #register() {
    if (!import.meta.env.PROD || !window.isSecureContext || !("serviceWorker" in navigator)) {
      this.#set({ phase: "unsupported", supported: false });
      return;
    }
    this.#set({ supported: true, phase: "preparing", error: undefined });
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/app",
        updateViaCache: "none",
      });
      this.#registration = registration;
      await new Promise<void>((resolve, reject) => {
        const initialError = "Chưa tải xong tệp ngoại tuyến. Giữ kết nối mạng và thử lại.";
        const timer = setTimeout(() => reject(new Error(initialError)), 120_000);
        this.#observeRegistration?.();
        const installing = () => {
          const worker = registration.installing;
          if (!worker) return;
          const changed = () => {
            if (worker.state === "installed" && registration.active) {
              this.#set({ update: "available", updateError: undefined });
            } else if (worker.state === "redundant") {
              worker.removeEventListener("statechange", changed);
              if (registration.active) this.#set({ update: "error", updateError: "Không tải đủ tệp của bản cập nhật. Bản đang mở vẫn dùng được." });
              else {
                clearTimeout(timer);
                reject(new Error(initialError));
              }
            } else if (worker.state === "activated") worker.removeEventListener("statechange", changed);
          };
          worker.addEventListener("statechange", changed);
        };
        registration.addEventListener("updatefound", installing);
        this.#observeRegistration = () => registration.removeEventListener("updatefound", installing);
        installing();
        if (registration.waiting) this.#set({ update: "available" });
        void navigator.serviceWorker.ready.then(() => { clearTimeout(timer); resolve(); }, reject);
      });
      await this.#refreshStatus();
    } catch (error) {
      this.#set({ phase: "error", error: failure(error) });
    }
  }

  async #refreshStatus() {
    const worker = this.#registration?.active;
    if (!worker) return;
    const state = await workerRequest(worker, "STATUS");
    this.#accept(state);
    if (this.#documentBuild === state.buildId)
      await workerRequest(worker, "CONFIRM_BUILD", state.buildId);
  }

  #accept(state: WorkerStatus) {
    const mismatched = this.#documentBuild && this.#documentBuild !== state.buildId;
    this.#set({
      buildId: state.buildId,
      coreBytes: state.coreBytes,
      pdfBytes: state.pdfBytes,
      coreReady: state.coreReady && !mismatched,
      pdfReady: state.pdfReady && !mismatched,
      appClients: state.appClients,
      phase: state.coreReady && state.pdfReady && !mismatched ? "ready" : "idle",
      error: mismatched ? "Phiên bản đang mở khác với bộ tệp ngoại tuyến. Hãy cập nhật sau khi lưu bài." : undefined,
    });
  }

  prepareOffline = async () => {
    if (this.#state.supported && this.#state.phase === "error" && !this.#registration?.active)
      this.#initializing = this.#register();
    await (this.#initializing ??= this.#register());
    const worker = this.#registration?.active;
    if (!worker) throw new Error("Chưa có bộ tệp ngoại tuyến. Hãy mở lại bảng khi có mạng.");
    this.#set({ phase: "preparing", error: undefined });
    try {
      this.#accept(await workerRequest(worker, "PREPARE"));
    } catch (error) {
      this.#set({ phase: "error", error: failure(error) });
      throw error;
    }
  };

  checkForUpdate = async () => {
    await (this.#initializing ??= this.#register());
    if (!this.#registration) throw new Error("Trình duyệt chưa hỗ trợ cập nhật ngoại tuyến.");
    this.#set({ update: "checking", updateError: undefined });
    try {
      await this.#registration.update();
      this.#set({ update: this.#registration.waiting ? "available" : this.#registration.installing ? "checking" : "current" });
    } catch (error) {
      this.#set({ update: "error", updateError: failure(error) });
      throw error;
    }
  };

  activateUpdate = async (prepare: () => Promise<void | (() => void)>) => {
    const candidate = this.#registration?.waiting;
    if (!candidate) throw new Error("Chưa có bản cập nhật chờ kích hoạt.");
    let unlock: void | (() => void) = undefined;
    this.#set({ update: "preparing", updateError: undefined });
    try {
      const state = await workerRequest(candidate, "STATUS");
      if (state.appClients !== 1)
        throw new Error("Hãy đóng các tab bảng giảng khác trước khi cập nhật.");
      if (state.databaseVersion !== WORKSPACE_SCHEMA_VERSION)
        throw new Error("Bản này thay đổi cấu trúc lưu trữ. Hãy lưu và đóng mọi tab bảng giảng rồi mở lại.");
      await workerRequest(candidate, "PREPARE");
      unlock = await prepare();
      this.#set({ update: "activating" });
      const activated = waitForActivation(candidate);
      // Handle rejection even if message delivery fails before the awaited step.
      void activated.catch(() => {});
      await workerRequest(candidate, "ACTIVATE");
      await activated;
      window.location.reload();
    } catch (error) {
      unlock?.();
      this.#set({ update: "error", updateError: failure(error) });
      throw error;
    }
  };

  install = async () => {
    const prompt = this.#installPrompt;
    if (!prompt) throw new Error("Dùng mục Cài đặt ứng dụng trong trình duyệt nếu có.");
    await prompt.prompt();
    await prompt.userChoice;
    this.#installPrompt = undefined;
    this.#set({ installAvailable: false });
  };
}

export const offlineWorkspace = new OfflineWorkspace();
