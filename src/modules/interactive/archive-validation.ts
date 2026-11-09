import type { TLStoreSnapshot } from "tldraw";
import { openHtmlBundle, validHtmlSliderValue } from "./bundle.ts";
import type { HtmlSlider } from "./bundle.ts";
import { inspectGeoGebra } from "./geogebra.ts";
import type { InteractiveSources } from "./sources.ts";
import { WorkspaceError } from "../workspace/contracts.ts";

/** Re-read source formats inside the archive worker before any storage writes. */
export function verifyInteractiveMaterials(
  drawings: readonly TLStoreSnapshot[],
  sources: InteractiveSources,
) {
  const sliders = new Map<string, HtmlSlider | undefined>();
  const geogebra = new Set<string>();
  const start = performance.now();
  for (const drawing of drawings)
    for (const record of Object.values(drawing.store)) {
      if (record.typeName !== "shape" || record.type !== "interactive")
        continue;
      const material = record.props.material;
      const source = sources[material.sourceId];
      if (material.kind === "geogebra") {
        if (!geogebra.has(source.id)) {
          inspectGeoGebra(source.bytes);
          geogebra.add(source.id);
        }
      } else {
        const key = source.id + "/" + material.entry;
        if (!sliders.has(key))
          sliders.set(
            key,
            openHtmlBundle(source.bytes, material.entry).view.slider,
          );
        const slider = sliders.get(key);
        if (
          material.state &&
          (!slider || !validHtmlSliderValue(slider, material.state.value))
        )
          throw new WorkspaceError(
            "integrity",
            "Saved interactive state does not match its source.",
          );
      }
      if (performance.now() - start > 5_000)
        throw new WorkspaceError(
          "limit",
          "Interactive archive inspection timed out. Try a smaller lesson.",
        );
    }
}
