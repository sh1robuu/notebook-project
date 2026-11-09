import { HTMLContainer, Rectangle2d, ShapeUtil, resizeBox } from "tldraw";
import type { Editor, TLBaseShape, TLResizeInfo, TLShapeId } from "tldraw";
import { imageDataUrl, readImageHeader } from "../media/image-format.ts";
import { interactiveProps } from "../workspace/schema.ts";
import type { InteractiveProps } from "./model.ts";
import type { InteractiveSource, InteractiveSources } from "./sources.ts";

export type InteractiveShape = TLBaseShape<"interactive", InteractiveProps>;
export const openInteractiveEvent = "lessonboard:interactive";
const pools = new WeakMap<Editor, () => InteractiveSources>();
const previews = new WeakMap<InteractiveSource, string>();

export function bindInteractiveSources(
  editor: Editor,
  read: () => InteractiveSources,
) {
  pools.set(editor, read);
  return () => {
    pools.delete(editor);
  };
}

export function requestInteractive(editor: Editor, id: TLShapeId) {
  editor
    .getContainer()
    .dispatchEvent(new CustomEvent(openInteractiveEvent, { detail: id }));
}

function previewFor(editor: Editor, id: string | undefined) {
  if (!id) return undefined;
  const source = pools.get(editor)?.()[id];
  if (source?.kind !== "preview") return undefined;
  const cached = previews.get(source);
  if (cached) return cached;
  const url = imageDataUrl(source.bytes, readImageHeader(source.bytes).mime);
  previews.set(source, url);
  return url;
}

function Poster({
  props,
  preview,
}: {
  props: InteractiveProps;
  preview?: string;
}) {
  const { w, h, material } = props;
  const title =
    material.title.length > 42
      ? material.title.slice(0, 41) + "…"
      : material.title;
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 480 300"
      preserveAspectRatio="none"
      role="img"
      aria-label={material.title}
    >
      <rect
        x={1}
        y={1}
        width={478}
        height={298}
        rx={12}
        fill="#f1f6f5"
        stroke="#496763"
        strokeWidth={2}
      />
      {preview ? (
        <image
          href={preview}
          x={8}
          y={8}
          width={464}
          height={284}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : (
        <g fill="#244741" fontFamily="sans-serif" textAnchor="middle">
          <text x={240} y={115} fontSize={15}>
            {material.kind === "geogebra" ? "GeoGebra" : "Mô phỏng HTML"}
          </text>
          <text x={240} y={153} fontSize={18} fontWeight={600}>
            {title}
          </text>
          <text x={240} y={188} fontSize={13}>
            Có thể mở trong tệp bài giảng
          </text>
        </g>
      )}
    </svg>
  );
}

export class InteractiveShapeUtil extends ShapeUtil<InteractiveShape> {
  static override type = "interactive" as const;
  static override props = interactiveProps;
  getDefaultProps(): InteractiveProps {
    return {
      w: 480,
      h: 300,
      material: {
        version: 1,
        kind: "html",
        title: "Mô phỏng",
        sourceId: "interactive:" + "0".repeat(64),
        entry: "index.html",
      },
    };
  }
  getGeometry({ props }: InteractiveShape) {
    return new Rectangle2d({ width: props.w, height: props.h, isFilled: true });
  }
  getIndicatorPath({ props }: InteractiveShape) {
    const path = new Path2D();
    path.rect(0, 0, props.w, props.h);
    return path;
  }
  override getText({ props }: InteractiveShape) {
    return props.material.title;
  }
  override onResize(
    shape: InteractiveShape,
    info: TLResizeInfo<InteractiveShape>,
  ) {
    return resizeBox(shape, info, { maxWidth: 100000, maxHeight: 100000 });
  }
  override onDoubleClick(shape: InteractiveShape) {
    requestInteractive(this.editor, shape.id);
  }
  component({ props }: InteractiveShape) {
    return (
      <HTMLContainer
        data-testid="interactive-object"
        style={{ width: props.w, height: props.h }}
      >
        <Poster
          props={props}
          preview={previewFor(this.editor, props.material.snapshotId)}
        />
      </HTMLContainer>
    );
  }
  override toSvg({ props }: InteractiveShape) {
    return (
      <Poster
        props={props}
        preview={previewFor(this.editor, props.material.snapshotId)}
      />
    );
  }
}
