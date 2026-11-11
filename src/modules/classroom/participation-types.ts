export type ParticipationTarget = {
  lessonId: string;
  surface: "main" | "scratchpad";
  pageId: string;
};

export function sameInsertionTarget(
  a: ParticipationTarget,
  b: ParticipationTarget,
) {
  return (
    a.lessonId === b.lessonId &&
    a.surface === b.surface &&
    a.pageId === b.pageId
  );
}
export type ClassroomMedia = {
  id: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  url: string;
  thumbnailUrl: string;
};
export type TaskTimer = {
  state: "idle" | "running" | "paused" | "ended";
  durationSeconds: number;
  remainingMs: number;
  endsAt: string | null;
};
export type ClassroomTask = {
  id: string;
  revision: number;
  title: string;
  instructions: string;
  focusQuestion: string;
  groupIds: string[];
  allowedTypes: ("image" | "link")[];
  submissionOpen: boolean;
  timer: TaskTimer;
  publishedAt: string;
  updatedAt: string;
};
export type TeacherTask = ClassroomTask & {
  referenceAnswer: string;
  privateNotes: string;
};
export type ProductFeedback = {
  id: string;
  productId: string;
  text: string;
  createdAt: string;
};
export type ClassroomProduct = {
  id: string;
  participantId: string;
  groupId: string | null;
  displayName: string;
  groupName: string | null;
  taskId: string;
  taskRevision: number;
  kind: "images" | "link";
  caption: string;
  link: string | null;
  media: ClassroomMedia[];
  acceptedAt: string;
  published: boolean;
  removedAt: string | null;
  feedback: ProductFeedback[];
};
export type ClassroomHelp = {
  id: string;
  participantId: string;
  displayName: string;
  groupId: string | null;
  taskId: string | null;
  productId: string | null;
  explanation: string;
  state: "pending" | "acknowledged" | "resolved" | "cancelled";
  createdAt: string;
  updatedAt: string;
};
export type CaptureGrant = {
  id: string;
  code: string;
  expiresAt: string;
  revokedAt: string | null;
  target: ParticipationTarget;
};
export type ClassroomCapture = {
  id: string;
  grantId: string;
  media: ClassroomMedia;
  target: ParticipationTarget;
  acceptedAt: string;
  insertionId: string | null;
};
export type ClassroomInsertion = {
  id: string;
  productId: string | null;
  captureId: string | null;
  mediaId: string;
  target: ParticipationTarget;
  state: "requested" | "saved";
  createdAt: string;
  savedAt: string | null;
  localRevision: number | null;
};
export type ParticipationView = {
  roomId: string;
  revision: number;
  serverTime: string;
  tasks: ClassroomTask[];
  products: ClassroomProduct[];
  gallery: ClassroomProduct[];
  help: ClassroomHelp[];
};
export type TeacherParticipation = Omit<ParticipationView, "tasks"> & {
  tasks: TeacherTask[];
  captures: ClassroomCapture[];
  captureGrant: CaptureGrant | null;
  insertions: ClassroomInsertion[];
};
export type CaptureSessionView = {
  grantId: string;
  expiresAt: string;
  target: ParticipationTarget;
};
export type TaskInput = {
  title: string;
  instructions: string;
  focusQuestion: string;
  groupIds: string[];
  allowedTypes: ("image" | "link")[];
  submissionOpen: boolean;
  durationSeconds: number;
  referenceAnswer: string;
  privateNotes: string;
};
export type TeacherParticipationCommand =
  | ({ type: "publishTask"; taskId: string } & TaskInput)
  | ({
      type: "reviseTask";
      taskId: string;
      expectedRevision: number;
    } & TaskInput)
  | {
      type: "lockSubmissions" | "unlockSubmissions";
      taskId: string;
      expectedRevision: number;
    }
  | {
      type:
        "startTimer" | "pauseTimer" | "resumeTimer" | "endTimer" | "resetTimer";
      taskId: string;
      expectedRevision: number;
    }
  | { type: "publishProduct"; productId: string; published: boolean }
  | { type: "removeProduct"; productId: string }
  | { type: "feedback"; productId: string; text: string }
  | { type: "acknowledgeHelp" | "resolveHelp"; helpId: string }
  | { type: "createCapture" | "rotateCapture"; target: ParticipationTarget }
  | { type: "revokeCapture" }
  | {
      type: "prepareInsertion";
      productId: string | null;
      captureId: string | null;
      mediaId: string;
      target: ParticipationTarget;
    }
  | {
      type: "completeInsertion";
      insertionId: string;
      localRevision: number;
      target: ParticipationTarget;
    };
export type StudentParticipationCommand =
  | {
      type: "submitProduct";
      taskId: string;
      taskRevision: number;
      kind: "images" | "link";
      caption: string;
      link: string | null;
      mediaIds: string[];
    }
  | {
      type: "requestHelp";
      taskId: string | null;
      productId: string | null;
      explanation: string;
    }
  | { type: "cancelHelp"; helpId: string };
export type ParticipationReceipt<View = ParticipationView> = {
  participation: View;
  receipt: {
    id: string;
    revision: number;
    acceptedAt: string;
    resourceId: string;
  };
};
