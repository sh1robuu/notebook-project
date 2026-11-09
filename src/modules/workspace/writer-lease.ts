import type { WorkspaceDatabase } from "./database.ts";
import { WorkspaceError } from "./contracts.ts";

type HeldLock = { exclusive: boolean; usesLocks: boolean; release: () => void };
export type PreparedWriter = { id: string; generation: number; lock: HeldLock };
const keyFor = (id: string) => "writer:" + id;
const unlocked = (usesLocks: boolean): HeldLock => ({
  exclusive: false,
  usesLocks,
  release() {},
});

/** IndexedDB generations fence writes; Web Locks improve crash handover. */
export class WriterLease {
  readonly owner = crypto.randomUUID();
  #current?: PreparedWriter;
  #closed = false;
  #heartbeat?: ReturnType<typeof setInterval>;
  #channel?: BroadcastChannel;
  readOnly = true;
  constructor(
    readonly db: WorkspaceDatabase,
    readonly changed: () => void,
    readonly updated: () => void,
  ) {
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.#channel = new BroadcastChannel(
          "lessonboard:ownership:" + db.name,
        );
      } catch {
        // Storage generations remain authoritative without channel support.
        return;
      }
      this.#channel.onmessage = ({ data }) => {
        if (data?.type === "changed" && data.id === this.#current?.id) {
          this.updated();
          void this.check().catch(() => {});
        }
      };
    }
  }
  get id() {
    return this.#current?.id;
  }
  async prepare(id: string, settleClosingTab = false): Promise<PreparedWriter> {
    if (!navigator.locks) return { id, generation: 0, lock: unlocked(false) };
    const abort = new AbortController();
    // A tab closing or crashing can release its lock shortly after its window
    // disappears. A bounded queue wait avoids returning a false secondary view.
    const timer = settleClosingTab
      ? setTimeout(() => abort.abort(), 500)
      : undefined;
    try {
      const lock = await new Promise<HeldLock>((resolve) => {
        navigator.locks
          .request(
            "lessonboard:writer:" + this.db.name + ":" + id,
            settleClosingTab ? { signal: abort.signal } : { ifAvailable: true },
            (held) => {
              if (!held) {
                resolve(unlocked(true));
                return;
              }
              return new Promise<void>((release) => {
                resolve({ exclusive: true, usesLocks: true, release });
              });
            },
          )
          .catch(() => resolve(unlocked(abort.signal.aborted)));
      });
      return { id, generation: 0, lock };
    } finally {
      clearTimeout(timer);
    }
  }
  async claim(writer: PreparedWriter, force = false) {
    const previous = await this.db.leases.get(keyFor(writer.id));
    const liveLock = writer.lock.usesLocks && !writer.lock.exclusive;
    const liveLease =
      previous &&
      previous.expiresAt > Date.now() &&
      !(writer.lock.exclusive && previous.mode === "web-lock");
    if (!force && (liveLock || liveLease)) return;
    writer.generation = (previous?.generation ?? 0) + 1;
    await this.db.leases.put({
      key: keyFor(writer.id),
      owner: this.owner,
      generation: writer.generation,
      expiresAt: Date.now() + 30_000,
      mode: writer.lock.exclusive ? "web-lock" : "lease",
    });
  }
  activate(writer: PreparedWriter) {
    const old = this.#current;
    clearInterval(this.#heartbeat);
    if (old !== writer) old?.lock.release();
    this.#current = writer;
    this.setReadOnly(writer.generation === 0);
    if (this.readOnly) writer.lock.release();
    else {
      this.#heartbeat = setInterval(() => {
        void this.renew().catch(() => {});
      }, 5_000);
      this.broadcast(writer.id);
    }
  }
  async acquire(id: string) {
    const writer = await this.prepare(id, true);
    try {
      await this.db.transaction("rw", this.db.leases, () => this.claim(writer));
      this.activate(writer);
    } catch (error) {
      writer.lock.release();
      throw error;
    }
  }
  setReadOnly(readOnly: boolean) {
    if (this.readOnly === readOnly) return;
    this.readOnly = readOnly;
    if (readOnly) {
      clearInterval(this.#heartbeat);
      this.#current?.lock.release();
    }
    this.changed();
  }
  async assert() {
    const current = this.#current;
    if (this.#closed || this.readOnly || !current)
      throw new WorkspaceError(
        "readonly",
        "This tab is read-only. Another tab may own this lesson.",
      );
    const lease = await this.db.leases.get(keyFor(current.id));
    if (
      !lease ||
      lease.owner !== this.owner ||
      lease.generation !== current.generation ||
      (!current.lock.exclusive && lease.expiresAt <= Date.now())
    ) {
      this.setReadOnly(true);
      throw new WorkspaceError(
        "readonly",
        "Editing ownership changed. Download this tab's visible work before reopening.",
      );
    }
  }
  async check() {
    if (!this.readOnly)
      await this.db.transaction("r", this.db.leases, () => this.assert());
  }
  async renew() {
    try {
      await this.db.transaction("rw", this.db.leases, async () => {
        await this.assert();
        await this.db.leases.update(keyFor(this.#current!.id), {
          expiresAt: Date.now() + 30_000,
        });
      });
    } catch (error) {
      this.setReadOnly(true);
      throw error;
    }
  }
  async transfer(writer: PreparedWriter) {
    await this.assert();
    await this.claim(writer);
    if (!writer.generation)
      throw new WorkspaceError(
        "busy",
        "That lesson is being edited in another tab.",
      );
    if (writer.id !== this.#current!.id)
      await this.db.leases.update(keyFor(this.#current!.id), { expiresAt: 0 });
  }
  broadcast(id = this.#current?.id) {
    if (id && !this.#closed)
      this.#channel?.postMessage({ type: "changed", id });
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#heartbeat);
    this.#current?.lock.release();
    this.#channel?.close();
  }
}
