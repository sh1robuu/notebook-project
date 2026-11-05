export type SaveStatus = {
  phase: "saved" | "saving" | "error";
  error?: string;
  savedAt?: number;
};
type Options<T> = {
  read: () => T;
  write: (value: T) => Promise<unknown>;
  canSave: () => boolean;
  delayMs?: number;
};

/** Serializes durable acknowledgements; edits during a write stay dirty. */
export class SaveCoordinator<T> {
  #options: Options<T>;
  #version = 0;
  #dirty = false;
  #closed = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #inflight: Promise<void> | undefined;
  #listeners = new Set<() => void>();
  status: SaveStatus = { phase: "saved" };
  constructor(options: Options<T>) {
    this.#options = options;
  }
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  getSnapshot = () => this.status;
  #set(status: SaveStatus) {
    if (this.#closed) return;
    if (
      this.status.phase === status.phase &&
      this.status.error === status.error
    )
      return;
    this.status = status;
    for (const l of this.#listeners) l();
  }
  request() {
    if (this.#closed) return;
    this.#dirty = true;
    this.#version++;
    this.#set({ phase: "saving" });
    this.#schedule();
  }
  #schedule() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.flush().catch(() => {});
    }, this.#options.delayMs ?? 180);
  }
  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    if (this.#closed) return;
    if (this.#inflight) return this.#inflight;
    if (!this.#dirty) return;
    if (!this.#options.canSave()) {
      this.#schedule();
      return;
    }
    this.#set({ phase: "saving" });
    const drain = async () => {
      while (this.#dirty && !this.#closed) {
        if (!this.#options.canSave()) {
          this.#schedule();
          return;
        }
        const version = this.#version,
          value = this.#options.read();
        await this.#options.write(value);
        if (version === this.#version) {
          this.#dirty = false;
          this.#set({ phase: "saved", savedAt: Date.now() });
        }
      }
    };
    this.#inflight = drain()
      .catch((error) => {
        this.#set({
          phase: "error",
          error: error instanceof Error ? error.message : "Saving failed.",
        });
        throw error;
      })
      .finally(() => {
        this.#inflight = undefined;
      });
    return this.#inflight;
  }
  reset() {
    clearTimeout(this.#timer);
    this.#version++;
    this.#dirty = false;
    this.#set({ phase: "saved", savedAt: Date.now() });
  }
  close() {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#listeners.clear();
  }
}
