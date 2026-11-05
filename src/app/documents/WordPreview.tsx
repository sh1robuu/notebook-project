import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import type { DocumentModel } from "../../modules/documents/model.ts";
import type { DocumentSources } from "../../modules/documents/sources.ts";
import { DOCX_MIME } from "../../modules/documents/sources.ts";
import { DocumentBlockView } from "../../modules/documents/render.tsx";

type Props = { document: DocumentModel; sources: DocumentSources };
const policy =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Semantic preview is a projection of the shared model, not a second model. */
export function WordPreview({ document: model, sources }: Props) {
  const [visible, setVisible] = useState(25);
  const [mode, setMode] = useState<"semantic" | "source">("semantic");
  const source = model.sourceId ? sources[model.sourceId] : undefined;
  useEffect(() => {
    setVisible(25);
    setMode("semantic");
  }, [model.id]);
  return (
    <section className="word-preview" aria-label="Word document preview">
      <div role="group" aria-label="Preview representation">
        <button
          type="button"
          aria-pressed={mode === "semantic"}
          onClick={() => setMode("semantic")}
        >
          Teaching layout preview
        </button>
        {source?.mime === DOCX_MIME ? (
          <button
            type="button"
            aria-pressed={mode === "source"}
            onClick={() => setMode("source")}
          >
            Source layout preview
          </button>
        ) : null}
      </div>
      {mode === "semantic" ? (
        <>
          <p>
            Semantic teaching preview uses the editable document model. It
            reflows and may paginate differently from Microsoft Word.
          </p>
          <div className="word-preview-blocks">
            {model.blocks.slice(0, visible).map((block, index) => (
              <article
                key={block.id}
                data-word-preview-block={block.id}
                aria-label={`Preview block ${index + 1}`}
              >
                <DocumentBlockView
                  block={block}
                  document={model}
                  sources={sources}
                />
              </article>
            ))}
          </div>
          {visible < model.blocks.length ? (
            <button
              type="button"
              onClick={() =>
                setVisible((n) => Math.min(model.blocks.length, n + 25))
              }
            >
              Show next 25 preview blocks
            </button>
          ) : null}
          <p>
            {Math.min(visible, model.blocks.length)} of {model.blocks.length}{" "}
            root blocks shown.
          </p>
        </>
      ) : source ? (
        <SourcePreview bytes={source.bytes} identity={source.id} />
      ) : (
        <p role="alert">Original DOCX source is unavailable.</p>
      )}
    </section>
  );
}

/** Isolated opt-in approximation. No imported markup is attached to app DOM. */
function SourcePreview({
  bytes,
  identity,
}: {
  bytes: Uint8Array;
  identity: string;
}) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setHtml("");
    setError("");
    void (async () => {
      if (bytes.length > 5_000_000)
        throw new Error(
          "Source layout preview is limited to 5 MB to keep editing responsive. Use the semantic preview or open the retained DOCX in Word for this document.",
        );
      const { readOoxmlPackage, elements, REL } =
        await import("../../modules/documents/package.ts");
      const pkg = readOoxmlPackage(bytes);
      for (const name of Object.keys(pkg.files)) {
        if (/\.(xml|rels)$/i.test(name)) pkg.xml(name);
        if (name.endsWith(".rels"))
          for (const rel of elements(pkg.xml(name).documentElement!))
            if (
              rel.namespaceURI !== REL ||
              rel.localName !== "Relationship" ||
              rel.getAttribute("TargetMode") === "External" ||
              /(?:oleObject|aFChunk)$/i.test(rel.getAttribute("Type") ?? "")
            )
              throw new Error(
                "Source preview is unavailable for external relationships or embedded objects. Use the semantic preview and its element diagnostics; no external resource was fetched.",
              );
        if (
          /^word\/(?:embeddings|activeX)\//i.test(name) ||
          (/^word\/media\//i.test(name) && !/\.(png|jpe?g)$/i.test(name))
        )
          throw new Error(
            "Source preview is limited to safe PNG/JPEG media without embedded objects. Original data and semantic diagnostics remain available.",
          );
      }
      if (!live) return;
      const { renderAsync } = await import("docx-preview");
      if (!live) return;
      const detached = window.document.implementation.createHTMLDocument(
        "Document source preview",
      );
      const body = detached.createElement("div"),
        styles = detached.createElement("div");
      await renderAsync(bytes.slice().buffer, body, styles, {
        useBase64URL: true,
        ignoreFonts: true,
        renderAltChunks: false,
        renderComments: false,
        renderChanges: false,
        experimental: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        inWrapper: true,
        breakPages: true,
      });
      if (!live) {
        body.replaceChildren();
        styles.replaceChildren();
        return;
      }
      const safe = DOMPurify.sanitize(styles.innerHTML + body.innerHTML, {
        WHOLE_DOCUMENT: true,
        ADD_TAGS: ["style"],
        FORBID_TAGS: [
          "script",
          "iframe",
          "object",
          "embed",
          "link",
          "base",
          "form",
          "input",
          "button",
          "textarea",
          "select",
          "svg",
          "annotation-xml",
          "video",
          "audio",
        ],
        FORBID_ATTR: ["srcset", "href", "xlink:href", "action", "formaction"],
        ALLOW_DATA_ATTR: false,
        ALLOWED_URI_REGEXP: /^data:image\/(?:png|jpeg);base64,/i,
      });
      const cleaned = new DOMParser().parseFromString(safe, "text/html");
      for (const element of cleaned.querySelectorAll("[style],style")) {
        if (element.tagName === "STYLE")
          element.textContent = (element.textContent ?? "")
            .replace(/@import[^;]*;?/gi, "")
            .replace(/url\([^)]*\)/gi, "none");
        else if (
          /url\s*\(|@import|expression\s*\(/i.test(
            element.getAttribute("style") ?? "",
          )
        )
          element.removeAttribute("style");
      }
      for (const image of cleaned.querySelectorAll("img"))
        if (
          !/^data:image\/(?:png|jpeg);base64,/i.test(
            image.getAttribute("src") ?? "",
          )
        )
          image.removeAttribute("src");
      body.replaceChildren();
      styles.replaceChildren();
      setHtml(
        `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><style>body{margin:0;font-family:Arial,sans-serif}img{max-width:100%}</style>${cleaned.head.innerHTML}</head><body>${cleaned.body.innerHTML}</body></html>`,
      );
    })().catch((cause: unknown) => {
      if (live)
        setError(
          cause instanceof Error
            ? cause.message
            : "Source layout preview could not load. The semantic document and original source are retained.",
        );
    });
    return () => {
      live = false;
    };
  }, [bytes, identity]);
  return (
    <div>
      <p>
        Source layout approximation uses docx-preview 0.4.1 in an isolated
        frame. It is not verified Microsoft Word pagination. Equations, floating
        objects, legacy graphics and unavailable fonts can differ; use the
        semantic preview and diagnostics to check supported content.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : html ? (
        <iframe
          title="Isolated DOCX source layout preview"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={html}
          style={{ width: "100%", height: 480, border: "1px solid #ccd4d8" }}
        />
      ) : (
        <p role="status">Preparing isolated source layout preview…</p>
      )}
    </div>
  );
}
