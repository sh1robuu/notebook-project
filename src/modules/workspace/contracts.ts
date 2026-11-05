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
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
