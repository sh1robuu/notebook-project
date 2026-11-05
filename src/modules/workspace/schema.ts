import { createTLSchema, defaultShapeSchemas } from "@tldraw/tlschema";
import { T } from "@tldraw/validate";
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
export const lessonSchema = createTLSchema({
  shapes: {
    ...defaultShapeSchemas,
    equation: { props: equationProps },
    "word-block": { props: wordBlockProps },
  },
});
