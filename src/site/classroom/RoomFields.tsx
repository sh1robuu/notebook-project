import type { FormEvent } from "react";
import type { RoomInput } from "../../modules/classroom/api.ts";
import { roomMode } from "./ClassroomFrame.tsx";

export function RoomFields({
  initial,
  submit,
  disabled,
  label,
}: {
  initial: RoomInput;
  submit: (values: RoomInput) => void;
  disabled: boolean;
  label: string;
}) {
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    const mode = data.get("mode") === "group" ? "group" : "individual";
    if (title) submit({ title, mode });
  }
  return (
    <form className="classroom-form" onSubmit={save}>
      <label>
        Tên phòng
        <input
          name="title"
          defaultValue={initial.title}
          maxLength={120}
          required
          disabled={disabled}
        />
      </label>
      <label>
        Hình thức tham gia
        <select aria-label="Hình thức tham gia" name="mode" defaultValue={initial.mode} disabled={disabled}>
          <option value="individual">{roomMode.individual}</option>
          <option value="group">{roomMode.group}</option>
        </select>
      </label>
      <button type="submit" className="classroom-primary" disabled={disabled}>
        {label}
      </button>
    </form>
  );
}
