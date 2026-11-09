import { object } from "./contracts.ts";

export const PREFERENCES_KEY = "lessonboard.device-preferences.v1";
export const preferenceColors = [
  "black",
  "blue",
  "red",
  "green",
  "orange",
  "yellow",
] as const;
export const preferenceSizes = ["s", "m", "l", "xl"] as const;
export type WorkspacePreferences = {
  version: 1;
  penColor: (typeof preferenceColors)[number];
  penSize: (typeof preferenceSizes)[number];
  highlighterColor: (typeof preferenceColors)[number];
  highlighterSize: (typeof preferenceSizes)[number];
  touchMode: "pan" | "write";
  paperColor: "white" | "dark" | "green";
  scratchDock: "right" | "bottom";
  reduceMotion: boolean;
};
export const defaultPreferences: Readonly<WorkspacePreferences> = Object.freeze(
  {
    version: 1,
    penColor: "black",
    penSize: "m",
    highlighterColor: "yellow",
    highlighterSize: "l",
    touchMode: "pan",
    paperColor: "white",
    scratchDock: "right",
    reduceMotion: false,
  },
);

export function validatePreferences(value: unknown): WorkspacePreferences {
  if (!object(value) || value.version !== 1)
    throw new Error("Phiên bản tùy chọn trên thiết bị chưa được hỗ trợ.");
  if (
    Object.keys(value).length !== Object.keys(defaultPreferences).length ||
    Object.keys(value).some((key) => !Object.hasOwn(defaultPreferences, key)) ||
    !preferenceColors.includes(
      value.penColor as WorkspacePreferences["penColor"],
    ) ||
    !preferenceColors.includes(
      value.highlighterColor as WorkspacePreferences["highlighterColor"],
    ) ||
    !preferenceSizes.includes(
      value.penSize as WorkspacePreferences["penSize"],
    ) ||
    !preferenceSizes.includes(
      value.highlighterSize as WorkspacePreferences["highlighterSize"],
    ) ||
    !["pan", "write"].includes(String(value.touchMode)) ||
    !["white", "dark", "green"].includes(String(value.paperColor)) ||
    !["right", "bottom"].includes(String(value.scratchDock)) ||
    typeof value.reduceMotion !== "boolean"
  )
    throw new Error("Tùy chọn trên thiết bị có dữ liệu không hợp lệ.");
  return { ...value } as WorkspacePreferences;
}

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
type PreferenceSnapshot = {
  value: WorkspacePreferences;
  error?: string;
  future: boolean;
};

/** Preferences are device-local and never part of a portable lesson payload. */
export class DevicePreferences {
  #storage?: PreferenceStorage;
  #listeners = new Set<() => void>();
  #snapshot: PreferenceSnapshot = {
    value: { ...defaultPreferences },
    future: false,
  };
  constructor(storage?: PreferenceStorage) {
    this.#storage = storage;
    this.refresh();
  }
  getSnapshot = () => this.#snapshot;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #publish(value: PreferenceSnapshot) {
    this.#snapshot = value;
    for (const listener of this.#listeners) listener();
  }
  refresh() {
    try {
      const raw = this.#storage?.getItem(PREFERENCES_KEY);
      if (!raw) {
        this.#publish({ value: { ...defaultPreferences }, future: false });
        return;
      }
      const value: unknown = JSON.parse(raw);
      try {
        this.#publish({ value: validatePreferences(value), future: false });
      } catch (error) {
        this.#publish({
          value: { ...defaultPreferences },
          future:
            object(value) &&
            typeof value.version === "number" &&
            value.version > 1,
          error:
            error instanceof Error ? error.message : "Không đọc được tùy chọn.",
        });
      }
    } catch {
      this.#publish({
        ...this.#snapshot,
        error:
          "Trình duyệt không cho phép đọc tùy chọn. Giá trị mặc định đang được dùng.",
      });
    }
  }
  save(value: WorkspacePreferences) {
    if (this.#snapshot.future) return false;
    return this.#write(value);
  }
  reset() {
    return this.#write({ ...defaultPreferences });
  }
  #write(value: WorkspacePreferences) {
    try {
      const checked = validatePreferences(value);
      if (!this.#storage) throw new Error("Preference storage unavailable");
      this.#storage.setItem(PREFERENCES_KEY, JSON.stringify(checked));
      this.#publish({ value: checked, future: false });
      return true;
    } catch {
      this.#publish({
        ...this.#snapshot,
        error:
          "Chưa lưu được tùy chọn. Hãy kiểm tra quyền lưu dữ liệu của trình duyệt.",
      });
      return false;
    }
  }
}

let storage: PreferenceStorage | undefined;
try {
  if (typeof window !== "undefined") storage = window.localStorage;
} catch {
  /* The settings panel exposes the unavailable storage state. */
}
export const devicePreferences = new DevicePreferences(storage);
