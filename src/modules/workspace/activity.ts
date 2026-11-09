import type { LessonSession } from "../board/lesson-session.ts";

type ActivitySnapshot = {
  count: number;
  labels: readonly string[];
  navigationLocked: boolean;
};
const operations = new Map<symbol, string>();
const listeners = new Set<() => void>();
let snapshot: ActivitySnapshot = {
  count: 0,
  labels: [],
  navigationLocked: false,
};
let composing = false;

function publish(navigationLocked = snapshot.navigationLocked) {
  snapshot = {
    count: operations.size,
    labels: [...operations.values()],
    navigationLocked,
  };
  for (const listener of listeners) listener();
}

export const activityState = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => snapshot,
};

export function beginOperation(label: string) {
  if (snapshot.navigationLocked)
    throw new Error(
      "Đang mở lại không gian làm việc. Hãy chờ thao tác hoàn tất.",
    );
  const token = Symbol(label);
  operations.set(token, label);
  publish();
  return () => {
    if (operations.delete(token)) publish();
  };
}

export function installActivityGuards() {
  const start = () => {
    composing = true;
  };
  const end = () => {
    composing = false;
  };
  const blockInput = (event: Event) => {
    if (!snapshot.navigationLocked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const inputs = [
    "pointerdown",
    "click",
    "keydown",
    "beforeinput",
    "change",
    "drop",
    "paste",
    "submit",
  ];
  for (const input of inputs) window.addEventListener(input, blockInput, true);
  window.addEventListener("compositionstart", start, true);
  window.addEventListener("compositionend", end, true);
  window.addEventListener("blur", end);
  return () => {
    for (const input of inputs)
      window.removeEventListener(input, blockInput, true);
    window.removeEventListener("compositionstart", start, true);
    window.removeEventListener("compositionend", end, true);
    window.removeEventListener("blur", end);
    composing = false;
  };
}

function assertSafe(session: LessonSession, ignoreDialog?: HTMLElement) {
  if (operations.size)
    throw new Error(
      "Hãy chờ thao tác hoàn tất. " + [...operations.values()].join(", "),
    );
  if (
    composing ||
    [...session.engines.values()].some(
      (engine) =>
        engine.isPointing() ||
        engine.editing.state.isTextEditing ||
        engine.editing.state.busy,
    )
  )
    throw new Error("Hãy hoàn tất nét viết hoặc phần nhập văn bản trước.");
  if (typeof document !== "undefined") {
    const open = [
      ...document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
    ];
    if (open.some((dialog) => dialog !== ignoreDialog))
      throw new Error("Hãy đóng cửa sổ nhập, xuất hoặc chỉnh sửa đang mở.");
  }
}

/** Holds the editor through the final receipt and asynchronous update handoff. */
export async function prepareWorkspaceForNavigation(
  session: LessonSession,
  options: { ignoreDialog?: HTMLElement; lock?: boolean } = {},
): Promise<() => void> {
  if (snapshot.navigationLocked)
    throw new Error("Một thao tác mở lại đang diễn ra.");
  assertSafe(session, options.ignoreDialog);
  const scope = session.scope?.();
  let hold = options.lock !== false;
  if (hold) {
    publish(true);
    for (const engine of session.engines.values())
      engine.pages?.editor.updateInstanceState({ isReadonly: true });
  }
  const release = () => {
    if (!hold) return;
    hold = false;
    publish(false);
    for (const engine of session.engines.values()) engine.syncReadOnly?.();
  };
  try {
    await session.saving.flush();
    assertSafe(session, options.ignoreDialog);
    if (session.saving.status.phase !== "saved")
      throw new Error(
        "Bài giảng chưa được lưu bền vững. Hãy thử lưu lại hoặc tải bản phục hồi.",
      );
    if (scope !== session.scope?.())
      throw new Error("Bài giảng đã thay đổi trong lúc chuẩn bị.");
    return release;
  } catch (error) {
    release();
    throw error;
  }
}
