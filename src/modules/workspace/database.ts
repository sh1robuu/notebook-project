import Dexie from "dexie";
import type { Table } from "dexie";
export type StoredLesson = {
  id: string;
  revision: number;
  payload: string;
  sha256: string;
  updatedAt: number;
};
export type Checkpoint = StoredLesson & { lessonId: string };
export type Lease = {
  key: string;
  owner: string;
  generation: number;
  expiresAt: number;
};
export class WorkspaceDatabase extends Dexie {
  lessons!: Table<StoredLesson, string>;
  checkpoints!: Table<Checkpoint, [string, number]>;
  meta!: Table<{ key: string; lessonId: string }, string>;
  leases!: Table<Lease, string>;
  pdfSources!: Table<{ id: string; bytes: Uint8Array }, string>;
  documentSources!: Table<{ id: string; bytes: Uint8Array }, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      lessons: "id",
      checkpoints: "[lessonId+revision],lessonId",
      meta: "key",
      leases: "key",
    });
    this.version(2).stores({ pdfSources: "id" });
    this.version(3).stores({ documentSources: "id" });
    this.on("versionchange", () => this.close());
  }
}
