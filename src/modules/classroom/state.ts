import { useCallback, useEffect, useRef, useState } from "react";
import { ClassroomError, classroomError } from "./api.ts";
import { connectRoomEvents } from "./events.ts";
import type { RoomConnection } from "./events.ts";

type Command = (key: string, signal: AbortSignal) => Promise<void>;
type Attempt = { command: Command; key: string };

export function useCommittedCommand(
  onDenied: () => void,
  kind: "join" | "other" = "other",
) {
  const active = useRef<AbortController | null>(null);
  const pending = useRef<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  useEffect(() => () => active.current?.abort(), []);

  async function execute(attempt: Attempt) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    pending.current = null;
    setBusy(true);
    setCommitted(false);
    setError("");
    setCanRetry(false);
    try {
      await attempt.command(attempt.key, controller.signal);
      if (!controller.signal.aborted) setCommitted(true);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(classroomError(failure, kind));
      if (failure instanceof ClassroomError) {
        if (failure.unauthorized && kind !== "join") onDenied();
        if (failure.retryable) {
          pending.current = attempt;
          setCanRetry(true);
        }
      }
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return {
    busy,
    committed,
    error,
    canRetry,
    run: (command: Command) =>
      void execute({ command, key: crypto.randomUUID() }),
    retry: () => {
      if (pending.current) void execute(pending.current);
    },
  };
}

type Versioned = { id: string; revision: number };

export function useLiveRoom<Room extends Versioned>(
  load: (signal: AbortSignal) => Promise<{ room: Room }>,
  events: string,
  accessLost: () => void,
  initial?: Room,
) {
  const [room, setRoom] = useState(initial);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<RoomConnection>("connecting");
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef<Room | undefined>(initial);
  const requestRefresh = useRef<(() => void) | null>(null);
  const apply = useCallback((next: Room, reset = false) => {
    if (latest.current && next.id !== latest.current.id) return;
    if (reset || !latest.current || next.revision >= latest.current.revision) {
      latest.current = next;
      setRoom(next);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let stop: (() => void) | undefined;
    let fetching = false;
    let queued = false;
    let resetting = false;

    function clear() {
      latest.current = undefined;
      setRoom(undefined);
      stop?.();
      controller.abort();
      accessLost();
    }

    async function refresh(reset = false) {
      if (controller.signal.aborted) return;
      if (fetching) {
        queued = true;
        resetting ||= reset;
        return;
      }
      fetching = true;
      setRefreshing(true);
      try {
        const result = await load(controller.signal);
        if (controller.signal.aborted) return;
        if (latest.current && result.room.id !== latest.current.id) {
          clear();
          return;
        }
        apply(result.room, reset);
        setError("");
        if (!stop) listen(result.room.revision);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof ClassroomError && failure.unauthorized) clear();
        else setError(classroomError(failure));
      } finally {
        fetching = false;
        if (!controller.signal.aborted) {
          setRefreshing(false);
          if (queued) {
            queued = false;
            const nextReset = resetting;
            resetting = false;
            void refresh(nextReset);
          }
        }
      }
    }

    function listen(revision: number) {
      stop = connectRoomEvents(events, revision, {
        connection: setConnection,
        invalidate: (updated, reset) => {
          if (reset || !latest.current || updated > latest.current.revision)
            void refresh(reset);
        },
        probe: () => void refresh(),
        authorizationLost: clear,
      });
    }

    requestRefresh.current = () => void refresh();
    if (latest.current) listen(latest.current.revision);
    else void refresh();
    return () => {
      requestRefresh.current = null;
      controller.abort();
      stop?.();
    };
  }, [accessLost, apply, events, load]);

  return {
    room,
    error,
    connection,
    refreshing,
    apply,
    refresh: () => requestRefresh.current?.(),
  };
}
