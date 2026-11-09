import { useId } from "react";
import { defaultFigureStyle } from "./descriptor.ts";
import type {
  FigureStyle,
  GraphFigure,
  MathFigure,
  VariationFigure,
} from "./descriptor.ts";
import type { MathValue, VariationAnalysis } from "./variation.ts";

type Frame = { x: number; y: number; width: number; height: number };

export function graphFrame(width: number, height: number): Frame {
  const x = Math.min(54, width * 0.17),
    right = Math.min(24, width * 0.08),
    y = Math.min(26, height * 0.15),
    bottom = Math.min(34, height * 0.18);
  return { x, y, width: width - x - right, height: height - y - bottom };
}

const colors = {
  white: {
    fill: "#ffffff",
    ink: "#182127",
    muted: "#485662",
    line: "#647681",
    grid: "#dbe5ec",
  },
  transparent: {
    fill: "none",
    ink: "#182127",
    muted: "#485662",
    line: "#647681",
    grid: "#a5b4bf",
  },
  dark: {
    fill: "#1b232b",
    ink: "#f4f7fa",
    muted: "#d0dce5",
    line: "#b5c1cb",
    grid: "#455360",
  },
  green: {
    fill: "#193f34",
    ink: "#f4faf6",
    muted: "#d2e9df",
    line: "#b6cec4",
    grid: "#53756b",
  },
} satisfies Record<FigureStyle["background"], Record<string, string>>;

function compact(n: number) {
  return Number(n.toFixed(3));
}

function svgText(value: string) {
  // Browser XML decoders reject C0 controls and unpaired surrogates, even
  // when the SVG text originated in a valid JSON archive.
  return value.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu,
    " ",
  );
}

function figureStroke(style: FigureStyle) {
  return (style.background === "dark" || style.background === "green") &&
    style.stroke.toLowerCase() === defaultFigureStyle.stroke
    ? "#9fcbff"
    : style.stroke;
}

function displaySource(source: string, max: number) {
  const clean = svgText(source)
    .trim()
    .replace(/^y\s*=\s*/i, "")
    .replace(/\s+/g, " ");
  return clean.length > max
    ? clean.slice(0, Math.max(1, max - 1)) + "…"
    : clean;
}

function ticks(min: number, max: number, count: number) {
  const raw = (max - min) / count;
  const base = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((n) => n >= raw / base) ?? 10) * base;
  if (!Number.isFinite(step) || step <= 0) return [];
  const start = Math.ceil(min / step);
  const values: { value: number; label: string }[] = [];
  for (let i = 0; i < 32; i++) {
    const value = (start + i) * step;
    if (value > max) break;
    if (value < min) continue;
    const digits = Math.min(
      16,
      Math.max(
        1,
        Math.ceil(Math.log10(Math.max(Math.abs(value), step) / step)) + 2,
      ),
    );
    const rounded = Number(value.toPrecision(digits)),
      magnitude = Math.abs(rounded);
    const text =
      magnitude >= 1e6 || (magnitude > 0 && magnitude < 1e-4)
        ? rounded.toExponential().replace("e+", "e")
        : String(rounded);
    values.push({ value, label: text.replace(/-/g, "−") });
  }
  return values;
}

function GraphContents({
  figure,
  width,
  height,
}: {
  figure: GraphFigure;
  width: number;
  height: number;
}) {
  const id = useId();
  const frame = graphFrame(width, height),
    x0 = frame.x,
    y0 = frame.y;
  const x1 = x0 + frame.width,
    y1 = y0 + frame.height;
  const { xMin, xMax, yMin, yMax } = figure.viewport;
  const x = (value: number) =>
    x0 + ((value - xMin) / (xMax - xMin)) * frame.width;
  const y = (value: number) =>
    y0 + ((yMax - value) / (yMax - yMin)) * frame.height;
  const { strokeWidth, grid, axes, tickDensity, background } = figure.style;
  const stroke = figureStroke(figure.style);
  const theme = colors[background],
    density = tickDensity === "high" ? 1.5 : tickDensity === "low" ? 0.7 : 1;
  const extremeOffset =
    Math.max(Math.abs(xMin), Math.abs(xMax)) > 1e6 * (xMax - xMin);
  const xs = ticks(
    xMin,
    xMax,
    Math.min(
      16,
      Math.max(
        2,
        Math.floor((density * frame.width) / (extremeOffset ? 125 : 72)),
      ),
    ),
  );
  const ys = ticks(
    yMin,
    yMax,
    Math.min(16, Math.max(2, Math.floor((density * frame.height) / 46))),
  );
  const yAxis = xMin <= 0 && xMax >= 0 ? x(0) : null;
  const xAxis = yMin <= 0 && yMax >= 0 ? y(0) : null;
  const font = Math.min(13, width * 0.026, height * 0.067);
  const strokePath = figure.data.segments
    .map((segment) =>
      segment
        .map(
          (point, i) =>
            `${i ? "L" : "M"}${compact(x(point.x))},${compact(y(point.y))}`,
        )
        .join(""),
    )
    .join("");
  return (
    <>
      <defs>
        <clipPath id={id}>
          <rect x={x0} y={y0} width={frame.width} height={frame.height} />
        </clipPath>
      </defs>
      <text
        x={x0}
        y={y0 * 0.7}
        fill={theme.ink}
        fontSize={font * 1.13}
        fontWeight="600"
      >
        y ={" "}
        {displaySource(
          figure.expression.source,
          Math.max(9, Math.floor(frame.width / Math.max(1, font * 0.68))),
        )}
      </text>
      <rect
        x={x0}
        y={y0}
        width={frame.width}
        height={frame.height}
        fill="none"
        stroke={theme.line}
        strokeWidth="0.75"
      />
      {grid && (
        <g stroke={theme.grid} strokeWidth="0.7" clipPath={`url(#${id})`}>
          {xs.map(({ value }) => (
            <line key={value} x1={x(value)} x2={x(value)} y1={y0} y2={y1} />
          ))}
          {ys.map(({ value }) => (
            <line key={value} x1={x0} x2={x1} y1={y(value)} y2={y(value)} />
          ))}
        </g>
      )}
      {axes && (
        <g fill={theme.muted} fontSize={font}>
          {xAxis !== null && (
            <line
              x1={x0}
              x2={x1}
              y1={xAxis}
              y2={xAxis}
              stroke={theme.line}
              strokeWidth="1.1"
            />
          )}
          {yAxis !== null && (
            <line
              x1={yAxis}
              x2={yAxis}
              y1={y0}
              y2={y1}
              stroke={theme.line}
              strokeWidth="1.1"
            />
          )}
          {xs.map(({ value, label }) => (
            <g key={value}>
              <line
                x1={x(value)}
                x2={x(value)}
                y1={y1}
                y2={y1 + 4}
                stroke={theme.line}
              />
              <text
                x={x(value)}
                y={y1 + font + 5}
                textAnchor={x(value) > x1 - font * 1.4 ? "end" : "middle"}
              >
                {label}
              </text>
            </g>
          ))}
          {ys.map(({ value, label }) => (
            <g key={value}>
              <line
                x1={x0 - 4}
                x2={x0}
                y1={y(value)}
                y2={y(value)}
                stroke={theme.line}
              />
              <text
                x={x0 - 7}
                y={y(value) + font * 0.32}
                textAnchor="end"
                fontSize={Math.min(
                  font,
                  Math.max(2, (x0 - 9) / (label.length * 0.59)),
                )}
              >
                {label}
              </text>
            </g>
          ))}
          <text
            x={x1 + Math.min(font * 0.35, (width - x1) * 0.22)}
            y={(xAxis ?? y1) - 5}
            fontWeight="700"
          >
            x
          </text>
          <text x={(yAxis ?? x0) + 5} y={y0 + font + 1} fontWeight="700">
            y
          </text>
          {xAxis !== null &&
            yAxis !== null &&
            yAxis > x0 + font &&
            xAxis < y1 - font && (
              <text x={yAxis - 5} y={xAxis + font + 2} textAnchor="end">
                O
              </text>
            )}
        </g>
      )}
      <g clipPath={`url(#${id})`}>
        <path
          data-math-curve=""
          d={strokePath}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {figure.data.holes.map((point, i) => (
          <circle
            key={i}
            data-math-hole=""
            cx={x(point.x)}
            cy={y(point.y)}
            r={Math.max(3, strokeWidth * 1.7)}
            fill={theme.fill === "none" ? "#ffffff" : theme.fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        ))}
      </g>
    </>
  );
}

const tableHeight = 286;
function label(value: MathValue | undefined) {
  return value
    ? svgText(
        value.exact || value.label.startsWith("≈")
          ? value.label
          : `≈ ${value.label}`,
      )
    : "";
}

function analysisText(data: VariationAnalysis) {
  return (
    `Domain ${data.domain}. First derivative ${data.derivative}. ` +
    data.intervals
      .map(
        (part) =>
          `${part.trend} from ${label(part.left)} to ${label(part.right)}.`,
      )
      .join(" ") +
    " " +
    data.points
      .map(
        (point) =>
          `At x = ${label(point.x)}: ${point.kind}${point.extremum === "none" ? "" : `, local ${point.extremum}`}` +
          `${point.value ? `, f(x) = ${label(point.value)}` : ""}${point.leftLimit ? `, left limit ${label(point.leftLimit)}` : ""}` +
          `${point.rightLimit ? `, right limit ${label(point.rightLimit)}` : ""}.`,
      )
      .join(" ")
  );
}

function Arrow({
  x1,
  y1,
  x2,
  y2,
  stroke,
  thickness,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  thickness: number;
}) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const wing = (side: number) => [
    x2 - 12 * Math.cos(angle + side * 0.55),
    y2 - 12 * Math.sin(angle + side * 0.55),
  ];
  const [a, b] = wing(-1),
    [c, d] = wing(1);
  return (
    <path
      d={`M${x1},${y1} L${x2},${y2} M${a},${b} L${x2},${y2} L${c},${d}`}
      fill="none"
      stroke={stroke}
      strokeWidth={thickness}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function VariationContents({
  figure,
  width,
  height,
}: {
  figure: VariationFigure;
  width: number;
  height: number;
}) {
  const { data, style } = figure,
    theme = colors[style.background];
  const n = data.intervals.length;
  const boundaries = [
    data.intervals[0].left,
    ...data.intervals.map((part) => part.right),
  ];
  const events = boundaries.map((x) =>
    x.value === null
      ? undefined
      : data.points.find((p) => p.x.value === x.value),
  );
  const tableLeft = 10,
    labelRight = 92,
    gap = 12;
  const leftValue = (i: number) =>
    i === 0 ? data.leftLimit : (events[i]?.value ?? events[i]?.rightLimit);
  const rightValue = (i: number) =>
    i === n ? data.rightLimit : (events[i]?.value ?? events[i]?.leftLimit);
  const estimate = (text: string) => text.length * 9;
  const extents = boundaries.map((x, i) => {
    const xLabel = estimate(label(x)) / 2;
    const split = events[i]?.kind === "excluded" && i > 0 && i < n;
    const left =
      estimate(label(i === 0 ? leftValue(i) : rightValue(i))) *
      (split ? 1 : 0.5);
    const right =
      estimate(label(i === n ? rightValue(i) : leftValue(i))) *
      (split ? 1 : 0.5);
    return { left: Math.max(xLabel, left), right: Math.max(xLabel, right) };
  });
  const xPositions = [labelRight + Math.max(72, extents[0].left + 20)];
  for (let i = 0; i < n; i++) {
    const gapSize = Math.max(125, extents[i].right + extents[i + 1].left + 44);
    xPositions.push(xPositions.at(-1)! + gapSize);
  }
  const tableRight = xPositions[n] + Math.max(72, extents[n].right + 20),
    logicalWidth = tableRight + 10;
  const scale = Math.min(width / logicalWidth, height / tableHeight);
  const numericValue = (value: MathValue | undefined) =>
    value?.value ??
    (value?.label.startsWith("−") || value?.label.startsWith("-")
      ? -Infinity
      : Infinity);
  const values = [
    ...new Set(
      data.intervals.flatMap((_, i) => [
        numericValue(leftValue(i)),
        numericValue(rightValue(i + 1)),
      ]),
    ),
  ].sort((a, b) => a - b);
  const level = (value: MathValue | undefined) =>
    values.length === 1
      ? 207
      : 242 - (values.indexOf(numericValue(value)) / (values.length - 1)) * 85;
  const levels = data.intervals.map((part, i) => {
    let start = level(leftValue(i)),
      end = level(rightValue(i + 1));
    // Approximate coordinates can round distinct exact values together. The
    // proven derivative sign still determines the arrow direction.
    if (start === end && part.sign !== 0) {
      start += part.sign * 12;
      end -= part.sign * 12;
    }
    return { start, end };
  });
  return (
    <g
      transform={`translate(${(width - logicalWidth * scale) / 2} ${(height - tableHeight * scale) / 2}) scale(${scale})`}
    >
      <text
        x={tableLeft}
        y="23"
        fill={theme.ink}
        fontSize="17"
        fontWeight="600"
      >
        f(x) ={" "}
        {displaySource(
          figure.expression.source,
          Math.max(15, Math.floor(logicalWidth / 9) - 9),
        )}
      </text>
      <g fill="none" stroke={theme.line}>
        <rect
          x={tableLeft}
          y="38"
          width={tableRight - tableLeft}
          height="238"
        />
        <path
          d={`M${labelRight},38V276 M${tableLeft},88H${tableRight} M${tableLeft},135H${tableRight}`}
        />
        {events.map(
          (event, i) =>
            event?.kind === "excluded" && (
              <path
                key={i}
                data-math-separator=""
                d={`M${xPositions[i] - 2},89V276 M${xPositions[i] + 2},89V276`}
              />
            ),
        )}
      </g>
      <g fill={theme.ink} fontSize="17" fontWeight="600" textAnchor="middle">
        <text x="51" y="68">
          x
        </text>
        <text x="51" y="117">
          f′(x)
        </text>
        <text x="51" y="209">
          f(x)
        </text>
      </g>
      <g fill={theme.ink} fontSize="15" textAnchor="middle">
        {boundaries.map((value, i) => (
          <text key={i} x={xPositions[i]} y="68">
            {label(value)}
          </text>
        ))}
        {events.map(
          (event, i) =>
            event &&
            event.kind !== "excluded" && (
              <text key={i} x={xPositions[i]} y="117">
                {event.derivativeZero
                  ? "0"
                  : event.derivativeUndefined
                    ? "∄"
                    : ""}
              </text>
            ),
        )}
        {data.intervals.map((part, i) => (
          <text key={i} x={(xPositions[i] + xPositions[i + 1]) / 2} y="117">
            {part.sign === 1 ? "+" : part.sign === -1 ? "−" : "0"}
          </text>
        ))}
      </g>
      <g fill={theme.ink} fontSize="15">
        {data.intervals.map((_, i) => {
          const { start, end } = levels[i];
          const x1 = xPositions[i],
            x2 = xPositions[i + 1];
          const leftSeparate = events[i]?.kind === "excluded",
            rightSeparate = events[i + 1]?.kind === "excluded";
          const a = label(leftValue(i)),
            b = label(rightValue(i + 1));
          return (
            <g key={i}>
              <Arrow
                x1={x1 + gap}
                y1={start}
                x2={x2 - gap}
                y2={end}
                stroke={figureStroke(style)}
                thickness={style.strokeWidth}
              />
              {(i === 0 || leftSeparate) && (
                <text
                  x={x1 + (leftSeparate ? 7 : 0)}
                  y={start - 9}
                  textAnchor={leftSeparate ? "start" : "middle"}
                >
                  {a}
                </text>
              )}
              <text
                x={x2 - (rightSeparate ? 7 : 0)}
                y={end - 9}
                textAnchor={rightSeparate ? "end" : "middle"}
              >
                {b}
              </text>
            </g>
          );
        })}
      </g>
    </g>
  );
}

/** One SVG renderer for preview, native objects and detached export. */
export function FigureSvg({
  figure,
  width,
  height,
}: {
  figure: MathFigure;
  width: number;
  height: number;
}) {
  const source = svgText(figure.expression.source);
  const description =
    figure.kind === "variation"
      ? analysisText(figure.data)
      : `Graph window x ${figure.viewport.xMin} to ${figure.viewport.xMax}, y ${figure.viewport.yMin} to ${figure.viewport.yMax}. ${figure.data.segments.length} visible segments.`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${figure.kind === "graph" ? "Function graph" : "Variation table"}: ${source}`}
      data-math-figure={figure.kind}
      fontFamily="Arial, sans-serif"
    >
      <title>{source}</title>
      <desc>{svgText(description)}</desc>
      <rect
        width={width}
        height={height}
        fill={colors[figure.style.background].fill}
      />
      {figure.kind === "graph" ? (
        <GraphContents figure={figure} width={width} height={height} />
      ) : (
        <VariationContents figure={figure} width={width} height={height} />
      )}
    </svg>
  );
}

/** Standalone clean PNG. SVG controls and the board's SDK UI stay outside it. */
export async function mathFigurePng({
  figure,
  width,
  height,
  scale = 2,
  background,
  signal,
}: {
  figure: MathFigure;
  width: number;
  height: number;
  scale?: number;
  background?: "white" | "transparent";
  signal?: AbortSignal;
}): Promise<Blob> {
  const pixelWidth = Math.ceil(width * scale),
    pixelHeight = Math.ceil(height * scale);
  if (
    ![width, height, scale].every((n) => Number.isFinite(n) && n > 0) ||
    pixelWidth > 4096 ||
    pixelHeight > 4096 ||
    pixelWidth * pixelHeight > 16_000_000
  )
    throw new Error("Choose a smaller image or export scale.");
  signal?.throwIfAborted();
  const { renderToStaticMarkup } = await import("react-dom/server");
  const value = background
    ? { ...figure, style: { ...figure.style, background } }
    : figure;
  const svg = renderToStaticMarkup(
    <FigureSvg figure={value} width={width} height={height} />,
  );
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  const image = new Image();
  const canvas = document.createElement("canvas");
  try {
    image.src = url;
    await image.decode();
    signal?.throwIfAborted();
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The browser could not create the export image.");
    ctx.drawImage(image, 0, 0, pixelWidth, pixelHeight);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(
                new Error("The browser could not encode the export image."),
              ),
        "image/png",
      ),
    );
    signal?.throwIfAborted();
    return blob;
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
