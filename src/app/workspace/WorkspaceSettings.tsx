import { useState, useSyncExternalStore } from "react";
import {
  devicePreferences,
  preferenceColors,
  preferenceSizes,
} from "../../modules/workspace/preferences.ts";
import type { WorkspacePreferences } from "../../modules/workspace/preferences.ts";

const colorNames = {
  black: "Đen",
  blue: "Xanh dương",
  red: "Đỏ",
  green: "Xanh lá",
  orange: "Cam",
  yellow: "Vàng",
};
const sizeNames = { s: "Mảnh", m: "Vừa", l: "Đậm", xl: "Rộng" };

export function WorkspaceSettings({
  apply,
}: {
  apply: (preferences: WorkspacePreferences) => void;
}) {
  const current = useSyncExternalStore(
    devicePreferences.subscribe,
    devicePreferences.getSnapshot,
  );
  const [draft, setDraft] = useState(current.value);
  const [message, setMessage] = useState("");
  const [reset, setReset] = useState(false);
  function update<K extends keyof WorkspacePreferences>(
    key: K,
    value: WorkspacePreferences[K],
  ) {
    setDraft({ ...draft, [key]: value });
    setMessage("");
  }
  function save() {
    if (devicePreferences.save(draft)) {
      apply(devicePreferences.getSnapshot().value);
      setMessage("Đã lưu tùy chọn trên thiết bị.");
    }
  }
  function resetDefaults() {
    if (devicePreferences.reset()) {
      const next = devicePreferences.getSnapshot().value;
      setDraft(next);
      apply(next);
      setReset(false);
      setMessage("Đã khôi phục tùy chọn mặc định.");
    }
  }
  return (
    <section aria-label="Tùy chọn trên thiết bị">
      <h3>Cài đặt trên thiết bị</h3>
      <p>
        Màu và độ dày áp dụng cho nét viết tiếp theo. Màu trang và vị trí nháp
        áp dụng khi tạo mới.
      </p>
      <div className="workspace-fields">
        <label>
          Màu bút mặc định
          <select
            aria-label="Màu bút mặc định"
            value={draft.penColor}
            onChange={(event) =>
              update(
                "penColor",
                event.currentTarget.value as WorkspacePreferences["penColor"],
              )
            }
          >
            {preferenceColors.map((color) => (
              <option key={color} value={color}>
                {colorNames[color]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nét bút mặc định
          <select
            aria-label="Nét bút mặc định"
            value={draft.penSize}
            onChange={(event) =>
              update(
                "penSize",
                event.currentTarget.value as WorkspacePreferences["penSize"],
              )
            }
          >
            {preferenceSizes.map((size) => (
              <option key={size} value={size}>
                {sizeNames[size]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Màu bút tô
          <select
            aria-label="Màu bút tô"
            value={draft.highlighterColor}
            onChange={(event) =>
              update(
                "highlighterColor",
                event.currentTarget
                  .value as WorkspacePreferences["highlighterColor"],
              )
            }
          >
            {preferenceColors.map((color) => (
              <option key={color} value={color}>
                {colorNames[color]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nét bút tô
          <select
            aria-label="Nét bút tô"
            value={draft.highlighterSize}
            onChange={(event) =>
              update(
                "highlighterSize",
                event.currentTarget
                  .value as WorkspacePreferences["highlighterSize"],
              )
            }
          >
            {preferenceSizes.map((size) => (
              <option key={size} value={size}>
                {sizeNames[size]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Chạm bằng ngón tay
          <select
            aria-label="Chạm bằng ngón tay"
            value={draft.touchMode}
            onChange={(event) =>
              update(
                "touchMode",
                event.currentTarget.value as WorkspacePreferences["touchMode"],
              )
            }
          >
            <option value="pan">Di chuyển bảng</option>
            <option value="write">Viết trên bảng</option>
          </select>
        </label>
        <label>
          Màu trang mới
          <select
            aria-label="Màu trang mới"
            value={draft.paperColor}
            onChange={(event) =>
              update(
                "paperColor",
                event.currentTarget.value as WorkspacePreferences["paperColor"],
              )
            }
          >
            <option value="white">Trắng</option>
            <option value="dark">Tối</option>
            <option value="green">Xanh bảng</option>
          </select>
        </label>
        <label>
          Vị trí nháp cho bài mới
          <select
            aria-label="Vị trí nháp cho bài mới"
            value={draft.scratchDock}
            onChange={(event) =>
              update(
                "scratchDock",
                event.currentTarget
                  .value as WorkspacePreferences["scratchDock"],
              )
            }
          >
            <option value="right">Bên phải</option>
            <option value="bottom">Phía dưới</option>
          </select>
        </label>
        <label className="workspace-check">
          <input
            type="checkbox"
            checked={draft.reduceMotion}
            onChange={(event) =>
              update("reduceMotion", event.currentTarget.checked)
            }
          />
          Giảm chuyển động giao diện
        </label>
      </div>
      {current.error ? (
        <p className="dialog-error" role="alert">
          {current.error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <div className="workspace-row">
        <button
          type="button"
          className="primary"
          disabled={current.future}
          onClick={save}
        >
          Lưu tùy chọn
        </button>
        <button type="button" onClick={() => setReset(!reset)}>
          Khôi phục mặc định
        </button>
      </div>
      {reset ? (
        <div className="workspace-confirm">
          <p>
            Đặt lại tùy chọn trên thiết bị. Nội dung và bố cục của các bài giảng
            đã lưu vẫn được giữ.
          </p>
          <button type="button" onClick={resetDefaults}>
            Xác nhận đặt lại tùy chọn
          </button>
        </div>
      ) : null}
    </section>
  );
}
