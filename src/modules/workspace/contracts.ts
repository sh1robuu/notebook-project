export const SDK_VERSION = "5.6.0";
export const MAX_ARCHIVE_BYTES = 250_000_000;
export const MAX_SHAPES = 20_000;
export const MAX_PAGES = 200;
export const MAX_WORLD_COORDINATE = 1_000_000;
export class WorkspaceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}
export function storageError(error: unknown): WorkspaceError {
  if (error instanceof WorkspaceError) return error;
  const value = error as { name?: string; inner?: { name?: string } };
  const name = value?.inner?.name ?? value?.name;
  if (name === "QuotaExceededError")
    return new WorkspaceError(
      "quota",
      "Browser storage is full. Keep this tab open and download your work before freeing space.",
    );
  if (name === "SecurityError" || name === "InvalidStateError")
    return new WorkspaceError(
      "denied",
      "Browser storage is unavailable. Check site storage permissions and keep a lesson backup.",
    );
  if (name === "VersionError")
    return new WorkspaceError(
      "version",
      "This workspace was opened by a newer app version. Update the app to reopen it. Existing data has been kept.",
    );
  if (name === "DatabaseClosedError")
    return new WorkspaceError(
      "closed",
      "The workspace connection closed for an app update. Download visible work before reopening.",
    );
  if (name === "AbortError")
    return new WorkspaceError(
      "aborted",
      "The storage transaction was interrupted. The previous saved copy has been kept.",
    );
  return new WorkspaceError(
    "storage",
    error instanceof Error
      ? error.message
      : "Browser storage could not finish. Keep visible work and download a backup.",
  );
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
