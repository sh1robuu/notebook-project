import { useEffect, useState } from "react";
import type { FormEvent, RefObject } from "react";
import type {
  ClassroomTask,
  TaskInput,
  TaskTimer,
  TeacherParticipationCommand,
  TeacherTask,
} from "../../modules/classroom/participation-types.ts";

export type ClassroomClock = RefObject<{
  serverTime: number;
  observedAt: number;
}>;

export function TaskTime({
  timer,
  clock,
}: {
  timer: TaskTimer;
  clock: ClassroomClock;
}) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (timer.state !== "running") return;
    const tick = () => setNow(performance.now());
    tick();
    const interval = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [timer.state, timer.endsAt]);
  const elapsed = Math.max(0, now - clock.current.observedAt);
  const milliseconds =
    timer.state === "running" && timer.endsAt
      ? Math.max(
          0,
          Date.parse(timer.endsAt) - clock.current.serverTime - elapsed,
        )
      : timer.remainingMs;
  if (!timer.durationSeconds) return null;
  const seconds = Math.ceil(milliseconds / 1000);
  const time =
    Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  const state =
    timer.state === "ended" || (timer.state === "running" && seconds === 0)
      ? "Hết giờ"
      : timer.state === "paused"
        ? "Đã tạm dừng"
        : timer.state === "running"
          ? "Đang đếm"
          : "Chưa bắt đầu";
  return (
    <p className="participation-timer">
      <span>{state}</span>
      <time aria-label={"Thời gian còn lại " + time}>{time}</time>
    </p>
  );
}

export function TaskSummary({
  task,
  clock,
}: {
  task: ClassroomTask;
  clock: ClassroomClock;
}) {
  return (
    <div className="participation-task-summary">
      <div>
        <h3>{task.title}</h3>
        <p className="classroom-muted">
          Phiên bản {task.revision} ·{" "}
          {task.submissionOpen ? "Đang nhận bài" : "Đã khóa nộp"}
        </p>
      </div>
      <TaskTime timer={task.timer} clock={clock} />
      <p className="participation-prose">{task.instructions}</p>
      {task.focusQuestion && (
        <p className="participation-prose">
          <strong>Câu hỏi</strong> {task.focusQuestion}
        </p>
      )}
    </div>
  );
}

export function TaskEditor({
  task,
  groups,
  busy,
  submit,
  cancel,
}: {
  task?: TeacherTask;
  groups: { id: string; name: string }[];
  busy: boolean;
  submit: (task: TaskInput) => void;
  cancel: () => void;
}) {
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const string = (name: string) => String(form.get(name) ?? "").trim();
    submit({
      title: string("title"),
      instructions: string("instructions"),
      focusQuestion: string("focus"),
      groupIds: form.getAll("groups").map(String),
      allowedTypes: form
        .getAll("kinds")
        .filter(
          (value): value is "image" | "link" =>
            value === "image" || value === "link",
        ),
      submissionOpen: form.has("open"),
      durationSeconds: Number(form.get("seconds")),
      referenceAnswer: string("answer"),
      privateNotes: string("notes"),
    });
  }
  return (
    <form className="participation-form" onSubmit={save}>
      <fieldset disabled={busy}>
        <legend>{task ? "Sửa bài tập" : "Bài tập mới"}</legend>
        <label>
          Tên bài tập
          <input
            name="title"
            maxLength={120}
            required
            defaultValue={task?.title}
          />
        </label>
        <label>
          Hướng dẫn
          <textarea
            name="instructions"
            rows={3}
            maxLength={4000}
            required
            defaultValue={task?.instructions}
          />
        </label>
        <label>
          Câu hỏi trọng tâm
          <input
            name="focus"
            maxLength={500}
            defaultValue={task?.focusQuestion}
          />
        </label>
        {groups.length > 0 && (
          <fieldset className="participation-choice">
            <legend>Giao cho nhóm</legend>
            <p className="classroom-muted">Để trống nếu giao cho cả lớp.</p>
            {groups.map((group) => (
              <label key={group.id}>
                <input
                  type="checkbox"
                  name="groups"
                  value={group.id}
                  defaultChecked={task?.groupIds.includes(group.id)}
                />{" "}
                {group.name}
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="participation-choice">
          <legend>Định dạng nộp</legend>
          <label>
            <input
              type="checkbox"
              name="kinds"
              value="image"
              defaultChecked={task?.allowedTypes.includes("image") ?? true}
            />{" "}
            Ảnh
          </label>
          <label>
            <input
              type="checkbox"
              name="kinds"
              value="link"
              defaultChecked={task?.allowedTypes.includes("link") ?? true}
            />{" "}
            Liên kết
          </label>
        </fieldset>
        <label className="participation-inline">
          <input
            type="checkbox"
            name="open"
            defaultChecked={task?.submissionOpen ?? true}
          />{" "}
          Mở nộp bài
        </label>
        <label>
          Thời lượng (giây)
          <input
            name="seconds"
            type="number"
            min={0}
            max={7200}
            step={1}
            required
            defaultValue={task?.timer.durationSeconds ?? 0}
          />
        </label>
        <details className="participation-private-notes">
          <summary>Chỉ giáo viên xem</summary>
          <label>
            Đáp án tham khảo
            <textarea
              name="answer"
              rows={2}
              maxLength={4000}
              defaultValue={task?.referenceAnswer}
            />
          </label>
          <label>
            Ghi chú riêng
            <textarea
              name="notes"
              rows={2}
              maxLength={2000}
              defaultValue={task?.privateNotes}
            />
          </label>
        </details>
        <div className="classroom-actions">
          <button type="submit" className="classroom-primary">
            {task ? "Lưu bài tập" : "Giao bài tập"}
          </button>
          <button type="button" onClick={cancel}>
            Hủy
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function TaskControls({
  task,
  send,
  busy,
}: {
  task: ClassroomTask;
  send: (command: TeacherParticipationCommand) => void;
  busy: boolean;
}) {
  const base = { taskId: task.id, expectedRevision: task.revision };
  return (
    <div className="classroom-actions">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          send({
            ...base,
            type: task.submissionOpen ? "lockSubmissions" : "unlockSubmissions",
          })
        }
      >
        {task.submissionOpen ? "Khóa nộp bài" : "Mở nộp bài"}
      </button>
      {task.timer.durationSeconds > 0 && (
        <>
          {task.timer.state === "idle" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ ...base, type: "startTimer" })}
            >
              Bắt đầu đếm
            </button>
          )}
          {task.timer.state === "running" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ ...base, type: "pauseTimer" })}
            >
              Tạm dừng
            </button>
          )}
          {task.timer.state === "paused" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ ...base, type: "resumeTimer" })}
            >
              Tiếp tục đếm
            </button>
          )}
          {(task.timer.state === "running" ||
            task.timer.state === "paused") && (
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ ...base, type: "endTimer" })}
            >
              Dừng đếm
            </button>
          )}
          {task.timer.state !== "idle" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ ...base, type: "resetTimer" })}
            >
              Đặt lại
            </button>
          )}
        </>
      )}
    </div>
  );
}
