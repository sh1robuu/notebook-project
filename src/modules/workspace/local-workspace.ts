import {
  createTLSchema,
  DocumentRecordType,
  PageRecordType,
} from "@tldraw/tlschema";
import type { TLStoreSnapshot } from "tldraw";
import Dexie from "dexie";
import { WorkspaceDatabase } from "./database.ts";
import type { StoredLesson } from "./database.ts";
import { digest, makeLesson, validateLesson, WorkspaceError } from "./model.ts";
import type { Lesson } from "./model.ts";
import {
  serializedLesson,
  hydrateSources,
  verifySources,
} from "../pdf/sources.ts";
import { verifyDocumentSources } from "../documents/sources.ts";
import { hydratePptxSources, verifyPptxSources } from "../pptx/sources.ts";
import {
  hydrateInteractiveSources,
  verifyInteractiveSources,
} from "../interactive/sources.ts";
export type CommitReceipt = {
  revision: number;
  durableAt: number;
  durationMs: number;
};
const encoder = new TextEncoder();
function blank() {
  const document = DocumentRecordType.create({
    id: DocumentRecordType.createId("document"),
  });
  const page = PageRecordType.create({
    id: PageRecordType.createId("page"),
    name: "Page 1",
    index: "a1" as never,
  });
  return makeLesson({
    schema: createTLSchema().serialize(),
    store: { [document.id]: document, [page.id]: page },
  });
}
async function pack(lesson: Lesson): Promise<StoredLesson> {
  const payload = JSON.stringify(serializedLesson(lesson));
  return {
    id: lesson.id,
    revision: lesson.revision,
    payload,
    sha256: await digest(encoder.encode(payload)),
    updatedAt: Date.now(),
  };
}
async function unpack(
  row: StoredLesson,
  db: WorkspaceDatabase,
): Promise<Lesson> {
  if ((await digest(encoder.encode(row.payload))) !== row.sha256)
    throw new WorkspaceError(
      "integrity",
      "The saved lesson checksum does not match.",
    );
  const value = JSON.parse(row.payload),
    sources: Record<string, Uint8Array> = {};
  for (const id of Object.keys(value.pdfSources ?? {})) {
    const row = await db.pdfSources.get(id);
    if (row) sources[id] = new Uint8Array(row.bytes);
  }
  if (value.version === 5 || value.version === 6) {
    for (const [id, metadata] of Object.entries(value.wordSources ?? {})) {
      const source = await db.documentSources.get(id);
      value.wordSources[id] = {
        ...(metadata as Record<string, unknown>),
        bytes: source ? new Uint8Array(source.bytes) : undefined,
      };
    }
  }
  if (value.version === 6) {
    const ids = Object.keys(value.pptxSources ?? {});
    const stored = await db.documentSources.bulkGet(ids);
    value.pptxSources = hydratePptxSources(
      value.pptxSources,
      Object.fromEntries(
        stored.flatMap((row) =>
          row ? [[row.id, new Uint8Array(row.bytes)]] : [],
        ),
      ),
    );
    const interactive = await db.documentSources.bulkGet(
      Object.keys(value.interactiveSources ?? {}),
    );
    value.interactiveSources = hydrateInteractiveSources(
      value.interactiveSources,
      Object.fromEntries(
        interactive.flatMap((row) =>
          row ? [[row.id, new Uint8Array(row.bytes)]] : [],
        ),
      ),
    );
  }
  const lesson = validateLesson(hydrateSources(value, sources));
  await verifySources(lesson.pdfSources);
  await verifyDocumentSources(lesson.wordSources);
  await verifyPptxSources(lesson.pptxSources);
  await verifyInteractiveSources(lesson.interactiveSources ?? {});
  return lesson;
}

/** Owns local transactions and writer fencing; never stores live editor objects. */
export class LocalWorkspace {
  #db: WorkspaceDatabase;
  #owner = crypto.randomUUID();
  #generation = 0;
  #hasWebLock = false;
  #releaseLock: (() => void) | undefined;
  #heartbeat: ReturnType<typeof setInterval> | undefined;
  #closed = false;
  #readOnly = true;
  #ownershipListeners = new Set<() => void>();
  get readOnly() {
    return this.#readOnly;
  }
  set readOnly(value: boolean) {
    if (this.#readOnly === value) return;
    this.#readOnly = value;
    for (const listener of this.#ownershipListeners) listener();
  }
  subscribeOwnership(listener: () => void) {
    this.#ownershipListeners.add(listener);
    return () => {
      this.#ownershipListeners.delete(listener);
    };
  }
  recoveryNotice: string | undefined;
  hasPrevious = false;
  lesson!: Lesson;
  private constructor(name: string) {
    this.#db = new WorkspaceDatabase(name);
  }
  static async open(name = "lessonboard-local-v1"): Promise<LocalWorkspace> {
    const workspace = new LocalWorkspace(name);
    try {
      await workspace.#db.open();
      await workspace.#acquire();
      await workspace.#load();
      return workspace;
    } catch (error) {
      workspace.close();
      throw error;
    }
  }
  async #acquire() {
    if (globalThis.navigator?.locks) {
      await new Promise<void>((resolve, reject) => {
        navigator.locks
          .request(
            "lessonboard:writer:" + this.#db.name,
            { ifAvailable: true },
            async (lock) => {
              if (!lock) {
                resolve();
                return;
              }
              try {
                this.#hasWebLock = true;
                await this.#claim(true);
                resolve();
                await new Promise<void>((release) => {
                  this.#releaseLock = release;
                });
              } catch (error) {
                reject(error);
              }
            },
          )
          .catch(reject);
      });
    } else {
      await this.#claim(false);
    }
    if (!this.readOnly)
      this.#heartbeat = setInterval(() => {
        this.#renew().catch(() => {
          if (!this.#closed) this.readOnly = true;
        });
      }, 5000);
  }
  async #claim(exclusiveLock: boolean) {
    await this.#db.transaction("rw", this.#db.leases, async () => {
      const old = await this.#db.leases.get("writer");
      if (!exclusiveLock && old && old.expiresAt > Date.now()) return;
      this.#generation = (old?.generation ?? 0) + 1;
      await this.#db.leases.put({
        key: "writer",
        owner: this.#owner,
        generation: this.#generation,
        expiresAt: Date.now() + 30000,
      });
      this.readOnly = false;
    });
  }
  async #renew() {
    await this.#db.transaction("rw", this.#db.leases, async () => {
      await this.#assertWriter();
      await this.#db.leases.update("writer", { expiresAt: Date.now() + 30000 });
    });
  }
  async #assertWriter() {
    if (this.#closed || this.readOnly)
      throw new WorkspaceError(
        "readonly",
        "This tab is read-only. Another tab may own the lesson.",
      );
    const lease = await this.#db.leases.get("writer");
    if (
      !lease ||
      lease.owner !== this.#owner ||
      lease.generation !== this.#generation ||
      (!this.#hasWebLock && lease.expiresAt <= Date.now())
    ) {
      this.readOnly = true;
      throw new WorkspaceError(
        "readonly",
        "Editing ownership changed. Download this tab’s work before reopening.",
      );
    }
  }
  async #load() {
    this.hasPrevious = !!(await this.#db.meta.get("previous"));
    const active = await this.#db.meta.get("active");
    if (!active) {
      if (this.readOnly)
        throw new WorkspaceError(
          "busy",
          "Another tab is creating the workspace. Retry after it finishes.",
        );
      const lesson = blank(),
        row = await pack(lesson);
      await this.#db.transaction(
        "rw",
        [this.#db.meta, this.#db.lessons, this.#db.leases],
        async () => {
          await this.#assertWriter();
          await this.#db.lessons.add(row);
          await this.#db.meta.put({ key: "active", lessonId: lesson.id });
        },
      );
      this.lesson = lesson;
      return;
    }
    const row = await this.#db.lessons.get(active.lessonId);
    if (!row)
      throw new WorkspaceError(
        "integrity",
        "The active lesson is missing. Existing data has been kept.",
      );
    try {
      this.lesson = await unpack(row, this.#db);
      return;
    } catch (error) {
      if (error instanceof WorkspaceError && error.code === "version")
        throw error;
    }
    const checkpoints = await this.#db.checkpoints
      .where("lessonId")
      .equals(active.lessonId)
      .reverse()
      .sortBy("revision");
    let recovered: Lesson | undefined;
    for (const candidate of checkpoints.sort(
      (a, b) => b.revision - a.revision,
    )) {
      try {
        recovered = await unpack(candidate, this.#db);
        break;
      } catch {
        /* try an older independently verified checkpoint */
      }
    }
    if (!recovered)
      throw new WorkspaceError(
        "integrity",
        "The saved lesson is damaged and no verified checkpoint is available. Existing data has been kept.",
      );
    this.lesson = recovered;
    this.recoveryNotice =
      "Recovered an earlier verified saved copy. The damaged copy has been kept.";
    if (!this.readOnly) {
      const next = {
          ...recovered,
          id: crypto.randomUUID(),
          revision: 0,
          updatedAt: new Date().toISOString(),
        },
        packed = await pack(next);
      await this.#db.transaction(
        "rw",
        [this.#db.meta, this.#db.lessons, this.#db.leases],
        async () => {
          await this.#assertWriter();
          await this.#db.lessons.add(packed);
          await this.#db.meta.put({ key: "active", lessonId: next.id });
        },
      );
      this.lesson = next;
    }
  }
  async save(
    value: { document: TLStoreSnapshot; title: string } & Partial<
      Pick<
        Lesson,
        | "scratchpad"
        | "view"
        | "pageId"
        | "wordDraft"
        | "wordSources"
        | "interactiveSources"
      >
    >,
    expectedRevision: number,
  ): Promise<CommitReceipt> {
    const start = performance.now(),
      id = this.lesson.id;
    const lesson = validateLesson({
        ...this.lesson,
        ...value,
        version: Object.keys(value.interactiveSources ?? {}).length
          ? 6
          : this.lesson.version,
        revision: expectedRevision + 1,
        updatedAt: new Date().toISOString(),
      }),
      authoredUnchanged =
        lesson.title === this.lesson.title &&
        JSON.stringify(lesson.document) ===
          JSON.stringify(this.lesson.document) &&
        JSON.stringify(lesson.scratchpad) ===
          JSON.stringify(this.lesson.scratchpad) &&
        JSON.stringify(lesson.wordDraft) ===
          JSON.stringify(this.lesson.wordDraft) &&
        JSON.stringify(Object.keys(lesson.wordSources).sort()) ===
          JSON.stringify(Object.keys(this.lesson.wordSources).sort()) &&
        JSON.stringify(Object.keys(lesson.interactiveSources ?? {}).sort()) ===
          JSON.stringify(
            Object.keys(this.lesson.interactiveSources ?? {}).sort(),
          );
    const newSources = Object.fromEntries(
      Object.entries(lesson.wordSources).filter(
        ([key, source]) => this.lesson.wordSources[key]?.bytes !== source.bytes,
      ),
    );
    await verifyDocumentSources(newSources);
    const newInteractives = Object.fromEntries(
      Object.entries(lesson.interactiveSources ?? {}).filter(
        ([key, source]) =>
          this.lesson.interactiveSources?.[key]?.bytes !== source.bytes,
      ),
    );
    await verifyInteractiveSources(newInteractives);
    if (authoredUnchanged) lesson.revision = expectedRevision;
    const row = await pack(lesson);
    // Compare canonical validated values, rather than relying on mutable caller
    // references. Duplicate SDK notifications must not consume checkpoints.
    const unchanged =
      authoredUnchanged &&
      lesson.pageId === this.lesson.pageId &&
      JSON.stringify(lesson.view) === JSON.stringify(this.lesson.view);
    await this.#db.transaction(
      "rw",
      [
        this.#db.meta,
        this.#db.lessons,
        this.#db.checkpoints,
        this.#db.leases,
        this.#db.documentSources,
      ],
      async () => {
        await this.#assertWriter();
        const active = await this.#db.meta.get("active"),
          current = await this.#db.lessons.get(id);
        if (active?.lessonId !== id || current?.revision !== expectedRevision)
          throw new WorkspaceError(
            "conflict",
            "A newer lesson revision exists. Download this tab’s work before reopening.",
          );
        if (unchanged) return;
        for (const source of [
          ...Object.values(newSources),
          ...Object.values(newInteractives),
        ]) {
          const previous = await this.#db.documentSources.get(source.id);
          if (!previous)
            await this.#db.documentSources.add({
              id: source.id,
              bytes: source.bytes,
            });
          else if (
            (await Dexie.waitFor(digest(new Uint8Array(previous.bytes)))) !==
            source.sha256
          )
            throw new WorkspaceError(
              "integrity",
              "A stored document source is damaged. Current work is unchanged.",
            );
        }
        if (!authoredUnchanged)
          await this.#db.checkpoints.put({ ...current, lessonId: id });
        await this.#db.lessons.put(row);
        const old = await this.#db.checkpoints
          .where("lessonId")
          .equals(id)
          .primaryKeys();
        old.sort((a, b) => Number(a[1]) - Number(b[1]));
        await this.#db.checkpoints.bulkDelete(old.slice(0, -2));
      },
    );
    if (!unchanged) this.lesson = lesson;
    return {
      revision: this.lesson.revision,
      durableAt: Date.now(),
      durationMs: performance.now() - start,
    };
  }
  /** Caller must finish saving active work before opening an imported candidate. */
  async restore(input: unknown): Promise<Lesson> {
    const candidate = validateLesson(input),
      id = this.lesson.id,
      expected = this.lesson.revision;
    await verifySources(candidate.pdfSources);
    await verifyDocumentSources(candidate.wordSources);
    await verifyPptxSources(candidate.pptxSources);
    await verifyInteractiveSources(candidate.interactiveSources ?? {});
    const next = {
        ...candidate,
        id: crypto.randomUUID(),
        revision: 0,
        updatedAt: new Date().toISOString(),
      },
      row = await pack(next);
    await this.#db.transaction(
      "rw",
      [
        this.#db.meta,
        this.#db.lessons,
        this.#db.leases,
        this.#db.pdfSources,
        this.#db.documentSources,
      ],
      async () => {
        await this.#assertWriter();
        const current = await this.#db.lessons.get(id),
          active = await this.#db.meta.get("active");
        if (active?.lessonId !== id || current?.revision !== expected)
          throw new WorkspaceError(
            "conflict",
            "The active lesson changed. Nothing was restored.",
          );
        for (const source of Object.values(next.pdfSources)) {
          const stored = await this.#db.pdfSources.get(source.id);
          if (!stored)
            await this.#db.pdfSources.add({
              id: source.id,
              bytes: source.bytes,
            });
          else if (
            (await Dexie.waitFor(digest(new Uint8Array(stored.bytes)))) !==
            source.sha256
          )
            throw new WorkspaceError(
              "integrity",
              "Stored PDF source is damaged. Current work is unchanged.",
            );
        }
        for (const source of [
          ...Object.values(next.wordSources),
          ...Object.values(next.pptxSources),
          ...Object.values(next.interactiveSources ?? {}),
        ]) {
          const stored = await this.#db.documentSources.get(source.id);
          if (!stored)
            await this.#db.documentSources.add({
              id: source.id,
              bytes: source.bytes,
            });
          else if (
            (await Dexie.waitFor(digest(new Uint8Array(stored.bytes)))) !==
            source.sha256
          )
            throw new WorkspaceError(
              "integrity",
              "A stored document source is damaged. Current work is unchanged.",
            );
        }
        await this.#db.lessons.add(row);
        await this.#db.meta.put({ key: "previous", lessonId: id });
        await this.#db.meta.put({ key: "active", lessonId: next.id });
      },
    );
    this.lesson = next;
    this.hasPrevious = true;
    return next;
  }
  async previousLesson(): Promise<Lesson> {
    const previous = await this.#db.meta.get("previous"),
      row = previous
        ? await this.#db.lessons.get(previous.lessonId)
        : undefined;
    if (!row)
      throw new WorkspaceError(
        "missing",
        "No previous saved lesson is available. Current work is unchanged.",
      );
    return unpack(row, this.#db);
  }
  async activatePrevious(): Promise<Lesson> {
    const candidate = await this.previousLesson(),
      id = this.lesson.id,
      expected = this.lesson.revision;
    await this.#db.transaction(
      "rw",
      [this.#db.meta, this.#db.lessons, this.#db.leases],
      async () => {
        await this.#assertWriter();
        const active = await this.#db.meta.get("active"),
          previous = await this.#db.meta.get("previous"),
          current = await this.#db.lessons.get(id),
          target = await this.#db.lessons.get(candidate.id);
        if (
          active?.lessonId !== id ||
          current?.revision !== expected ||
          previous?.lessonId !== candidate.id ||
          target?.revision !== candidate.revision
        )
          throw new WorkspaceError(
            "conflict",
            "The saved lessons changed. Nothing was reopened.",
          );
        await this.#db.meta.put({ key: "previous", lessonId: id });
        await this.#db.meta.put({ key: "active", lessonId: candidate.id });
      },
    );
    this.lesson = candidate;
    return candidate;
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#ownershipListeners.clear();
    clearInterval(this.#heartbeat);
    this.#releaseLock?.();
    this.#db.close();
  }
}
