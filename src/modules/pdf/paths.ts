import { SVGPathData } from "svg-pathdata";
/** Preserve geometry while avoiding the writer's SVG shorthand quadratic bug. */
export function normalizedPath(value: string): string {
  if (value.length > 8_000_000)
    throw new Error("Vector path exceeds export limits.");
  return new SVGPathData(value).toAbs().normalizeST().qtToC().aToC().encode();
}
