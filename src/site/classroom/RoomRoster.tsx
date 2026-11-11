import { useId } from "react";
import type { FormEvent } from "react";
import type { Room, RoomCommand } from "../../modules/classroom/api.ts";
import { ClassroomDisclosure } from "./ClassroomFrame.tsx";
import type { Confirmation } from "./RoomDetail.tsx";

type RoomSectionProps = {
  room: Room;
  act: (command: RoomCommand) => void;
  confirm: (action: Confirmation) => void;
  disabled: boolean;
};

function submittedName(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return String(new FormData(event.currentTarget).get("name") ?? "").trim();
}

export function Roster({ room, act, confirm, disabled }: RoomSectionProps) {
  const heading = useId();
  const participants = room.participants.toSorted(
    (a, b) => a.position - b.position,
  );
  function move(index: number, offset: number) {
    const participantIds = participants.map((participant) => participant.id);
    const target = index + offset;
    if (target < 0 || target >= participantIds.length) return;
    [participantIds[index], participantIds[target]] = [
      participantIds[target],
      participantIds[index],
    ];
    act({ type: "reorderParticipants", participantIds });
  }
  return (
    <section
      className="classroom-panel classroom-roster"
      aria-labelledby={heading}
    >
      <div className="classroom-section-heading">
        <h3 id={heading}>Danh sách học sinh</h3>
        <p className="classroom-muted">{participants.length} học sinh</p>
      </div>
      {participants.length === 0 ? (
        <p className="classroom-muted">
          Học sinh sẽ xuất hiện khi vào phòng bằng mã mời.
        </p>
      ) : (
        <ol className="classroom-roster-list" aria-label="Danh sách học sinh">
          {participants.map((participant, index) => {
            const label = participant.displayName + ", số " + (index + 1);
            return (
              <li key={participant.id}>
                <div className="classroom-person">
                  <span aria-label={"Số " + (index + 1)}>{index + 1}</span>
                  <strong>{participant.displayName}</strong>
                </div>
                <select
                  aria-label={"Nhóm của " + label}
                  value={participant.groupId ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    act({
                      type: "assignGroup",
                      participantId: participant.id,
                      groupId: event.target.value || null,
                    })
                  }
                >
                  <option value="">Chưa vào nhóm</option>
                  {room.groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
                <div className="classroom-person-actions">
                  <button
                    type="button"
                    aria-label={"Đưa " + label + " lên"}
                    disabled={disabled || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={"Đưa " + label + " xuống"}
                    disabled={disabled || index === participants.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <ClassroomDisclosure
                    label="Sửa"
                    accessibleName={"Sửa " + label}
                  >
                    <form
                      className="classroom-form"
                      onSubmit={(event) => {
                        const displayName = submittedName(event);
                        if (displayName)
                          act({
                            type: "renameParticipant",
                            participantId: participant.id,
                            displayName,
                          });
                      }}
                    >
                      <label>
                        Tên hiển thị
                        <input
                          name="name"
                          defaultValue={participant.displayName}
                          key={participant.displayName}
                          maxLength={80}
                          required
                          disabled={disabled}
                        />
                      </label>
                      <div className="classroom-actions">
                        <button type="submit" disabled={disabled}>
                          Lưu tên
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            confirm({
                              heading: "Xóa học sinh khỏi phòng?",
                              detail:
                                participant.displayName +
                                " sẽ mất quyền truy cập phòng bằng phiên hiện tại.",
                              label: "Xóa học sinh",
                              command: {
                                type: "removeParticipant",
                                participantId: participant.id,
                              },
                            })
                          }
                        >
                          Xóa khỏi phòng
                        </button>
                      </div>
                    </form>
                  </ClassroomDisclosure>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function RoomGroups({ room, act, confirm, disabled }: RoomSectionProps) {
  const heading = useId();
  const counts = new Map<string, number>();
  for (const participant of room.participants) {
    if (participant.groupId)
      counts.set(
        participant.groupId,
        (counts.get(participant.groupId) ?? 0) + 1,
      );
  }
  return (
    <section
      className="classroom-panel classroom-groups"
      aria-labelledby={heading}
    >
      <div className="classroom-section-heading">
        <h3 id={heading}>Nhóm</h3>
        <p className="classroom-muted">{room.groups.length} nhóm</p>
      </div>
      {room.groups.length ? (
        <ul className="classroom-group-list">
          {room.groups.map((group) => (
            <li key={group.id}>
              <ClassroomDisclosure
                label={
                  <>
                    <span>{group.name}</span>
                    <small>{counts.get(group.id) ?? 0} học sinh</small>
                  </>
                }
              >
                <form
                  className="classroom-form"
                  onSubmit={(event) => {
                    const name = submittedName(event);
                    if (name)
                      act({ type: "renameGroup", groupId: group.id, name });
                  }}
                >
                  <label>
                    Tên nhóm
                    <input
                      name="name"
                      defaultValue={group.name}
                      key={group.name}
                      maxLength={80}
                      required
                      disabled={disabled}
                    />
                  </label>
                  <div className="classroom-actions">
                    <button type="submit" disabled={disabled}>
                      Lưu tên nhóm
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        confirm({
                          heading: "Xóa nhóm?",
                          detail:
                            "Học sinh trong " +
                            group.name +
                            " vẫn ở trong phòng và được bỏ phân nhóm.",
                          label: "Xóa nhóm",
                          command: { type: "deleteGroup", groupId: group.id },
                        })
                      }
                    >
                      Xóa nhóm
                    </button>
                  </div>
                </form>
              </ClassroomDisclosure>
            </li>
          ))}
        </ul>
      ) : (
        <p className="classroom-muted">
          Chưa có nhóm. Tạo nhóm rồi phân học sinh từ danh sách.
        </p>
      )}
      {!disabled && (
        <form
          className="classroom-form classroom-add-group"
          onSubmit={(event) => {
            const name = submittedName(event);
            if (name) act({ type: "createGroup", name });
          }}
        >
          <label>
            Nhóm mới
            <input
              name="name"
              maxLength={80}
              required
              key={room.groups.length}
            />
          </label>
          <button type="submit">Tạo nhóm</button>
        </form>
      )}
    </section>
  );
}
