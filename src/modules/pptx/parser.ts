import {
  attribute,
  readOoxmlPackage,
  R,
  type OoxmlRelationship,
  type XmlElement,
} from "../documents/package.ts";
import { documentDigest } from "../documents/sources.ts";
import {
  MAX_IMAGE_ASSETS,
  MAX_TOTAL_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_PIXELS,
  readImageHeader,
} from "../media/image-format.ts";
import {
  MAX_PPTX_DIAGNOSTICS,
  MAX_PPTX_SLIDES,
  MAX_SOURCE_SLIDE_ID,
  MIN_SOURCE_SLIDE_ID,
  PPTX_MIME,
  validateSlideDocument,
  type PptxImportResult,
  type PptxSource,
  type PptxSources,
  type Slide,
  type SlideDiagnostic,
  type SlideDocument,
} from "./model.ts";
import { readSlideScene, type SceneBudget } from "./scene.ts";
import { parseSlideBuilds } from "./timing.ts";
import { A, attr, boundedText, off, p, P, ps, px } from "./xml.ts";

const officeRelationship = (type: string) => `${R}/${type}`;

function sourceName(name: string) {
  return name.replace(/[\u0000-\u001f]/g, "").slice(0, 180);
}

async function sourceAsset(
  bytes: Uint8Array,
  name: string,
  mime: string,
): Promise<PptxSource> {
  const sha256 = await documentDigest(bytes);
  return {
    sourceVersion: 1,
    id: `${mime === PPTX_MIME ? "pptx" : "pptx-image"}:${sha256}`,
    sha256,
    name: sourceName(name),
    mime,
    size: bytes.length,
    bytes,
  };
}

export async function parsePptx(
  bytes: Uint8Array,
  fileName: string,
  progress: (message: string) => void = () => {},
): Promise<PptxImportResult> {
  progress("Checking PowerPoint ZIP and relationships…");
  const pkg = readOoxmlPackage(bytes, "pptx");
  const relationships = new Map<string, OoxmlRelationship[]>();
  const rels = (part: string) => {
    const cached = relationships.get(part);
    if (cached) return cached;
    const list = pkg.relationships(part);
    relationships.set(part, list);
    return list;
  };
  // Validate even unreachable relationship paths, without following external links.
  for (const name of Object.keys(pkg.files)) {
    if (!/\.rels$/i.test(name) || name === "_rels/.rels") continue;
    const path = /^(?:(.*)\/)?_rels\/([^/]+)\.rels$/.exec(name);
    if (!path) throw new Error("Invalid PowerPoint relationship part path.");
    rels(path[1] ? `${path[1]}/${path[2]}` : path[2]);
  }
  const relationship = (part: string, type: string) => {
    const matches = rels(part).filter(
      (entry) => entry.type === officeRelationship(type),
    );
    if (matches.length > 1)
      throw new Error(`Ambiguous PowerPoint ${type} relationship.`);
    return matches[0];
  };
  const rootElement = (part: string, ns: string, name: string): XmlElement => {
    const root = pkg.xml(part).documentElement;
    if (!root || root.namespaceURI !== ns || root.localName !== name)
      throw new Error(
        `Invalid PowerPoint ${name} XML or unsupported Strict OOXML namespace.`,
      );
    return root;
  };
  const main = relationship("", "officeDocument");
  if (!main || main.external)
    throw new Error("PowerPoint ZIP has no local presentation entry.");
  const presentation = rootElement(main.target, P, "presentation");
  const size = p(presentation, "sldSz");
  const width = px(attr(size, "cx"));
  const height = px(attr(size, "cy"));
  if (width < 1 || height < 1 || width > 8_192 || height > 8_192)
    throw new Error(
      "PowerPoint slide dimensions must be between 1 and 8192 CSS pixels.",
    );
  const entries = ps(p(presentation, "sldIdLst"), "sldId");
  if (!entries.length || entries.length > MAX_PPTX_SLIDES)
    throw new Error(
      `PowerPoint requires 1 to ${MAX_PPTX_SLIDES} ordered slides.`,
    );

  const original = await sourceAsset(bytes, fileName, PPTX_MIME);
  const sources: PptxSources = { [original.id]: original };
  const diagnostics: SlideDiagnostic[] = [];
  const report = (diagnostic: SlideDiagnostic) => {
    if (diagnostics.length < MAX_PPTX_DIAGNOSTICS - 1)
      diagnostics.push(diagnostic);
    else if (diagnostics.length < MAX_PPTX_DIAGNOSTICS)
      diagnostics.push({
        code: "diagnostic-limit",
        message:
          "Additional unsupported content was found beyond the diagnostic limit.",
      });
  };
  if (p(presentation, "embeddedFontLst"))
    report({
      code: "embedded-fonts",
      message:
        "Embedded fonts are preserved in the original PPTX. Slides use installed browser fonts or their fallbacks.",
    });
  if (p(presentation, "custShowLst"))
    report({
      code: "custom-show",
      message:
        "PowerPoint custom shows are not loaded. Slides follow the primary presentation order.",
    });

  const budget: SceneBudget = { elements: 0, text: 0, cells: 0 };
  const assetsByPart = new Map<string, string>();
  let imageCount = 0;
  let imageBytes = 0;
  let imagePixels = 0;
  const slides: Slide[] = [];
  const ids = new Set<string>();
  const parts = new Set<string>();
  for (const entry of entries) {
    const rawId = attr(entry, "id");
    const numericId = Number(rawId);
    const sourceId = String(numericId);
    if (
      !/^\d{1,20}$/.test(rawId) ||
      numericId < MIN_SOURCE_SLIDE_ID ||
      numericId > MAX_SOURCE_SLIDE_ID ||
      ids.has(sourceId)
    )
      throw new Error("Invalid or duplicate PowerPoint slide ID.");
    ids.add(sourceId);
    const id = `slide:${sourceId}`;
    const warn = (code: string, message: string, elementId?: string) =>
      report({ code, message, slideId: id, elementId });
    const link = rels(main.target).find(
      (item) => item.id === attribute(entry, R, "id"),
    );
    if (
      !link ||
      link.external ||
      link.type !== officeRelationship("slide") ||
      parts.has(link.target)
    )
      throw new Error(
        "Missing, external or duplicate PowerPoint slide relationship.",
      );
    const sourcePart = link.target;
    parts.add(sourcePart);
    const root = rootElement(sourcePart, P, "sld");
    const layer = (owner: string, type: string, ns: string, name: string) => {
      const ref = relationship(owner, type);
      if (!ref) return undefined;
      if (ref.external || !Object.hasOwn(pkg.files, ref.target)) {
        warn(
          "missing-relationship",
          `A PowerPoint ${type} could not be loaded as a local part.`,
        );
        return undefined;
      }
      return { part: ref.target, root: rootElement(ref.target, ns, name) };
    };
    const layout = layer(sourcePart, "slideLayout", P, "sldLayout");
    const master = layout && layer(layout.part, "slideMaster", P, "sldMaster");
    const theme =
      (master && layer(master.part, "theme", A, "theme")) ??
      (layout && layer(layout.part, "theme", A, "theme"));
    const notes = relationship(sourcePart, "notesSlide");
    if (notes?.external || (notes && !Object.hasOwn(pkg.files, notes.target)))
      warn("notes", "Slide notes were unavailable as a local source part.");
    if (p(root, "transition"))
      warn(
        "slide-transition",
        "PowerPoint transition effects and automatic slide advance are not applied.",
      );
    if (rels(sourcePart).some((entry) => entry.external))
      warn(
        "external-resource",
        "External relationships are isolated. Linked resources and actions are not loaded.",
      );
    if (
      rels(sourcePart).some((entry) =>
        /\/(?:audio|video|media)$/i.test(entry.type),
      )
    )
      warn(
        "media",
        "Audio and video playback are unsupported. Local poster pictures may be displayed.",
      );

    const position = slides.length + 1;
    if (position === 1 || position === entries.length || position % 5 === 0)
      progress(`Reading slide ${position} of ${entries.length}…`);
    const scene = await readSlideScene({
      slideId: id,
      slide: { part: sourcePart, root },
      layout,
      master,
      theme: theme?.root,
      defaultTextStyle: p(presentation, "defaultTextStyle"),
      budget,
      report: warn,
      async image(part, relationId, linked) {
        const relation = rels(part).find((item) => item.id === relationId);
        if (
          !relation ||
          relation.external ||
          relation.type !== officeRelationship("image") ||
          !Object.hasOwn(pkg.files, relation.target)
        )
          throw new Error(
            "The picture has a missing or non-local image relationship.",
          );
        if (linked)
          warn(
            "external-resource",
            "A linked picture uses its embedded copy. Its external link is ignored.",
          );
        const cached = assetsByPart.get(relation.target);
        if (cached) return cached;
        const image = pkg.files[relation.target];
        const header = readImageHeader(image);
        const asset = await sourceAsset(
          image,
          relation.target.split("/").pop() ?? "Picture",
          header.mime,
        );
        if (!Object.hasOwn(sources, asset.id)) {
          const pixels = header.width * header.height;
          if (
            imageCount + 1 > MAX_IMAGE_ASSETS ||
            imageBytes + image.length > MAX_TOTAL_IMAGE_BYTES ||
            imagePixels + pixels > MAX_TOTAL_IMAGE_PIXELS
          )
            throw new Error(
              "Embedded pictures exceed the PowerPoint deck image budget.",
            );
          imageCount++;
          imageBytes += image.length;
          imagePixels += pixels;
          sources[asset.id] = asset;
        }
        assetsByPart.set(relation.target, asset.id);
        return asset.id;
      },
    });
    slides.push({
      id,
      sourcePart,
      title: boundedText(scene.title || `Slide ${slides.length + 1}`, 300),
      hidden: off(attr(root, "show")),
      layoutPart: layout?.part,
      themePart: theme?.part,
      notesPart:
        notes && !notes.external && Object.hasOwn(pkg.files, notes.target)
          ? notes.target
          : undefined,
      background: scene.background,
      elements: scene.elements,
      builds: parseSlideBuilds(root, id, scene.localElementIds, warn),
    });
  }
  const document: SlideDocument = {
    schemaVersion: 1,
    id: original.id,
    sourceId: original.id,
    name: original.name,
    width,
    height,
    slides,
    diagnostics,
  };
  return { document: validateSlideDocument(document, sources), sources };
}
