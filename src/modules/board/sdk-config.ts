import { GeoShapeUtil, getTipTapDefaultExtensions } from "tldraw";
import { getAssetUrls } from "@tldraw/assets/selfHosted.js";
import { EquationShapeUtil } from "./EquationShape.tsx";
import { WordBlockShapeUtil } from "../documents/WordBlockShape.tsx";
import { MathFigureShapeUtil } from "../math/MathFigureShape.tsx";
import { InteractiveShapeUtil } from "../interactive/InteractiveShape.tsx";
import { MAX_SHAPES, MAX_PAGES } from "../workspace/model.ts";
const { fonts, icons, embedIcons } = getAssetUrls({ baseUrl: "/tldraw" });
export const sdkAssetUrls = { fonts, icons, embedIcons };
export const shapeUtils = [
  EquationShapeUtil,
  WordBlockShapeUtil,
  MathFigureShapeUtil,
  InteractiveShapeUtil,
  GeoShapeUtil.configure({
    getCustomDisplayValues(_editor, shape) {
      return typeof shape.meta.fillColor === "string" &&
        /^#[0-9a-f]{6}$/i.test(shape.meta.fillColor)
        ? { fillColor: shape.meta.fillColor }
        : {};
    },
  }),
];
export const textOptions = {
  tipTapConfig: {
    extensions: getTipTapDefaultExtensions({
      link: false,
      strike: false,
      heading: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
    }),
  },
};
export const sdkOptions = {
  maxShapesPerPage: MAX_SHAPES,
  maxPages: MAX_PAGES,
  branding: `${product.name} canvas`,
  camera: {
    zoomSteps: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4],
    wheelBehavior: "pan" as const,
  },
};
import { product } from "../../config/product.ts";
