import { createTLSchema, defaultShapeSchemas } from "@tldraw/tlschema";
import { T, Validator } from "@tldraw/validate";
import { validateMathFigure } from "../math/descriptor.ts";
import type { MathFigureProps } from "../math/descriptor.ts";
export type EquationProps = {
  w: number;
  h: number;
  source: string;
  fontSize: number;
  color: string;
};
export type WordBlockProps = {
  w: number;
  h: number;
  documentId: string;
  blockId: string;
};
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    equation: EquationProps;
    "word-block": WordBlockProps;
    "math-figure": MathFigureProps;
  }
}
export const equationProps = {
  w: T.number,
  h: T.number,
  source: T.string,
  fontSize: T.number,
  color: T.string,
};
export const wordBlockProps = {
  w: T.number,
  h: T.number,
  documentId: T.string,
  blockId: T.string,
};
export const mathFigureProps = {
  w: T.number,
  h: T.number,
  figure: new Validator(validateMathFigure),
};
export const lessonSchema = createTLSchema({
  shapes: {
    ...defaultShapeSchemas,
    equation: { props: equationProps },
    "word-block": { props: wordBlockProps },
    "math-figure": { props: mathFigureProps },
  },
});
