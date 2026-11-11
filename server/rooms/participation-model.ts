import { isIP } from "node:net";
import { RoomError, uuid } from "./model.ts";
import type {
  ParticipationTarget,
  StudentParticipationCommand,
  TaskInput,
  TeacherParticipationCommand,
} from "../../src/modules/classroom/participation-types.ts";

export function invalidParticipation(): never {
  throw new RoomError(
    400,
    "invalid_request",
    "Check the classroom request fields.",
  );
}
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalidParticipation();
  return input as Record<string, unknown>;
}
function fields(input: Record<string, unknown>, names: readonly string[]) {
  if (
    Object.keys(input).length !== names.length ||
    names.some((name) => !Object.hasOwn(input, name))
  )
    invalidParticipation();
}
function text(
  value: unknown,
  max: number,
  required = false,
  multiline = false,
) {
  if (
    typeof value !== "string" ||
    value.length > max * 2 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(
      value,
    )
  )
    return invalidParticipation();
  const normalized = value.trim().normalize("NFC");
  if (
    (!multiline && /[\r\n\t]/u.test(normalized)) ||
    Array.from(normalized).length > max ||
    (required && !normalized)
  )
    return invalidParticipation();
  return normalized;
}
function integer(value: unknown, min: number, max = 2147483647) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    return invalidParticipation();
  return value;
}
function boolean(value: unknown) {
  if (typeof value !== "boolean") return invalidParticipation();
  return value;
}
function uniqueIds(value: unknown, max: number) {
  if (!Array.isArray(value) || value.length > max)
    return invalidParticipation();
  const values = value.map(uuid);
  if (new Set(values).size !== values.length) return invalidParticipation();
  return values;
}
function nullableId(value: unknown) {
  return value === null ? null : uuid(value);
}
const taskFields = [
  "title",
  "instructions",
  "focusQuestion",
  "groupIds",
  "allowedTypes",
  "submissionOpen",
  "durationSeconds",
  "referenceAnswer",
  "privateNotes",
];
function task(input: Record<string, unknown>): TaskInput {
  const allowed = input.allowedTypes;
  if (
    !Array.isArray(allowed) ||
    !allowed.length ||
    allowed.length > 2 ||
    allowed.some((type) => type !== "image" && type !== "link") ||
    new Set(allowed).size !== allowed.length
  )
    return invalidParticipation();
  return {
    title: text(input.title, 120, true),
    instructions: text(input.instructions, 2000, false, true),
    focusQuestion: text(input.focusQuestion, 300),
    groupIds: uniqueIds(input.groupIds, 50),
    allowedTypes: allowed,
    submissionOpen: boolean(input.submissionOpen),
    durationSeconds: integer(input.durationSeconds, 0, 14400),
    referenceAnswer: text(input.referenceAnswer, 4000, false, true),
    privateNotes: text(input.privateNotes, 2000, false, true),
  };
}
export function target(value: unknown): ParticipationTarget {
  const input = record(value);
  fields(input, ["lessonId", "surface", "pageId"]);
  const surface = input.surface;
  if (surface !== "main" && surface !== "scratchpad")
    return invalidParticipation();
  const pageId = text(input.pageId, 128, true);
  if (!/^page:[A-Za-z0-9_:-]+$/.test(pageId)) return invalidParticipation();
  return { lessonId: uuid(input.lessonId), surface, pageId };
}

export function parseTeacherParticipation(
  value: unknown,
): TeacherParticipationCommand {
  const input = record(value),
    type = input.type;
  switch (type) {
    case "publishTask":
      fields(input, ["type", "taskId", ...taskFields]);
      return { type, taskId: uuid(input.taskId), ...task(input) };
    case "reviseTask":
      fields(input, ["type", "taskId", "expectedRevision", ...taskFields]);
      return {
        type,
        taskId: uuid(input.taskId),
        expectedRevision: integer(input.expectedRevision, 1),
        ...task(input),
      };
    case "lockSubmissions":
    case "unlockSubmissions":
    case "startTimer":
    case "pauseTimer":
    case "resumeTimer":
    case "endTimer":
    case "resetTimer":
      fields(input, ["type", "taskId", "expectedRevision"]);
      return {
        type,
        taskId: uuid(input.taskId),
        expectedRevision: integer(input.expectedRevision, 1),
      };
    case "publishProduct":
      fields(input, ["type", "productId", "published"]);
      return {
        type,
        productId: uuid(input.productId),
        published: boolean(input.published),
      };
    case "removeProduct":
      fields(input, ["type", "productId"]);
      return { type, productId: uuid(input.productId) };
    case "feedback":
      fields(input, ["type", "productId", "text"]);
      return {
        type,
        productId: uuid(input.productId),
        text: text(input.text, 1500, true, true),
      };
    case "acknowledgeHelp":
    case "resolveHelp":
      fields(input, ["type", "helpId"]);
      return { type, helpId: uuid(input.helpId) };
    case "createCapture":
    case "rotateCapture":
      fields(input, ["type", "target"]);
      return { type, target: target(input.target) };
    case "revokeCapture":
      fields(input, ["type"]);
      return { type };
    case "prepareInsertion": {
      fields(input, ["type", "productId", "captureId", "mediaId", "target"]);
      const productId = nullableId(input.productId),
        captureId = nullableId(input.captureId);
      if ((productId === null) === (captureId === null))
        return invalidParticipation();
      return {
        type,
        productId,
        captureId,
        mediaId: uuid(input.mediaId),
        target: target(input.target),
      };
    }
    case "completeInsertion":
      fields(input, ["type", "insertionId", "localRevision", "target"]);
      return {
        type,
        insertionId: uuid(input.insertionId),
        localRevision: integer(input.localRevision, 0),
        target: target(input.target),
      };
    default:
      return invalidParticipation();
  }
}

function safeLink(value: unknown) {
  const source = text(value, 2048, true);
  if (!/^https:\/\//i.test(source) || /[\x00-\x20\\]/u.test(source))
    return invalidParticipation();
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return invalidParticipation();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname.includes(".") ||
    isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
    /\.(localhost|local|internal)\.?$/i.test(url.hostname) ||
    url.href.length > 2048
  )
    return invalidParticipation();
  return url.href;
}
export function parseStudentParticipation(
  value: unknown,
): StudentParticipationCommand {
  const input = record(value),
    type = input.type;
  switch (type) {
    case "submitProduct": {
      fields(input, [
        "type",
        "taskId",
        "taskRevision",
        "kind",
        "caption",
        "link",
        "mediaIds",
      ]);
      const kind = input.kind,
        mediaIds = uniqueIds(input.mediaIds, 4);
      if (
        (kind !== "images" && kind !== "link") ||
        (kind === "images" && (!mediaIds.length || input.link !== null)) ||
        (kind === "link" && mediaIds.length)
      )
        return invalidParticipation();
      return {
        type,
        taskId: uuid(input.taskId),
        taskRevision: integer(input.taskRevision, 1),
        kind,
        caption: text(input.caption, 400),
        link: kind === "link" ? safeLink(input.link) : null,
        mediaIds,
      };
    }
    case "requestHelp":
      fields(input, ["type", "taskId", "productId", "explanation"]);
      return {
        type,
        taskId: nullableId(input.taskId),
        productId: nullableId(input.productId),
        explanation: text(input.explanation, 400, false, true),
      };
    case "cancelHelp":
      fields(input, ["type", "helpId"]);
      return { type, helpId: uuid(input.helpId) };
    default:
      return invalidParticipation();
  }
}
export function parseCaptureCode(value: unknown) {
  const input = record(value);
  fields(input, ["code"]);
  if (typeof input.code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.code))
    return invalidParticipation();
  return input.code;
}
export function parseCaptureCommand(value: unknown) {
  const input = record(value);
  fields(input, ["type", "mediaId"]);
  if (input.type !== "acceptCapture") return invalidParticipation();
  return { type: input.type, mediaId: uuid(input.mediaId) } as const;
}
