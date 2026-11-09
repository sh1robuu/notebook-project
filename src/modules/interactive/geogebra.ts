import { elements, parseXml } from "../documents/package.ts";
import type { XmlElement } from "../documents/package.ts";
import { unpackInteractiveZip } from "./bundle-files.ts";

export type GeoGebraSlider = { label: string; min: number; max: number };
export type GeoGebraInspection = {
  version: string | null;
  app: string;
  title: string | null;
  sliders: GeoGebraSlider[];
  entries: string[];
  diagnostics: string[];
  runtimeSupported: false;
};

export const MAX_GEOGEBRA_BYTES = 8_000_000;
const archiveLimits = {
  label: "GeoGebra",
  maxPackageBytes: MAX_GEOGEBRA_BYTES,
  maxExpandedBytes: 16_000_000,
  maxEntries: 128,
  maxPartBytes: MAX_GEOGEBRA_BYTES,
};
const MAX_XML_BYTES = 1_000_000;
const MAX_SLIDERS = 32;
const MAX_NODES = 10_000;
const decoder = new TextDecoder("utf-8", { fatal: true });
const simpleLabel = /^[\p{L}][\p{L}\p{N}_]{0,39}$/u;
const safeLabel = (label: string) =>
  simpleLabel.test(label) && !["constructor", "prototype"].includes(label);
const finiteBound = (input: string) => {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/.test(input)) return null;
  const value = Number(input);
  return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : null;
};
const displayText = (value: string | null) =>
  value
    ?.trim()
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+/g, " ")
    .slice(0, 160) || null;

function sliderMetadata(construction: XmlElement, diagnostics: Set<string>) {
  const sliders: GeoGebraSlider[] = [];
  const labels = new Set<string>();
  for (const element of elements(construction)) {
    if (
      element.tagName !== "element" ||
      element.getAttribute("type") !== "numeric"
    )
      continue;
    const slider = elements(element).find(
      (child) => child.tagName === "slider",
    );
    if (!slider) continue;
    const label = element.getAttribute("label") ?? "";
    const min = finiteBound(slider.getAttribute("min") ?? "");
    const max = finiteBound(slider.getAttribute("max") ?? "");
    if (
      sliders.length === MAX_SLIDERS ||
      !safeLabel(label) ||
      labels.has(label) ||
      min === null ||
      max === null ||
      min >= max
    ) {
      diagnostics.add("Tệp có thanh trượt ngoài giới hạn đọc của Lessonboard.");
      continue;
    }
    labels.add(label);
    sliders.push({ label, min, max });
  }
  return sliders;
}

/** Inspect local metadata. Construction XML and companion files stay inert. */
export function inspectGeoGebra(bytes: Uint8Array): GeoGebraInspection {
  const { files } = unpackInteractiveZip(bytes, archiveLimits);
  const source = files.get("geogebra.xml");
  if (!source?.length || source.length > MAX_XML_BYTES)
    throw new Error("Tệp .ggb thiếu geogebra.xml hoặc phần dựng hình quá lớn.");
  const xml = decoder.decode(source);
  // No parser directives beyond a standard XML declaration, including stylesheets.
  if (/<\?/.test(xml.replace(/^\s*<\?xml\s+[^?]*\?>/, "")))
    throw new Error("Tệp .ggb chứa chỉ thị XML không được hỗ trợ.");
  const document = parseXml(xml);
  const root = document.documentElement;
  if (!root || root.tagName !== "geogebra" || root.namespaceURI)
    throw new Error("Tệp .ggb không có cấu trúc GeoGebra hợp lệ.");
  const constructions = elements(root).filter(
    (node) => node.tagName === "construction",
  );
  if (constructions.length !== 1)
    throw new Error("Tệp .ggb phải có đúng một phần dựng hình.");

  const diagnostics = new Set<string>();
  const entries = [...files.keys()].sort();
  for (const path of entries) {
    if (path === "geogebra.xml" || path === "geogebra_thumbnail.png") continue;
    if (/\.js$/i.test(path))
      diagnostics.add("Tệp chứa mã JavaScript của GeoGebra.");
    else if (/macro/i.test(path))
      diagnostics.add("Tệp chứa macro hoặc công cụ tùy chỉnh của GeoGebra.");
    else diagnostics.add("Tệp chứa tài nguyên đính kèm ngoài phạm vi hỗ trợ.");
  }
  const app =
    displayText(root.getAttribute("subApp") || root.getAttribute("app")) ||
    "classic";
  if (!["classic", "geometry", "graphing"].includes(app))
    diagnostics.add(
      "Tệp dùng chế độ dựng hình ngoài Classic, Geometry và Graphing 2D.",
    );

  const pending = [root];
  let nodes = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++nodes > MAX_NODES)
      throw new Error("Tệp .ggb có quá nhiều phần tử dựng hình.");
    if (
      /^(?:javascript|ggbscript)$/i.test(node.tagName) ||
      (node.tagName === "command" &&
        /^(?:Execute|OpenURL|RunClickScript|RunUpdateScript)$/i.test(
          node.getAttribute("name") ?? "",
        ))
    )
      diagnostics.add("Bản dựng hình có mã lệnh GeoGebra.");
    if (/^(?:embed|file|video|audio)$/i.test(node.tagName))
      diagnostics.add("Bản dựng hình có tài nguyên nhúng.");
    for (let index = 0; index < node.attributes.length; index++) {
      const attr = node.attributes.item(index)!;
      if (
        root === node &&
        /^(?:xmlns(?::xsi)?|xsi:noNamespaceSchemaLocation)$/.test(attr.name)
      )
        continue;
      if (
        /^(?:on\w+|script|src|href|url|file|code|link)$/i.test(
          attr.localName ?? attr.name,
        ) ||
        /(?:https?:|ftp:|javascript:|data:|blob:|file:|\/\/)/i.test(attr.value)
      )
        diagnostics.add("Bản dựng hình có đường dẫn hoặc nội dung nhúng.");
    }
    pending.push(...elements(node));
  }
  const sliders = sliderMetadata(constructions[0], diagnostics);
  return {
    version: displayText(root.getAttribute("version")),
    app,
    title: displayText(constructions[0].getAttribute("title")),
    sliders,
    entries,
    diagnostics: [...diagnostics],
    runtimeSupported: false,
  };
}
