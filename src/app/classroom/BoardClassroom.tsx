import { lazy, Suspense, useEffect, useState } from "react";
import type { BoardEngine } from "../../modules/board/engine.ts";
import type { ParticipationSection } from "../../site/classroom/TeacherParticipation.tsx";
import { Icon } from "../Icon.tsx";

const ClassroomDialog = lazy(() => import("./ClassroomDialog.tsx"));
type Opening = { section: ParticipationSection; roomId?: string };

function classroomLink(): Opening | undefined {
  const query = new URLSearchParams(location.search);
  const roomId = query.get("classroom");
  const panel = query.get("panel");
  if (roomId && /^[a-f0-9-]{36}$/i.test(roomId))
    return { roomId, section: panel === "capture" ? "capture" : "gallery" };
}

export function BoardClassroom({ engine }: { engine: BoardEngine }) {
  const [opening, setOpening] = useState(classroomLink);
  useEffect(() => {
    if (!opening?.roomId) return;
    const url = new URL(location.href);
    if (!url.searchParams.has("classroom")) return;
    url.searchParams.delete("classroom");
    url.searchParams.delete("panel");
    history.replaceState(history.state, "", url);
  }, [opening?.roomId]);
  return (
    <>
      <button
        className="chrome-control"
        type="button"
        title="Bài làm của lớp"
        aria-label="Bài làm của lớp"
        onClick={() => setOpening({ section: "gallery" })}
      >
        <Icon name="image" />
      </button>
      <button
        className="chrome-control"
        type="button"
        title="Chụp ảnh từ điện thoại"
        aria-label="Chụp ảnh từ điện thoại"
        onClick={() => setOpening({ section: "capture" })}
      >
        <Icon name="camera" />
      </button>
      {opening && (
        <Suspense
          fallback={
            <span className="sr-only" role="status">
              Đang mở hoạt động lớp học…
            </span>
          }
        >
          <ClassroomDialog
            engine={engine}
            section={opening.section}
            roomId={opening.roomId}
            close={() => setOpening(undefined)}
          />
        </Suspense>
      )}
    </>
  );
}
