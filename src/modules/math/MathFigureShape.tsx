import { HTMLContainer, Rectangle2d, ShapeUtil, resizeBox } from "tldraw";
import type { TLBaseShape, TLResizeInfo } from "tldraw";
import { mathFigureProps } from "../workspace/schema.ts";
import { defaultFigureStyle } from "./descriptor.ts";
import type { MathFigureProps } from "./descriptor.ts";
import { FigureSvg } from "./figure-svg.tsx";

export type MathFigureShape = TLBaseShape<"math-figure", MathFigureProps>;

/** The editor owns native transforms, history, parent IDs and selection. */
export class MathFigureShapeUtil extends ShapeUtil<MathFigureShape> {
  static override type = "math-figure" as const;
  static override props = mathFigureProps;

  getDefaultProps(): MathFigureProps {
    return {
      w: 640,
      h: 420,
      figure: {
        kind: "graph",
        schemaVersion: 1,
        expression: {
          source: "x",
          normalized: "x",
          ast: { kind: "symbol", name: "x" },
          variables: ["x"],
          angleMode: "RAD",
          domain: [],
        },
        style: { ...defaultFigureStyle },
        viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
        sampleSize: { width: 640, height: 420 },
        data: {
          segments: [
            Array.from({ length: 33 }, (_, index) => {
              const coordinate = -10 + index * 0.625;
              return { x: coordinate, y: coordinate };
            }),
          ],
          holes: [],
          evaluations: 129,
          warnings: [],
        },
      },
    };
  }

  getGeometry({ props }: MathFigureShape) {
    return new Rectangle2d({ width: props.w, height: props.h, isFilled: true });
  }

  getIndicatorPath({ props }: MathFigureShape) {
    const path = new Path2D();
    path.rect(0, 0, props.w, props.h);
    return path;
  }

  override getText({ props }: MathFigureShape) {
    return props.figure.expression.source;
  }

  override onResize(
    shape: MathFigureShape,
    info: TLResizeInfo<MathFigureShape>,
  ) {
    return resizeBox(shape, info, { maxWidth: 100000, maxHeight: 100000 });
  }

  override onDoubleClick(shape: MathFigureShape) {
    this.editor
      .getContainer()
      .dispatchEvent(
        new CustomEvent("lessonboard:math-figure", { detail: shape.id }),
      );
  }

  component(shape: MathFigureShape) {
    const { w, h, figure } = shape.props;
    return (
      <HTMLContainer data-testid="math-figure" style={{ width: w, height: h }}>
        <FigureSvg figure={figure} width={w} height={h} />
      </HTMLContainer>
    );
  }

  override toSvg({ props }: MathFigureShape) {
    return <FigureSvg figure={props.figure} width={props.w} height={props.h} />;
  }
}
