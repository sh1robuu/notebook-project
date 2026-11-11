import {
  createTLSchema,
  DocumentRecordType,
  PageRecordType,
} from "@tldraw/tlschema";
import type { TLStoreSnapshot } from "tldraw";
import Dexie from "dexie";
import { WorkspaceDatabase } from "./database.ts";
import type { StoredLesson } from "./database.ts";
import { storageError } from "./contracts.ts";
import { WriterLease } from "./writer-lease.ts";
import { digest, makeLesson, validateLesson, WorkspaceError } from "./model.ts";
import type { Lesson } from "./model.ts";
import { defaultNotebookPaper } from "./lesson-view.ts";
import { devicePreferences } from "./preferences.ts";
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
    meta: {
      paper: defaultNotebookPaper(
        devicePreferences.getSnapshot().value.paperColor,
      ),
    },
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
  const value = JSON.parse(row.payload);
  if (
    value?.id !== row.id ||
    value?.revision !== row.revision ||
    !Number.isFinite(row.updatedAt) ||
    row.updatedAt <= 0
  )
    throw new WorkspaceError(
      "integrity",
      "The saved lesson identity or revision differs from its storage record.",
    );
  const sources: Record<string, Uint8Array> = {};
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
function sameRevision(first: StoredLesson | undefined, second: StoredLesson) {
  return (
    first?.revision === second.revision &&
    first.sha256 === second.sha256 &&
    first.updatedAt === second.updatedAt
  );
}
async function checkSources(lesson: Lesson) {
  await verifySources(lesson.pdfSources);
  await verifyDocumentSources(lesson.wordSources);
  await verifyPptxSources(lesson.pptxSources);
  await verifyInteractiveSources(lesson.interactiveSources ?? {});
}
async function storeSources(db: WorkspaceDatabase, lesson: Lesson) {
  for (const source of Object.values(lesson.pdfSources)) {
    const stored = await db.pdfSources.get(source.id);
    if (!stored)
      await db.pdfSources.add({ id: source.id, bytes: source.bytes });
    else if (
      (await Dexie.waitFor(digest(new Uint8Array(stored.bytes)))) !==
      source.sha256
    )
      throw new WorkspaceError(
        "integrity",
        "Stored PDF source is damaged. Current work is unchanged.",
      );
  }
  await storeDocumentSources(db, [
    ...Object.values(lesson.wordSources),
    ...Object.values(lesson.pptxSources),
    ...Object.values(lesson.interactiveSources ?? {}),
  ]);
}
async function storeDocumentSources(
  db: WorkspaceDatabase,
  sources: readonly { id: string; bytes: Uint8Array; sha256: string }[],
) {
  for (const source of sources) {
    const stored = await db.documentSources.get(source.id);
    if (!stored)
      await db.documentSources.add({ id: source.id, bytes: source.bytes });
    else if (
      (await Dexie.waitFor(digest(new Uint8Array(stored.bytes)))) !==
      source.sha256
    )
      throw new WorkspaceError(
        "integrity",
        "A stored document source is damaged. Current work is unchanged.",
      );
  }
}

/** Owns local transactions and writer fencing; never stores live editor objects. */
export class LocalWorkspace {
  #db: WorkspaceDatabase;
  #ownership: WriterLease;
  #previousId?: string;
  #durableRow?: StoredLesson;
  #takingOwnership = false;
  #releaseLegacyLock?: () => void;
  lastDurableAt = 0;
  databaseClosed = false;
  hasExternalChanges = false;
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
    this.#ownership = new WriterLease(
      this.#db,
      () => {
        this.readOnly = this.#ownership.readOnly;
      },
      () => {
        this.hasExternalChanges = true;
        for (const listener of this.#ownershipListeners) listener();
      },
    );
    this.#db.on("close", () => {
      this.#releaseLegacyLock?.();
      if (!this.#closed) {
        this.databaseClosed = true;
        this.#ownership.close();
        this.readOnly = true;
      }
    });
  }
  static async open(
    name = "lessonboard-local-v1",
    lessonId?: string,
  ): Promise<LocalWorkspace> {
    const workspace = new LocalWorkspace(name);
    try {
      await workspace.#openDatabase();
      await workspace.#load(lessonId);
      return workspace;
    } catch (error) {
      workspace.close();
      throw storageError(error);
    }
  }
  async #openDatabase() {
    const locks = globalThis.navigator?.locks;
    if (locks) {
      // S07 holds this origin-wide lock exclusively. S08 shares it across
      // lessons so an older editor can finish saving before an upgrade.
      this.#releaseLegacyLock = await new Promise<() => void>(
        (resolve, reject) => {
          void locks
            .request(
              "lessonboard:writer:" + this.#db.name,
              { mode: "shared", ifAvailable: true },
              (lock) => {
                if (!lock) {
                  reject(
                    new WorkspaceError(
                      "blocked",
                      "An older editor is still open. Let it finish saving, close that tab, then retry.",
                    ),
                  );
                  return;
                }
                return new Promise<void>((release) => resolve(release));
              },
            )
            .catch(reject);
        },
      );
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let blocked!: () => void;
    const unavailable = new Promise<never>((_, reject) => {
      blocked = () => {
        timer ??= setTimeout(
          () =>
            reject(
              new WorkspaceError(
                "blocked",
                "Another tab is holding an older storage connection. Close that tab and retry. Existing data has been kept.",
              ),
            ),
          8_000,
        );
      };
    });
    this.#db.on("blocked", blocked);
    try {
      await Promise.race([this.#db.open(), unavailable]);
    } finally {
      clearTimeout(timer);
      this.#db.on.blocked.unsubscribe(blocked);
    }
    await this.#db.fenceLegacyWriter();
  }
  async #assertWriter(id = this.lesson?.id) {
    if (this.databaseClosed)
      throw new WorkspaceError(
        "closed",
        "The workspace connection closed for an app update. Download visible work before reopening.",
      );
    if (id !== this.#ownership.id)
      throw new WorkspaceError(
        "conflict",
        "The active lesson changed. Visible work has been kept.",
      );
    await this.#ownership.assert();
  }
  #applyDurable(lesson: Lesson, row: StoredLesson) {
    this.lesson = lesson;
    this.#durableRow = row;
    this.lastDurableAt = row.updatedAt;
  }
  async #load(lessonId?: string) {
    if (lessonId !== undefined && (!lessonId || lessonId.length > 100))
      throw new WorkspaceError("identity", "Invalid lesson identity.");
    let id = lessonId ?? (await this.#db.meta.get("active"))?.lessonId;
    if (!id) {
      const rows = await this.#db.lessons.toArray();
      rows.sort((a, b) => b.updatedAt - a.updatedAt);
      for (const row of rows) {
        try {
          await unpack(row, this.#db);
          id = row.id;
          break;
        } catch (error) {
          if (error instanceof WorkspaceError && error.code === "version")
            throw error;
        }
      }
      if (rows.length && !id)
        throw new WorkspaceError(
          "integrity",
          "Stored lessons need recovery. Existing data has been kept.",
        );
      if (id)
        this.recoveryNotice =
          "Reopened the latest verified lesson because the previous selection was unavailable.";
    }
    if (!id) {
      const lesson = blank(),
        row = await pack(lesson);
      await this.#db.transaction(
        "rw",
        this.#db.meta,
        this.#db.lessons,
        async () => {
          const active = await this.#db.meta.get("active");
          if (active) id = active.lessonId;
          else {
            row.updatedAt = Date.now();
            await this.#db.lessons.add(row);
            await this.#db.meta.put({ key: "active", lessonId: lesson.id });
            id = lesson.id;
          }
        },
      );
    }
    await this.#ownership.acquire(id!);
    this.readOnly = this.#ownership.readOnly;
    await this.#loadLatest(id!);
    const previous =
      (await this.#db.meta.get("previous:" + this.lesson.id)) ??
      (this.lesson.id === (await this.#db.meta.get("active"))?.lessonId
        ? await this.#db.meta.get("previous")
        : undefined);
    this.#previousId = previous?.lessonId;
    this.hasPrevious = !!this.#previousId;
    await this.#db.meta.put({ key: "active", lessonId: this.lesson.id });
  }
  async #loadLatest(id: string) {
    const row = await this.#db.lessons.get(id);
    if (row) {
      try {
        this.#applyDurable(await unpack(row, this.#db), row);
        return;
      } catch (error) {
        if (error instanceof WorkspaceError && error.code === "version")
          throw error;
      }
    }
    const checkpoints = await this.#db.checkpoints
      .where("lessonId")
      .equals(id)
      .sortBy("revision");
    for (const checkpoint of checkpoints.reverse()) {
      try {
        this.#applyDurable(await unpack(checkpoint, this.#db), checkpoint);
      } catch (error) {
        if (error instanceof WorkspaceError && error.code === "version")
          throw error;
        continue;
      }
      this.recoveryNotice =
        "Recovered an earlier verified saved copy. The previous records have been kept.";
      if (!this.readOnly) await this.#commitCopy(this.lesson, row ?? null);
      return;
    }
    throw new WorkspaceError(
      "integrity",
      "The saved lesson is damaged and no verified checkpoint is available. Existing data has been kept.",
    );
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
    try {
      const start = performance.now(),
        id = this.lesson.id,
        durableRow = this.#durableRow;
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
          JSON.stringify(
            Object.keys(lesson.interactiveSources ?? {}).sort(),
          ) ===
            JSON.stringify(
              Object.keys(this.lesson.interactiveSources ?? {}).sort(),
            );
      const newSources = Object.fromEntries(
        Object.entries(lesson.wordSources).filter(
          ([key, source]) =>
            this.lesson.wordSources[key]?.bytes !== source.bytes,
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
          this.#db.lessons,
          this.#db.checkpoints,
          this.#db.leases,
          this.#db.documentSources,
        ],
        async () => {
          await this.#assertWriter(id);
          const current = await this.#db.lessons.get(id);
          if (
            current?.revision !== expectedRevision ||
            !durableRow ||
            !sameRevision(current, durableRow)
          )
            throw new WorkspaceError(
              "conflict",
              "A newer lesson revision exists. Download this tab’s work before reopening.",
            );
          if (unchanged) return;
          await storeDocumentSources(this.#db, [
            ...Object.values(newSources),
            ...Object.values(newInteractives),
          ]);
          if (!authoredUnchanged)
            await this.#db.checkpoints.put({ ...current, lessonId: id });
          row.updatedAt = Date.now();
          await this.#db.lessons.put(row);
          const old = await this.#db.checkpoints
            .where("lessonId")
            .equals(id)
            .primaryKeys();
          old.sort((a, b) => Number(a[1]) - Number(b[1]));
          await this.#db.checkpoints.bulkDelete(old.slice(0, -2));
        },
      );
      if (!unchanged) {
        this.#applyDurable(lesson, row);
        this.#ownership.broadcast(id);
      }
      return {
        revision: this.lesson.revision,
        durableAt: this.lastDurableAt,
        durationMs: performance.now() - start,
      };
    } catch (error) {
      throw storageError(error);
    }
  }
  /** Caller must finish saving active work before opening an imported candidate. */
  async restore(input: unknown): Promise<Lesson> {
    try {
      return await this.#commitCopy(validateLesson(input));
    } catch (error) {
      throw storageError(error);
    }
  }
  async #commitCopy(
    candidate: Lesson,
    recoveryRow?: StoredLesson | null,
  ): Promise<Lesson> {
    const id = this.#ownership.id;
    const base = recoveryRow === undefined ? this.#durableRow : recoveryRow;
    await checkSources(candidate);
    const next = {
      ...candidate,
      id: crypto.randomUUID(),
      revision: 0,
      updatedAt: new Date().toISOString(),
    };
    const row = await pack(next),
      writer = await this.#ownership.prepare(next.id);
    try {
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
          if (id) {
            await this.#assertWriter(id);
            const current = await this.#db.lessons.get(id);
            const unchanged =
              base === null ? !current : !!base && sameRevision(current, base);
            if (!unchanged)
              throw new WorkspaceError(
                "conflict",
                "The lesson changed. Nothing was restored.",
              );
            await this.#ownership.transfer(writer);
          } else {
            await this.#ownership.claim(writer);
            if (!writer.generation)
              throw new WorkspaceError(
                "busy",
                "The new lesson could not be opened.",
              );
          }
          await storeSources(this.#db, next);
          row.updatedAt = Date.now();
          await this.#db.lessons.add(row);
          if (id && recoveryRow === undefined)
            await this.#db.meta.put({
              key: "previous:" + next.id,
              lessonId: id,
            });
          await this.#db.meta.put({ key: "active", lessonId: next.id });
        },
      );
    } catch (error) {
      writer.lock.release();
      throw error;
    }
    this.#applyDurable(next, row);
    this.#ownership.activate(writer);
    this.#previousId = recoveryRow === undefined ? id : undefined;
    this.hasPrevious = !!this.#previousId;
    return next;
  }
  async previousLesson(): Promise<Lesson> {
    const row = this.#previousId
      ? await this.#db.lessons.get(this.#previousId)
      : undefined;
    if (!row)
      throw new WorkspaceError(
        "missing",
        "No previous saved lesson is available. Current work is unchanged.",
      );
    return unpack(row, this.#db);
  }
  async activatePrevious(): Promise<Lesson> {
    const id = this.lesson.id,
      base = this.#durableRow;
    const previousId = this.#previousId;
    const prior = previousId
      ? await this.#db.lessons.get(previousId)
      : undefined;
    if (!prior)
      throw new WorkspaceError(
        "missing",
        "No previous saved lesson is available. Current work is unchanged.",
      );
    const candidate = await unpack(prior, this.#db);
    const writer = await this.#ownership.prepare(candidate.id);
    try {
      await this.#db.transaction(
        "rw",
        this.#db.meta,
        this.#db.lessons,
        this.#db.leases,
        async () => {
          await this.#assertWriter(id);
          const current = await this.#db.lessons.get(id),
            target = await this.#db.lessons.get(candidate.id);
          if (
            !base ||
            !sameRevision(current, base) ||
            !sameRevision(target, prior)
          )
            throw new WorkspaceError(
              "conflict",
              "Saved lessons changed. Nothing was reopened.",
            );
          await this.#ownership.transfer(writer);
          await this.#db.meta.put({
            key: "previous:" + candidate.id,
            lessonId: id,
          });
          await this.#db.meta.put({ key: "active", lessonId: candidate.id });
        },
      );
    } catch (error) {
      writer.lock.release();
      throw storageError(error);
    }
    this.#applyDurable(candidate, prior);
    this.#previousId = id;
    this.hasPrevious = true;
    this.#ownership.activate(writer);
    return candidate;
  }
  async takeOwnership(): Promise<Lesson> {
    if (!this.readOnly) return this.lesson;
    if (this.#takingOwnership)
      throw new WorkspaceError(
        "busy",
        "This tab is already checking editing ownership.",
      );
    this.#takingOwnership = true;
    try {
      if (this.databaseClosed)
        throw new WorkspaceError(
          "closed",
          "Reopen the current app version before taking ownership.",
        );
      const id = this.lesson.id;
      const row = await this.#db.lessons.get(id);
      if (!row)
        throw new WorkspaceError(
          "missing",
          "The saved lesson is missing. Reopen it to check recovery.",
        );
      const lesson = await unpack(row, this.#db);
      const writer = await this.#ownership.prepare(id);
      try {
        await this.#db.transaction(
          "rw",
          this.#db.lessons,
          this.#db.leases,
          async () => {
            const latest = await this.#db.lessons.get(id);
            if (!sameRevision(latest, row))
              throw new WorkspaceError(
                "conflict",
                "The saved lesson changed while checking ownership. Try again.",
              );
            await this.#ownership.claim(writer, true);
          },
        );
      } catch (error) {
        writer.lock.release();
        throw error;
      }
      this.#applyDurable(lesson, row);
      this.hasExternalChanges = false;
      this.recoveryNotice = undefined;
      this.#ownership.activate(writer);
      return lesson;
    } catch (error) {
      throw storageError(error);
    } finally {
      this.#takingOwnership = false;
    }
  }
  async refreshLesson(): Promise<Lesson> {
    try {
      if (!this.readOnly || this.#takingOwnership)
        throw new WorkspaceError(
          "busy",
          "Only a read-only tab can refresh its saved copy.",
        );
      await this.#loadLatest(this.lesson.id);
      this.hasExternalChanges = false;
      return this.lesson;
    } catch (error) {
      throw storageError(error);
    }
  }
  static async startNew(
    name = "lessonboard-local-v1",
    candidate?: unknown,
  ): Promise<LocalWorkspace> {
    const workspace = new LocalWorkspace(name);
    try {
      await workspace.#openDatabase();
      await workspace.#commitCopy(
        candidate === undefined ? blank() : validateLesson(candidate),
      );
      return workspace;
    } catch (error) {
      workspace.close();
      throw storageError(error);
    }
  }
  static async inspectLessons(
    name = "lessonboard-local-v1",
  ): Promise<LessonListEntry[]> {
    const workspace = new LocalWorkspace(name);
    try {
      await workspace.#openDatabase();
      return await inspectLessons(workspace.#db);
    } catch (error) {
      throw storageError(error);
    } finally {
      workspace.close();
    }
  }
  async listLessons(): Promise<LessonListEntry[]> {
    try {
      const rows = await inspectLessons(this.#db);
      return rows.map((row) => ({ ...row, active: row.id === this.lesson.id }));
    } catch (error) {
      throw storageError(error);
    }
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#releaseLegacyLock?.();
    this.#ownershipListeners.clear();
    this.#ownership.close();
    this.#db.close();
  }
}

export type LessonListEntry = {
  id: string;
  title: string;
  revision: number;
  updatedAt: number;
  active: boolean;
  valid: boolean;
  error?: string;
};
async function inspectLessons(
  db: WorkspaceDatabase,
): Promise<LessonListEntry[]> {
  const active = await db.meta.get("active");
  const keys = await db.lessons.toCollection().primaryKeys();
  const entries: LessonListEntry[] = [];
  for (const id of keys) {
    const row = await db.lessons.get(id);
    if (!row) continue;
    let title = "Unavailable lesson",
      valid = false,
      error: string | undefined;
    try {
      const lesson = await unpack(row, db);
      title = lesson.title;
      valid = true;
    } catch (failure) {
      error = storageError(failure).message;
    }
    entries.push({
      id,
      title,
      revision: row.revision,
      updatedAt: row.updatedAt,
      active: id === active?.lessonId,
      valid,
      error,
    });
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}
