import { classroomApiPrefix } from "./api.ts";

export type RoomConnection = "connecting" | "live" | "reconnecting";
type Feed = {
  connection: (state: RoomConnection) => void;
  invalidate: (revision: number, reset: boolean) => void;
  authorizationLost: () => void;
  probe?: () => void;
};

function eventRevision(event: Event): number | undefined {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string")
    return;
  try {
    const data: unknown = JSON.parse(event.data);
    if (
      data &&
      typeof data === "object" &&
      "revision" in data &&
      typeof data.revision === "number" &&
      Number.isSafeInteger(data.revision) &&
      data.revision >= 0
    )
      return data.revision;
  } catch {
    // A malformed event has no authority to change the displayed state.
  }
}

export function connectRoomEvents(path: string, after: number, feed: Feed) {
  let cursor = after;
  let stopped = false;
  let opened = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stream = new EventSource(classroomApiPrefix + path + "?after=" + after);
  feed.connection("connecting");
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream.close();
  };
  const heartbeat = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!stopped) {
        feed.connection("reconnecting");
        feed.probe?.();
      }
    }, 30_000);
  };
  stream.addEventListener("open", () => {
    if (stopped) return;
    feed.connection("live");
    if (opened) feed.probe?.();
    opened = true;
    heartbeat();
  });
  stream.addEventListener("error", () => {
    if (stopped) return;
    clearTimeout(timer);
    feed.connection("reconnecting");
    feed.probe?.();
  });
  stream.addEventListener("heartbeat", () => {
    if (stopped) return;
    feed.connection("live");
    heartbeat();
  });
  for (const type of ["room", "reset"] as const) {
    stream.addEventListener(type, (event) => {
      if (stopped) return;
      heartbeat();
      const revision = eventRevision(event);
      if (revision === undefined || (type === "room" && revision <= cursor))
        return;
      cursor = revision;
      feed.invalidate(revision, type === "reset");
    });
  }
  stream.addEventListener("authorization", () => {
    if (stopped) return;
    stop();
    feed.authorizationLost();
  });
  return stop;
}
