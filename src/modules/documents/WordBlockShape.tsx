import {
  ShapeUtil,
  HTMLContainer,
  Rectangle2d,
  useDelaySvgExport,
  useEditor,
  useValue,
} from "tldraw";
import type { TLBaseShape } from "tldraw";
import { useEffect, useRef, useContext } from "react";
import { wordBlockProps } from "../workspace/schema.ts";
import type { WordBlockProps } from "../workspace/schema.ts";
import { walkBlocks } from "./model.ts";
import type { DocumentModel } from "./model.ts";
import { DocumentBlockView, WordSourcesContext } from "./render.tsx";
import { editorWordSources } from "./editor-sources.ts";
import "katex/dist/katex.min.css";

export type WordBlockShape = TLBaseShape<"word-block", WordBlockProps>;
export class WordBlockShapeUtil extends ShapeUtil<WordBlockShape> {
  static override type = "word-block" as const;
  static override props = wordBlockProps;
  getDefaultProps(): WordBlockProps {
    return { documentId: "", blockId: "", w: 800, h: 40 };
  }
  override canResize() {
    return false;
  }
  override canEdit() {
    return false;
  }
  override canBind() {
    return false;
  }
  getGeometry(shape: WordBlockShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }
  getIndicatorPath(shape: WordBlockShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
  getText(shape: WordBlockShape) {
    return shape.props.blockId;
  }
  component(shape: WordBlockShape) {
    return <WordContent shape={shape} />;
  }
  indicator(shape: WordBlockShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}
function WordContent({ shape }: { shape: WordBlockShape }) {
  const editor = useEditor(),
    ready = useDelaySvgExport(),
    ref = useRef<HTMLDivElement>(null);
  const sources = editorWordSources(editor, useContext(WordSourcesContext));
  const model = useValue(
    "compiled Word model",
    () =>
      editor.getPage(shape.parentId as never)?.meta.word as
        DocumentModel | undefined,
    [editor, shape.parentId],
  );
  const block =
    model?.id === shape.props.documentId
      ? walkBlocks(model).find((b) => b.id === shape.props.blockId)
      : undefined;
  useEffect(() => {
    let active = true;
    Promise.all([
      document.fonts.ready,
      ...[...(ref.current?.querySelectorAll("img") ?? [])].map((image) =>
        image.decode().catch(() => {}),
      ),
    ]).finally(() => {
      if (active) ready();
    });
    return () => {
      active = false;
    };
  }, [model, shape.props.blockId, ready]);
  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <div
        ref={ref}
        role="group"
        aria-label="Structured teaching block"
        style={{ width: "100%", fontSize: 24, lineHeight: 1.4 }}
      >
        {model && block ? (
          <DocumentBlockView document={model} block={block} sources={sources} />
        ) : (
          <span style={{ color: "#b42318" }}>
            Document block missing · keep the original lesson
          </span>
        )}
      </div>
    </HTMLContainer>
  );
}
