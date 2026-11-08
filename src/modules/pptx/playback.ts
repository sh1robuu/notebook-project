import type { SlideBuild } from "./model.ts";

type Entrance = { targets: readonly string[]; at: number };
type Timeline = { targets: ReadonlySet<string>; steps: Entrance[][] };

export function buildTimeline(builds: readonly SlideBuild[]): Timeline {
  const groups = new Map<number, Entrance[]>([[0, []]]);
  const targets = new Set<string>();
  let group = 0,
    previousStart = 0,
    groupEnd = 0;
  for (const build of builds) {
    if (build.effect !== "appear" || !build.targetElementIds.length) continue;
    const nextGroup =
      build.group ?? group + Number(build.trigger === "onClick");
    if (nextGroup !== group) {
      group = nextGroup;
      previousStart = groupEnd = 0;
    }
    const at =
      build.startMs ??
      build.delayMs +
        (build.trigger === "afterPrevious" ? groupEnd : previousStart);
    previousStart = at;
    groupEnd = Math.max(groupEnd, at + build.durationMs);
    const events = groups.get(group) ?? [];
    events.push({ targets: build.targetElementIds, at });
    groups.set(group, events);
    for (const target of build.targetElementIds) targets.add(target);
  }
  return {
    targets,
    steps: [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, events]) => events.sort((a, b) => a.at - b.at)),
  };
}

export function buildFrame(timeline: Timeline, step: number, elapsed: number) {
  const hidden = new Set(timeline.targets);
  let nextAt: number | undefined;
  for (let i = 0; i <= step; i++) {
    for (const event of timeline.steps[i]) {
      if (i === step && event.at > elapsed) {
        nextAt = event.at;
        break;
      }
      for (const id of event.targets) hidden.delete(id);
    }
  }
  return { hidden, nextAt };
}

/** Per-workspace, transient playback. Never writes to the editor or archive. */
export class SlidePlayback {
  #timeline = buildTimeline([]);
  #listeners = new Set<() => void>();
  #state = {
    key: "",
    step: 0,
    last: 0,
    hidden: new Set<string>(),
    pending: false,
  };
  #timer: ReturnType<typeof setTimeout> | undefined;

  getSnapshot = () => this.#state;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  enter(key: string, builds: readonly SlideBuild[]) {
    if (this.#state.key === key) return;
    this.#timeline = buildTimeline(builds);
    this.#show(key, 0, performance.now());
  }

  clear() {
    this.enter("", []);
  }
  restart() {
    this.#show(this.#state.key, 0, performance.now());
  }
  next() {
    const { key, step, last } = this.#state;
    if (step < last) this.#show(key, step + 1, performance.now());
    else this.#show(key, step);
  }
  previous() {
    this.#show(this.#state.key, Math.max(0, this.#state.step - 1));
  }
  revealAll() {
    this.#show(this.#state.key, this.#state.last);
  }

  #show(key: string, step: number, start?: number) {
    clearTimeout(this.#timer);
    const elapsed = start === undefined ? Infinity : performance.now() - start;
    const { hidden, nextAt } = buildFrame(this.#timeline, step, elapsed);
    this.#state = {
      key,
      step,
      last: this.#timeline.steps.length - 1,
      hidden,
      pending: nextAt !== undefined,
    };
    for (const listener of this.#listeners) listener();
    if (nextAt !== undefined)
      this.#timer = setTimeout(
        () => this.#show(key, step, start),
        Math.max(1, nextAt - elapsed),
      );
  }
}
