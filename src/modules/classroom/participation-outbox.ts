import Dexie, { type Table } from "dexie";
import type { DraftImage } from "./participation-api.ts";
import type { StudentParticipationCommand } from "./participation-types.ts";
import { ClassroomError } from "./api.ts";

export type SubmissionDraft = {
  taskId: string;
  caption: string;
  link: string;
  images: DraftImage[];
  attempt?: Extract<StudentParticipationCommand, { type: "submitProduct" }>;
  attemptKey?: string;
};
type Draft = { scope: string; updatedAt: number; value: SubmissionDraft };
type CommandKey = { id: string; key: string; updatedAt: number };
export type CaptureDraft = { image: DraftImage; key: string; mediaId?: string };
type StoredCapture = { scope: string; updatedAt: number; value: CaptureDraft };
const draftLifetime = 24 * 60 * 60_000;

class ParticipationDatabase extends Dexie {
  drafts!: Table<Draft, string>;
  commands!: Table<CommandKey, string>;
  captures!: Table<StoredCapture, string>;
  constructor() {
    super("lessonboard-classroom-drafts-v1");
    this.version(1).stores({
      drafts: "scope,updatedAt",
      commands: "id,updatedAt",
    });
    this.version(2).stores({ captures: "scope,updatedAt" });
  }
}
let database: ParticipationDatabase | undefined;
function db() {
  return (database ??= new ParticipationDatabase());
}

export async function loadSubmissionDraft(scope: string) {
  const drafts = db().drafts;
  await drafts
    .where("updatedAt")
    .below(Date.now() - draftLifetime)
    .delete();
  return (await drafts.get(scope))?.value;
}

export function saveSubmissionDraft(scope: string, value: SubmissionDraft) {
  return db().drafts.put({ scope, value, updatedAt: Date.now() });
}

export function clearSubmissionDraft(scope: string) {
  return db().drafts.delete(scope);
}

export async function loadCaptureDraft(scope: string) {
  const captures = db().captures;
  await captures
    .where("updatedAt")
    .below(Date.now() - 60 * 60_000)
    .delete();
  return (await captures.get(scope))?.value;
}

export function saveCaptureDraft(scope: string, value: CaptureDraft) {
  return db().captures.put({ scope, value, updatedAt: Date.now() });
}

export function clearCaptureDraft(scope: string) {
  return db().captures.delete(scope);
}

export async function sendParticipationCommand<T>(
  scope: string,
  command: object,
  submit: (key: string) => Promise<T>,
): Promise<T> {
  const bytes = new TextEncoder().encode(JSON.stringify(command));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const id =
    scope +
    ":" +
    Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const key = await db().transaction("rw", db().commands, async () => {
    const existing = await db().commands.get(id);
    if (existing) return existing.key;
    const key = crypto.randomUUID();
    await db().commands.put({ id, key, updatedAt: Date.now() });
    return key;
  });
  try {
    const result = await submit(key);
    // The server has committed. Failure to clear a local retry key cannot undo it.
    await db()
      .commands.delete(id)
      .catch(() => {});
    return result;
  } catch (error) {
    if (error instanceof ClassroomError && !error.retryable)
      await db()
        .commands.delete(id)
        .catch(() => {});
    throw error;
  }
}
