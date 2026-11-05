import { createContext, useContext, useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useWordMath } from "./math-loader.ts";
import { useDelaySvgExport } from "tldraw";
import type {
  BlockFormat,
  DocumentBlock,
  DocumentInline,
  DocumentModel,
  TextFormat,
} from "./model.ts";
import type { DocumentSource, DocumentSources } from "./sources.ts";

export const WordSourcesContext = createContext<DocumentSources>({});
const dataUrls = new WeakMap<DocumentSource, string>();
export function documentAssetUrl(
  document: DocumentModel,
  assetId: string,
  sources: DocumentSources,
): string | undefined {
  const descriptor = document.assets[assetId],
    source = descriptor && sources[descriptor.sourceId];
  if (!descriptor || !source || !/^image\/(png|jpeg)$/.test(source.mime))
    return undefined;
  const cached = dataUrls.get(source);
  if (cached) return cached;
  const pieces: string[] = [];
  for (let i = 0; i < source.bytes.length; i += 32768)
    pieces.push(String.fromCharCode(...source.bytes.subarray(i, i + 32768)));
  const result = `data:${source.mime};base64,${btoa(pieces.join(""))}`;
  dataUrls.set(source, result);
  return result;
}
function textStyle(format: TextFormat): CSSProperties {
  return {
    fontFamily: format.fontFamily
      ? `${format.fontFamily}, Arial, sans-serif`
      : undefined,
    fontSize: format.fontSize ? (format.fontSize * 4) / 3 : undefined,
    color: format.color,
    backgroundColor: format.highlight,
    fontWeight: format.bold === undefined ? undefined : format.bold ? 700 : 400,
    fontStyle:
      format.italic === undefined
        ? undefined
        : format.italic
          ? "italic"
          : "normal",
    textDecoration:
      format.underline === undefined
        ? undefined
        : format.underline
          ? "underline"
          : "none",
  };
}
function blockStyle(format: BlockFormat): CSSProperties {
  return {
    ...textStyle(format),
    // Underlines paint through descendants and cannot be cancelled there.
    // Project inherited underline onto individual runs instead of an ancestor.
    textDecoration: undefined,
    textAlign: format.align,
    lineHeight: format.lineHeight ?? 1.4,
    paddingLeft: Math.max(0, format.indent ?? 0),
    boxSizing: "border-box",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  };
}
function Asset({
  assetId,
  width,
  height,
  alt,
  document,
  sources,
}: {
  assetId: string;
  width: number;
  height?: number;
  alt: string;
  document: DocumentModel;
  sources: DocumentSources;
}) {
  const src = documentAssetUrl(document, assetId, sources);
  return src ? (
    <img
      src={src}
      alt={alt || "Imported document image"}
      style={{
        width,
        maxWidth: "100%",
        height: "auto",
        aspectRatio: height ? `${width} / ${height}` : undefined,
        verticalAlign: "middle",
      }}
    />
  ) : (
    <span
      role="status"
      style={{
        display: "inline-block",
        border: "1px solid #b42318",
        padding: 8,
        color: "#b42318",
      }}
    >
      Image unavailable · original source retained
    </span>
  );
}
function Inline({
  inline,
  document,
  sources,
  inherited,
}: {
  inline: DocumentInline;
  document: DocumentModel;
  sources: DocumentSources;
  inherited: TextFormat;
}): ReactNode {
  if (inline.kind === "text")
    return (
      <span style={textStyle({ ...inherited, ...inline.format })}>
        {inline.text}
      </span>
    );
  if (inline.kind === "image")
    return (
      <Asset
        assetId={inline.assetId}
        width={inline.width}
        height={inline.height}
        alt={inline.alt}
        document={document}
        sources={sources}
      />
    );
  if (inline.status !== "editable")
    return (
      <span
        style={{
          display: "inline-block",
          padding: 6,
          border: "1px solid #b42318",
          color: "#b42318",
        }}
      >
        {inline.fallbackAssetId ? (
          <Asset
            assetId={inline.fallbackAssetId}
            width={260}
            alt="Non-editable equation preview"
            document={document}
            sources={sources}
          />
        ) : (
          "Unsupported equation"
        )}
        <small style={{ display: "block" }}>
          Original equation retained · needs conversion
        </small>
      </span>
    );
  return <WordEquation inline={inline} />;
}
function WordEquation({
  inline,
}: {
  inline: Extract<DocumentInline, { kind: "equation" }>;
}) {
  const result = useWordMath(inline.source),
    ready = useDelaySvgExport();
  useEffect(() => {
    if (!result.loading) void document.fonts.ready.then(ready);
  }, [result.loading, ready]);
  if (!result.html)
    return (
      <span style={{ whiteSpace: "pre-wrap", color: "#b42318" }}>
        {inline.source}
        <small style={{ display: "block" }}>Equation needs review</small>
      </span>
    );
  // Only bounded trust:false KaTeX output reaches this sink; OOXML/HTML is never injected.
  const html = result.html.replace(
    'class="katex-display"',
    'class="katex-display" style="display:inline-block;margin:0"',
  );
  return (
    <span
      className="word-equation"
      aria-label={`Equation: ${inline.source}`}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        maxWidth: "100%",
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** The semantic model is rendered with explicit safe element/style choices. */
export function DocumentBlockView({
  block,
  document,
  sources: provided,
}: {
  block: DocumentBlock;
  document: DocumentModel;
  sources?: DocumentSources;
}) {
  const context = useContext(WordSourcesContext),
    sources = provided ?? context;
  const base: CSSProperties = {
    ...blockStyle(block.format),
    margin: 0,
    minHeight: 24,
    fontFamily: block.format.fontFamily
      ? `${block.format.fontFamily}, Arial, sans-serif`
      : "Arial, sans-serif",
    fontSize: block.format.fontSize ? (block.format.fontSize * 4) / 3 : 24,
    color: block.format.color ?? "#182127",
  };
  let content: ReactNode;
  if (block.kind === "paragraph") {
    content = (
      <div
        style={{
          ...base,
          fontWeight: block.heading ? 700 : base.fontWeight,
          fontSize:
            block.heading && !block.format.fontSize
              ? Math.max(24, 38 - block.heading * 2)
              : base.fontSize,
        }}
      >
        {block.list ? (
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              minWidth: 32,
              marginLeft: block.list.level * 20,
            }}
          >
            {block.list.label ||
              (block.list.kind === "bullet" ? "•" : "1.")}{" "}
          </span>
        ) : null}
        {block.inlines.length ? (
          block.inlines.map((inline) => (
            <Inline
              key={inline.id}
              inline={inline}
              document={document}
              sources={sources}
              inherited={{
                ...block.format,
                bold: block.format.bold ?? !!block.heading,
              }}
            />
          ))
        ) : (
          <br />
        )}
      </div>
    );
  } else if (block.kind === "table") {
    content = (
      <table
        style={{
          ...base,
          borderCollapse: "collapse",
          tableLayout: "fixed",
          width: "100%",
        }}
      >
        <tbody>
          {block.rows.map((row, ri) => (
            <tr key={ri}>
              {row.cells.map((cell, ci) => (
                <td
                  key={ci}
                  colSpan={cell.colSpan}
                  rowSpan={cell.rowSpan}
                  style={{
                    border: "1px solid #53616b",
                    padding: 8,
                    verticalAlign: "top",
                  }}
                >
                  {cell.blocks.map((child) => (
                    <DocumentBlockView
                      key={child.id}
                      block={child}
                      document={document}
                      sources={sources}
                    />
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (block.kind === "image") {
    content = (
      <div style={base}>
        <Asset
          assetId={block.assetId}
          width={block.width}
          height={block.height}
          alt={block.alt}
          document={document}
          sources={sources}
        />
      </div>
    );
  } else {
    content = (
      <div
        style={{
          ...base,
          border: "1px solid #b42318",
          padding: 12,
          color: "#b42318",
        }}
      >
        {block.fallbackAssetId ? (
          <Asset
            assetId={block.fallbackAssetId}
            width={300}
            alt={block.label + " (non-editable preview)"}
            document={document}
            sources={sources}
          />
        ) : null}
        <strong>{block.label}</strong>
        <div>{block.reason}</div>
        <small>
          Original source retained. Convert this element with a supported tool
          before relying on it.
        </small>
      </div>
    );
  }
  return (
    <div
      data-word-block={block.id}
      style={{ width: "100%", boxSizing: "border-box" }}
    >
      {content}
    </div>
  );
}
