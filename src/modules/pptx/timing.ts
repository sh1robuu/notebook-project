import {
  descendants,
  elements,
  type XmlElement,
} from "../documents/package.ts";
import { MAX_PPTX_BUILDS, MAX_PPTX_TIME, type SlideBuild } from "./model.ts";
import { attr, boundedText, numeric, on, p, P, ps } from "./xml.ts";

const triggers = new Map<string, SlideBuild["trigger"]>([
  ["clickEffect", "onClick"],
  ["withEffect", "withPrevious"],
  ["afterEffect", "afterPrevious"],
]);

function timeChildren(node: XmlElement): XmlElement[] {
  const container = p(node, "childTnLst");
  if (!container) return [];
  return elements(container).flatMap((wrapper) => {
    if (
      wrapper.namespaceURI !== P ||
      !["par", "seq", "excl"].includes(wrapper.localName ?? "")
    )
      return [];
    const time = p(wrapper, "cTn");
    return time ? [time] : [];
  });
}

function condition(node: XmlElement) {
  const conditions = ps(p(node, "stCondLst"), "cond");
  const rawDelay = attr(conditions[0], "delay");
  return {
    delay:
      rawDelay && rawDelay !== "indefinite" ? numeric(rawDelay, -1) : undefined,
    click: rawDelay === "indefinite",
    complex:
      conditions.length > 1 ||
      !!attr(conditions[0], "evt") ||
      (conditions[0] ? elements(conditions[0]).length > 0 : false) ||
      (rawDelay !== "" && rawDelay !== "indefinite" && !/^\d+$/.test(rawDelay)),
  };
}

function targets(node: XmlElement): string[] {
  return [
    ...new Set(
      descendants(node, P, "spTgt").map((target) => attr(target, "spid")),
    ),
  ].filter(Boolean);
}

function visibilitySets(node: XmlElement) {
  return descendants(node, P, "set").filter(
    (set) =>
      attr(p(p(set, "to"), "strVal"), "val") === "visible" &&
      ps(p(p(set, "cBhvr"), "attrNameLst"), "attrName").some(
        (name) => name.textContent === "style.visibility",
      ),
  );
}

function repeatsOrReverses(node: XmlElement) {
  return (
    !!attr(node, "repeatCount") ||
    !!attr(node, "repeatDur") ||
    on(attr(node, "autoRev"))
  );
}

/** Normalize recognized PowerPoint main-sequence effects to timed visibility. */
export function parseSlideBuilds(
  root: XmlElement,
  slideId: string,
  elementIds: ReadonlyMap<string, string>,
  report: (code: string, message: string, elementId?: string) => void,
): SlideBuild[] {
  const timing = p(root, "timing");
  if (!timing) return [];
  const sequences = descendants(timing, P, "cTn");
  const main = sequences.find((time) => attr(time, "nodeType") === "mainSeq");
  if (!main) {
    report(
      "animation-unsupported",
      "Only the PowerPoint main animation sequence is supported. Content remains static.",
    );
    return [];
  }
  if (sequences.some((time) => attr(time, "nodeType") === "interactiveSeq"))
    report(
      "animation-unsupported",
      "Shape-triggered animations are unsupported and remain static.",
    );

  const partial = new Set<string>();
  const buildList = p(timing, "bldLst");
  if (buildList) {
    for (const item of elements(buildList)) {
      const type = attr(item, "build");
      if (item.localName !== "bldP" || (type && type !== "allAtOnce"))
        partial.add(attr(item, "spid"));
    }
  }

  const builds: SlideBuild[] = [];
  const buildIds = new Set<string>();
  let group = 0;
  let previousStart = 0;
  let previousEnd = 0;
  let containsUnmodeledTiming = false;

  const add = (
    node: XmlElement,
    trigger: SlideBuild["trigger"],
    groupOffset: number | undefined,
    complexParent: boolean,
    repeatingParent: boolean,
  ) => {
    if (builds.length >= MAX_PPTX_BUILDS)
      throw new Error("PowerPoint slide build count exceeds 1,000.");
    const own = condition(node);
    const sourceTargets = targets(node);
    const targetsInScene = sourceTargets.flatMap(
      (id) => elementIds.get(id) ?? [],
    );
    const setters = visibilitySets(node);
    const visibilityTargets = new Set(setters.flatMap(targets));
    const presetId = boundedText(attr(node, "presetID"), 40);
    const presetClass = boundedText(attr(node, "presetClass"), 40);
    const appear = presetClass === "entr" && presetId === "1";
    const visibilityDelay =
      setters.length === 1
        ? (condition(p(p(setters[0], "cBhvr"), "cTn") ?? node).delay ?? 0)
        : 0;
    const durationMs = descendants(node, P, "cTn").reduce(
      (duration, time) => Math.max(duration, numeric(attr(time, "dur"))),
      Math.max(0, numeric(attr(node, "dur"))),
    );
    const delayMs = (own.delay ?? 0) + visibilityDelay;
    const impliedOffset =
      trigger === "onClick"
        ? 0
        : trigger === "withPrevious"
          ? previousStart
          : previousEnd;
    const startMs = (groupOffset ?? impliedOffset) + delayMs;
    const simpleVisibility =
      setters.length > 0 &&
      sourceTargets.every((id) => visibilityTargets.has(id));
    const partialTarget =
      descendants(node, P, "spTgt").some(
        (target) => elements(target).length > 0,
      ) || sourceTargets.some((id) => partial.has(id));
    const boundedTiming =
      delayMs >= 0 &&
      startMs >= 0 &&
      delayMs <= MAX_PPTX_TIME &&
      startMs <= MAX_PPTX_TIME &&
      durationMs <= MAX_PPTX_TIME;
    const repeating =
      repeatingParent ||
      repeatsOrReverses(node) ||
      descendants(node, P, "cTn").some(repeatsOrReverses);
    const supported =
      (presetClass === "entr" || !presetClass) &&
      (appear || simpleVisibility) &&
      targetsInScene.length > 0 &&
      targetsInScene.length === sourceTargets.length &&
      !partialTarget &&
      !complexParent &&
      !own.complex &&
      !own.click &&
      !repeating &&
      boundedTiming;
    const sourceTimeId = attr(node, "id");
    const candidate = `${slideId}:build:${sourceTimeId}`;
    const id =
      /^\d{1,20}$/.test(sourceTimeId) && !buildIds.has(candidate)
        ? candidate
        : `${slideId}:build:order:${builds.length}`;
    buildIds.add(id);
    builds.push({
      id,
      targetElementIds: targetsInScene,
      trigger,
      delayMs: boundedTiming ? delayMs : 0,
      durationMs: boundedTiming ? durationMs : 0,
      effect: supported ? "appear" : "fallback",
      group,
      startMs: boundedTiming ? startMs : 0,
      presetId: presetId || undefined,
      presetClass: presetClass || undefined,
    });
    const label = presetId
      ? `PowerPoint effect ${presetClass || "unknown"}/${presetId}`
      : "PowerPoint animation";
    if (!supported)
      report(
        "animation-unsupported",
        repeating
          ? `${label} uses unsupported repeating or reversing timing and is shown without animation.`
          : `${label} is shown without its source animation.`,
        targetsInScene[0],
      );
    else if (!appear)
      report(
        "animation-simplified",
        `${label} uses timed visibility without motion or fades.`,
        targetsInScene[0],
      );
    previousStart = boundedTiming ? startMs : 0;
    previousEnd = boundedTiming ? startMs + durationMs : previousStart;
  };

  const walk = (
    node: XmlElement,
    groupOffset: number | undefined,
    complexParent: boolean,
    groupRoot: boolean,
    repeatingParent: boolean,
  ) => {
    const trigger = triggers.get(attr(node, "nodeType"));
    if (trigger) {
      add(node, trigger, groupOffset, complexParent, repeatingParent);
      return;
    }
    const own = condition(node);
    const children = timeChildren(node);
    if (!children.length && targets(node).length)
      containsUnmodeledTiming = true;
    const offset =
      own.delay === undefined ? groupOffset : (groupOffset ?? 0) + own.delay;
    for (const child of children)
      walk(
        child,
        offset,
        complexParent || own.complex || (own.click && !groupRoot),
        false,
        repeatingParent || repeatsOrReverses(node),
      );
  };

  let repeatingSequence = repeatsOrReverses(main);
  let ancestor = main.parentNode;
  while (ancestor && ancestor !== timing) {
    if (ancestor.nodeType === 1 && repeatsOrReverses(ancestor as XmlElement))
      repeatingSequence = true;
    ancestor = ancestor.parentNode;
  }
  for (const wrapper of timeChildren(main)) {
    const manual =
      condition(wrapper).click ||
      attr(wrapper, "nodeType") === "clickEffect" ||
      descendants(wrapper, P, "cTn").some(
        (node) => attr(node, "nodeType") === "clickEffect",
      );
    if (manual) {
      group++;
      previousStart = 0;
      previousEnd = 0;
    }
    walk(wrapper, undefined, false, true, repeatingSequence);
  }
  if (!builds.length || containsUnmodeledTiming)
    report(
      "animation-unsupported",
      "Some timing nodes have no supported main-sequence visibility behavior.",
    );
  return builds;
}
