import { createHash, createHmac } from "node:crypto";

export class RoomError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type RoomMode = "individual" | "group";
export type RoomState = "draft" | "open" | "locked" | "ended" | "archived";
export type Transition =
  "open" | "lock" | "unlock" | "end" | "reopen" | "archive";

export type RoomCommand =
  | { type: Transition | "rotateInvitation" | "revokeInvitation" }
  | { type: "configure"; title: string; mode: RoomMode }
  | { type: "renameParticipant"; participantId: string; displayName: string }
  | { type: "removeParticipant"; participantId: string }
  | { type: "reorderParticipants"; participantIds: string[] }
  | { type: "assignGroup"; participantId: string; groupId: string | null }
  | { type: "createGroup"; name: string }
  | { type: "renameGroup"; groupId: string; name: string }
  | { type: "deleteGroup"; groupId: string };

const transitions: Record<Transition, Partial<Record<RoomState, RoomState>>> = {
  open: { draft: "open" },
  lock: { open: "locked" },
  unlock: { locked: "open" },
  end: { draft: "ended", open: "ended", locked: "ended" },
  reopen: { ended: "open" },
  archive: { ended: "archived" },
};

export const limits = {
  participants: 100,
  groups: 50,
  replay: 200,
} as const;

export function transition(state: RoomState, action: Transition): RoomState {
  const next = transitions[action][state];
  if (!next)
    throw new RoomError(
      409,
      "invalid_transition",
      "Room state does not allow this action.",
    );
  return next;
}

export function isTransition(action: string): action is Transition {
  return Object.hasOwn(transitions, action);
}

function invalid(): never {
  throw new RoomError(
    400,
    "invalid_request",
    "Check the classroom request fields.",
  );
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}

function fields(input: Record<string, unknown>, ...expected: string[]) {
  if (
    Object.keys(input).length !== expected.length ||
    expected.some((name) => !Object.hasOwn(input, name))
  )
    invalid();
}

export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    return invalid();
  return value.toLowerCase();
}

function name(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
  )
    return invalid();
  const normalized = value.normalize("NFC").trim();
  if (!normalized || Array.from(normalized).length > maximum) return invalid();
  return normalized;
}

function roomMode(value: unknown): RoomMode {
  if (value !== "individual" && value !== "group") return invalid();
  return value;
}

export function parseRoom(value: unknown) {
  const input = record(value);
  fields(input, "title", "mode");
  return { title: name(input.title, 120), mode: roomMode(input.mode) };
}

export function parseJoin(value: unknown) {
  const input = record(value);
  fields(input, "code", "displayName");
  if (typeof input.code !== "string" || input.code.length > 64)
    return invalid();
  const code = input.code.trim();
  if (!/^[A-Za-z0-9_-]{24}$/.test(code))
    throw new RoomError(
      404,
      "invalid_invitation",
      "This invitation is unavailable.",
    );
  return { code, displayName: name(input.displayName, 80) };
}

export function parseCommand(value: unknown): RoomCommand {
  const input = record(value);
  const { type } = input;
  if (typeof type !== "string") return invalid();
  if (
    isTransition(type) ||
    type === "rotateInvitation" ||
    type === "revokeInvitation"
  ) {
    fields(input, "type");
    return { type };
  }
  switch (type) {
    case "configure":
      fields(input, "type", "title", "mode");
      return {
        type,
        title: name(input.title, 120),
        mode: roomMode(input.mode),
      };
    case "renameParticipant":
      fields(input, "type", "participantId", "displayName");
      return {
        type,
        participantId: uuid(input.participantId),
        displayName: name(input.displayName, 80),
      };
    case "removeParticipant":
      fields(input, "type", "participantId");
      return { type, participantId: uuid(input.participantId) };
    case "reorderParticipants":
      fields(input, "type", "participantIds");
      if (
        !Array.isArray(input.participantIds) ||
        input.participantIds.length > limits.participants
      )
        return invalid();
      return { type, participantIds: input.participantIds.map(uuid) };
    case "assignGroup":
      fields(input, "type", "participantId", "groupId");
      return {
        type,
        participantId: uuid(input.participantId),
        groupId: input.groupId === null ? null : uuid(input.groupId),
      };
    case "createGroup":
      fields(input, "type", "name");
      return { type, name: name(input.name, 64) };
    case "renameGroup":
      fields(input, "type", "groupId", "name");
      return { type, groupId: uuid(input.groupId), name: name(input.name, 64) };
    case "deleteGroup":
      fields(input, "type", "groupId");
      return { type, groupId: uuid(input.groupId) };
    default:
      return invalid();
  }
}

export function replayCursor(header: unknown, query: unknown): number | null {
  const value = header ?? query;
  if (value === undefined) return null;
  if (
    typeof value !== "string" ||
    !/^\d{1,10}$/.test(value) ||
    Number(value) > 2147483647
  )
    throw new RoomError(
      400,
      "invalid_cursor",
      "The classroom event cursor is invalid.",
    );
  return Number(value);
}

export function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function invitationCode(secret: string, invitationId: string): string {
  return createHmac("sha256", secret)
    .update("lessonboard:classroom-invite:v1:")
    .update(invitationId)
    .digest()
    .subarray(0, 18)
    .toString("base64url");
}
