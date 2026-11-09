import { useEffect, useRef, useState } from "react";
import type { Lesson } from "../../modules/workspace/model.ts";
import { LocalWorkspace } from "../../modules/workspace/local-workspace.ts";
import type { LessonListEntry } from "../../modules/workspace/local-workspace.ts";
import { readArchiveCandidate } from "../../modules/workspace/archive.ts";
import type { ArchiveCandidate } from "../../modules/workspace/archive-core.ts";
import { validateArchivedPdfs } from "../../modules/pdf/archive-validation.ts";
import { beginOperation } from "../../modules/workspace/activity.ts";

export function WorkspaceRecovery({
  error,
  retry,
  select,
  create,
}: {
  error: string;
  retry: () => void;
  select: (id: string) => void;
  create: (candidate?: Lesson) => void;
}) {
  const [lessons, setLessons] = useState<LessonListEntry[]>([]);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState("");
  const [inspectError, setInspectError] = useState("");
  const [candidate, setCandidate] = useState<ArchiveCandidate>();
  const control = useRef<AbortController>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    void LocalWorkspace.inspectLessons().then(
      (rows) => {
        if (alive) setLessons(rows);
      },
      () => {
        if (alive) setInspectError("Chưa đọc được danh sách bài đã lưu.");
      },
    );
    return () => {
      alive = false;
      control.current?.abort();
    };
  }, []);
  async function check(file: File) {
    const release = beginOperation("Kiểm tra bản sao bài giảng");
    const abort = new AbortController();
    control.current = abort;
    setFailure("");
    setCandidate(undefined);
    setChecking(true);
    try {
      const next = await readArchiveCandidate(file, abort.signal);
      await validateArchivedPdfs(
        next.lesson,
        abort.signal,
        () => {},
        async () => {
          throw new Error(
            "Tệp có PDF cần mật khẩu. Hãy mở một bài đang dùng được hoặc tạo bài mới, rồi nhập bản sao bằng Open lesson.",
          );
        },
        () => undefined,
      );
      if (!abort.signal.aborted) setCandidate(next);
    } catch (reason) {
      if (!abort.signal.aborted)
        setFailure(
          reason instanceof Error ? reason.message : "Chưa đọc được bản sao.",
        );
    } finally {
      release();
      if (!abort.signal.aborted) setChecking(false);
    }
  }
  return (
    <>
      <h2>Khôi phục bài giảng</h2>
      <p role="alert">{error}</p>
      <p>
        Các bài đã lưu vẫn nằm trên thiết bị. Bạn có thể thử lại, chọn một bài
        khác hoặc mở bản sao.
      </p>
      {inspectError ? <p>{inspectError}</p> : null}
      <div className="workspace-row">
        <button disabled={checking} onClick={retry}>
          Thử mở lại
        </button>
        <button disabled={checking} onClick={() => create()}>
          Tạo bài mới
        </button>
        <button disabled={checking} onClick={() => fileInput.current?.click()}>
          Kiểm tra tệp .teachboard
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".teachboard"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void check(file);
          }}
        />
      </div>
      {lessons.length > 0 ? (
        <ul className="workspace-lesson-list" aria-label="Bài đã lưu">
          {lessons.map((lesson) => (
            <li key={lesson.id}>
              <div>
                {lesson.title}
                {lesson.valid ? "" : " · cần kiểm tra"}
              </div>
              <button disabled={checking} onClick={() => select(lesson.id)}>
                Mở
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {checking ? <p role="status">Đang kiểm tra bản sao…</p> : null}
      {failure ? <p role="alert">{failure}</p> : null}
      {candidate ? (
        <div className="workspace-confirm">
          <p>
            {candidate.lesson.title || "Bài giảng chưa đặt tên"} · Bản lưu{" "}
            {candidate.lesson.revision} · {candidate.info.mainPages} trang
          </p>
          {candidate.info.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <button onClick={() => create(candidate.lesson)}>
            Mở bản sao thành bài mới
          </button>
        </div>
      ) : null}
    </>
  );
}
