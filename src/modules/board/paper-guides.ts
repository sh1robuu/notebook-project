import type { Paper } from "../workspace/lesson-view.ts";

const colors = {
  white: { line: "#c3d9ef", margin: "#e7acba", title: "#80abda" },
  dark: { line: "#485b6b", margin: "#885667", title: "#7192a9" },
  green: { line: "#42756b", margin: "#98717b", title: "#78a89b" },
};

/** A single repeated SVG tile in page coordinates, shared by canvas and thumbnails. */
export function paperGuideSvg(paper: Paper) {
  if (paper.kind !== "blank" || !paper.pattern) return undefined;
  const ink = colors[paper.color];
  const step = paper.pattern === "ruled" ? 28 : 24;
  const margin = Math.min(58, paper.width * 0.14);
  const top = Math.min(18, paper.height * 0.08);
  const headerHeight = Math.min(58, paper.height * 0.44);
  const ruledStart = paper.titleGuide ? top + headerHeight + 15 : 0;
  const tile =
    paper.pattern === "dotted"
      ? `<circle cx="12" cy="12" r="1.2" fill="${ink.line}"/>`
      : `<path d="M0 .5H${step}${paper.pattern === "grid" ? `M.5 0V${step}` : ""}" fill="none" stroke="${ink.line}"/>`;
  const ruling = `<defs><pattern id="lessonboard-paper-guide" width="${step}" height="${step}" y="${ruledStart}" patternUnits="userSpaceOnUse">${tile}</pattern></defs><rect y="${ruledStart}" width="${paper.width}" height="${Math.max(0, paper.height - ruledStart)}" fill="url(#lessonboard-paper-guide)"/>`;
  const gutter =
    paper.pattern === "ruled"
      ? `<path d="M${margin} 0V${paper.height}" fill="none" stroke="${ink.margin}"/>`
      : "";
  const title = paper.titleGuide
    ? `<rect x="${margin}" y="${top}" width="${paper.width - margin * 2}" height="${headerHeight}" fill="none" stroke="${ink.title}" stroke-width="1.25" stroke-dasharray="7 5"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${paper.width} ${paper.height}">${ruling}${gutter}${title}</svg>`;
}
