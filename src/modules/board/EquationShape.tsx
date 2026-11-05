import {
  ShapeUtil,
  HTMLContainer,
  Rectangle2d,
  resizeBox,
  useEditor,
  useDelaySvgExport,
} from "tldraw";
import type { TLBaseShape, TLResizeInfo } from "tldraw";
import { useEffect, useRef, useState } from "react";
import { equationProps } from "../workspace/schema.ts";
import type { EquationProps } from "../workspace/schema.ts";
import "katex/dist/katex.min.css";
export type EquationShape = TLBaseShape<"equation", EquationProps>;
export class EquationShapeUtil extends ShapeUtil<EquationShape> {
  static override type = "equation" as const;
  static override props = equationProps;
  getDefaultProps(): EquationProps {
    return { w: 360, h: 120, source: "x^2", fontSize: 32, color: "#182127" };
  }
  getGeometry(shape: EquationShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }
  getIndicatorPath(shape: EquationShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
  override getText(shape: EquationShape) {
    return shape.props.source;
  }
  override onResize(shape: EquationShape, info: TLResizeInfo<EquationShape>) {
    return resizeBox(shape, info);
  }
  override onDoubleClick(shape: EquationShape) {
    this.editor
      .getContainer()
      .dispatchEvent(
        new CustomEvent("lessonboard:equation", { detail: shape.id }),
      );
  }
  component(shape: EquationShape) {
    return <EquationContent shape={shape} />;
  }
  indicator(shape: EquationShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}
function EquationContent({ shape }: { shape: EquationShape }) {
  const ready = useDelaySvgExport();
  const editor = useEditor(),
    ref = useRef<HTMLDivElement>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import("../math/render.ts")
      .then(({ renderEquation }) => {
        if (!live || !ref.current) return;
        const result = renderEquation(shape.props.source);
        setError(result.error ?? null);
        // Only bounded, trust:false KaTeX-generated output reaches this sink; imported HTML never does.
        ref.current.replaceChildren();
        if (result.html) {
          const template = document.createElement("template");
          template.innerHTML = result.html;
          ref.current.append(template.content);
        } else ref.current.textContent = shape.props.source;
      })
      .catch(() => {
        if (live && ref.current) {
          ref.current.textContent = shape.props.source;
          setError("Equation renderer could not load. Source is kept.");
        }
      })
      .finally(() => {
        void document.fonts.ready.then(ready);
      });
    return () => {
      live = false;
    };
  }, [shape.props.source]);
  return (
    <HTMLContainer
      className="equation-object"
      style={{
        width: shape.props.w,
        height: shape.props.h,
        fontSize: shape.props.fontSize,
        color: shape.props.color,
      }}
    >
      <div
        onDoubleClick={(e) => {
          e.stopPropagation();
          editor
            .getContainer()
            .dispatchEvent(
              new CustomEvent("lessonboard:equation", { detail: shape.id }),
            );
        }}
      >
        <div
          ref={ref}
          role="group"
          aria-label={`Equation: ${shape.props.source}`}
        />
        {error ? (
          <span data-testid="equation-error" className="equation-error">
            Source kept · edit equation to correct it
          </span>
        ) : null}
      </div>
    </HTMLContainer>
  );
}
