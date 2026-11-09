import { object } from "../workspace/contracts.ts";
import { interactiveSourceId } from "./sources.ts";
import type { PredictionRound } from "./prediction.ts";
import { validatePrediction } from "./prediction.ts";
import { safePackagePath } from "./bundle-files.ts";

export type SliderState = { version: 1; value: number };
export type GeoGebraState = { version: 1; sliders: Record<string, number> };
type SharedMaterial = {
  version: 1;
  title: string;
  sourceId: string;
  snapshotId?: string;
  prediction?: PredictionRound;
};
export type InteractiveMaterial = SharedMaterial &
  (
    | { kind: "html"; entry: string; state?: SliderState }
    | { kind: "geogebra"; state?: never }
  );
export type InteractiveProps = {
  w: number;
  h: number;
  material: InteractiveMaterial;
};
export const MAX_INTERACTIVE_OBJECTS = 128;
const finiteParameter = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= 1e12;

export function validateInteractiveMaterial(
  input: unknown,
): InteractiveMaterial {
  if (
    !object(input) ||
    input.version !== 1 ||
    (input.kind !== "html" && input.kind !== "geogebra") ||
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 160 ||
    /[\x00-\x1f\x7f]/.test(input.title) ||
    typeof input.sourceId !== "string" ||
    !interactiveSourceId.test(input.sourceId) ||
    (input.snapshotId !== undefined &&
      (typeof input.snapshotId !== "string" ||
        !interactiveSourceId.test(input.snapshotId))) ||
    Object.keys(input).some(
      (key) =>
        ![
          "version",
          "kind",
          "title",
          "sourceId",
          "snapshotId",
          "state",
          "prediction",
        ].includes(key) && !(key === "entry" && input.kind === "html"),
    )
  )
    throw new Error("Invalid interactive material.");
  if (
    input.kind === "html" &&
    (typeof input.entry !== "string" ||
      !/\.html?$/i.test(safePackagePath(input.entry)))
  )
    throw new Error("Invalid interactive entry path.");
  if (input.state !== undefined) {
    const state = input.state;
    if (
      !object(state) ||
      state.version !== 1 ||
      Object.keys(state).length !== 2 ||
      input.kind !== "html" ||
      !finiteParameter(state.value)
    )
      throw new Error("Invalid interactive runtime state.");
  }
  if (input.prediction !== undefined) validatePrediction(input.prediction);
  return input as InteractiveMaterial;
}
