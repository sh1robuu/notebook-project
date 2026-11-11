import Dexie from "dexie";
import type { Table } from "dexie";
import { WORKSPACE_SCHEMA_VERSION } from "../../config/version.ts";
export type StoredLesson = {
  id: string;
  revision: number;
  payload: string;
  sha256: string;
  updatedAt: number;
};
export type Checkpoint = StoredLesson & { lessonId: string };
export type BoardInsertionTarget = {
  lessonId: string;
  surface: "main" | "scratchpad";
  pageId: string;
};
export type BoardInsertionRecord = BoardInsertionTarget & {
  id: string;
  shapeId: string;
};
export type BoardInsertionReceipt = BoardInsertionRecord & { revision: number };
export type Lease = {
  key: string;
  owner: string;
  generation: number;
  expiresAt: number;
  mode?: "web-lock" | "lease";
};
const NATIVE_VERSION = WORKSPACE_SCHEMA_VERSION * 10;
const LEGACY_WRITER_FENCE: Lease = {
  key: "writer",
  owner: "workspace-schema-" + WORKSPACE_SCHEMA_VERSION,
  generation: 0,
  expiresAt: Number.MAX_SAFE_INTEGER,
};

export class WorkspaceDatabase extends Dexie {
  lessons!: Table<StoredLesson, string>;
  checkpoints!: Table<Checkpoint, [string, number]>;
  meta!: Table<{ key: string; lessonId: string; insertion?: BoardInsertionReceipt }, string>;
  leases!: Table<Lease, string>;
  pdfSources!: Table<{ id: string; bytes: Uint8Array }, string>;
  documentSources!: Table<{ id: string; bytes: Uint8Array }, string>;
  constructor(name: string) {
    const factory = globalThis.indexedDB;
    const indexedDB = factory && {
      // Dexie retries VersionError without a version and can otherwise
      // open or patch a newer schema. Every attempt must be versioned.
      open: (dbName: string) => factory.open(dbName, NATIVE_VERSION),
      deleteDatabase: factory.deleteDatabase.bind(factory),
    };
    super(name, { indexedDB });
    this.version(1).stores({
      lessons: "id",
      checkpoints: "[lessonId+revision],lessonId",
      meta: "key",
      leases: "key",
    });
    this.version(2).stores({ pdfSources: "id" });
    this.version(3).stores({ documentSources: "id" });
    // Preserve all durable lesson and source records. Fence older clients
    // that fall back to their global IndexedDB lease during the upgrade.
    this.version(WORKSPACE_SCHEMA_VERSION)
      .stores({})
      .upgrade((transaction) =>
        transaction.table<Lease>("leases").put(LEGACY_WRITER_FENCE),
      );
    this.on("versionchange", () => this.close());
  }

  async fenceLegacyWriter() {
    // Dexie skips upgrade callbacks for a database created from scratch.
    await this.transaction("rw", this.leases, async () => {
      const existing = await this.leases.get(LEGACY_WRITER_FENCE.key);
      if (existing?.owner !== LEGACY_WRITER_FENCE.owner)
        await this.leases.put(LEGACY_WRITER_FENCE);
    });
  }
}
