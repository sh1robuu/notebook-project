import {
  packOriginalFiles,
  safePackagePath,
  unpackHtmlZip,
} from "./bundle-files.ts";
import type { InteractiveInputFile } from "./bundle-files.ts";
import { compileHtml, compilePreview } from "./html-view.ts";
import type { HtmlDiagnostic } from "./html-view.ts";

export type { InteractiveInputFile, HtmlDiagnostic };

export type HtmlSlider = {
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
  outputLabel: string;
  multiplier: number;
  offset: number;
  unit: string;
};

export type HtmlBundleSummary = {
  entry: string;
  files: { path: string; byteLength: number }[];
  expandedBytes: number;
  diagnostics: HtmlDiagnostic[];
  hasSlider: boolean;
  hasPreview: boolean;
};
export type HtmlBundleView = {
  srcDoc: string;
  slider?: HtmlSlider;
  previewDataUrl?: string;
};
export type OpenedHtmlBundle = {
  summary: HtmlBundleSummary;
  view: HtmlBundleView;
};
export type InspectedHtmlBundle = OpenedHtmlBundle & { bytes: Uint8Array };

const decoder = new TextDecoder("utf-8", { fatal: true });
const htmlName = /\.html?$/i;
const sidecar = "lessonboard-simulation.json";
const sliderNames = [
  "label",
  "min",
  "max",
  "step",
  "initial",
  "outputLabel",
  "multiplier",
  "offset",
  "unit",
] as const;

export function validHtmlSliderValue(slider: HtmlSlider, value: number) {
  const { min, max, step } = slider;
  if (!Number.isFinite(value) || value < min || value > max) return false;
  const ticks = (value - min) / step;
  return Math.abs(ticks - Math.round(ticks)) <= 1e-8;
}

function parseSlider(bytes: Uint8Array): HtmlSlider {
  const invalid = () =>
    new Error("Invalid simulation slider configuration in " + sidecar + ".");
  if (bytes.length > 4_000) throw invalid();
  let json: unknown;
  try {
    json = JSON.parse(decoder.decode(bytes));
  } catch {
    throw invalid();
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw invalid();
  const root = json as Record<string, unknown>;
  if (
    Object.keys(root).length !== 2 ||
    root.version !== 1 ||
    !root.slider ||
    typeof root.slider !== "object" ||
    Array.isArray(root.slider)
  )
    throw invalid();
  const raw = root.slider as Record<string, unknown>;
  if (
    Object.keys(raw).length !== sliderNames.length ||
    sliderNames.some((key) => !Object.hasOwn(raw, key))
  )
    throw invalid();
  for (const key of ["label", "outputLabel", "unit"] as const) {
    const value = raw[key];
    if (
      typeof value !== "string" ||
      value.length > 80 ||
      (key !== "unit" && !value.trim()) ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw invalid();
  }
  for (const key of [
    "min",
    "max",
    "step",
    "initial",
    "multiplier",
    "offset",
  ] as const) {
    const value = raw[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      Math.abs(value) > 1_000_000
    )
      throw invalid();
  }
  const slider = raw as HtmlSlider;
  const ticks = (slider.max - slider.min) / slider.step;
  if (
    slider.step < 0.000001 ||
    slider.max <= slider.min ||
    ticks > 10_000 ||
    !validHtmlSliderValue(slider, slider.initial) ||
    !validHtmlSliderValue(slider, slider.max)
  )
    throw invalid();
  return slider;
}

function chooseEntry(
  files: ReadonlyMap<string, Uint8Array>,
  requested?: string,
) {
  if (requested !== undefined) {
    const path = safePackagePath(requested);
    if (htmlName.test(path) && files.has(path)) return path;
    throw new Error("The selected HTML entry is missing from the package.");
  }
  const candidates = [...files.keys()].filter((path) => htmlName.test(path));
  const conventional = candidates.filter((path) =>
    /(?:^|\/)index\.html?$/i.test(path),
  );
  if (conventional.includes("index.html")) return "index.html";
  if (conventional.length === 1) return conventional[0];
  if (candidates.length === 1) return candidates[0];
  throw new Error(
    candidates.length
      ? "The package has more than one possible HTML entry. Keep a single index.html or choose an entry."
      : "The package has no HTML entry.",
  );
}

export function openHtmlBundle(
  bytes: Uint8Array,
  requested?: string,
): OpenedHtmlBundle {
  const { files, expandedBytes } = unpackHtmlZip(bytes);
  const entry = chooseEntry(files, requested);
  const diagnostics: HtmlDiagnostic[] = [];
  const seen = new Set<string>();
  function diagnose(code: HtmlDiagnostic["code"], raw: string) {
    const message = raw.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 320);
    const key = code + ":" + message;
    if (seen.has(key)) return;
    if (diagnostics.length === 79) {
      diagnostics.push({
        code: "unsupported",
        message: "Additional package diagnostics were omitted.",
      });
    } else if (diagnostics.length < 79) {
      seen.add(key);
      diagnostics.push({ code, message });
    }
  }
  const srcDoc = compileHtml(files, entry, diagnose);
  const folder = entry.slice(0, entry.lastIndexOf("/") + 1);
  const sliderSource = files.get(folder + sidecar);
  const slider = sliderSource && parseSlider(sliderSource);
  const preview = ["preview.png", "preview.jpg", "preview.jpeg"].find((name) =>
    files.has(folder + name),
  );
  let previewDataUrl: string | undefined;
  if (preview) {
    try {
      previewDataUrl = compilePreview(files.get(folder + preview)!);
    } catch (error) {
      diagnose(
        "unsupported",
        "Invalid static preview: " +
          (error instanceof Error ? error.message : "Unable to read image."),
      );
    }
  }
  return {
    summary: {
      entry,
      files: [...files].map(([path, data]) => ({
        path,
        byteLength: data.byteLength,
      })),
      expandedBytes,
      diagnostics,
      hasSlider: !!slider,
      hasPreview: !!previewDataUrl,
    },
    view: { srcDoc, slider, previewDataUrl },
  };
}

export function inspectHtmlBundle(
  files: readonly InteractiveInputFile[],
  entry?: string,
): InspectedHtmlBundle {
  const archives = files.filter((file) => /\.zip$/i.test(file.path));
  if (archives.length && (archives.length !== 1 || files.length !== 1))
    throw new Error("Choose one ZIP package or a set of HTML companion files.");
  if (archives.length) safePackagePath(archives[0].path);
  const bytes = archives.length ? archives[0].bytes : packOriginalFiles(files);
  return { bytes, ...openHtmlBundle(bytes, entry) };
}
