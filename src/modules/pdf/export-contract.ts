import type { PdfSource } from "./sources.ts";
export type ExportBounds = { x: number; y: number; w: number; h: number };
export type ExportLayer = {
  bounds: ExportBounds;
  svg?: string;
  png?: Uint8Array;
};
export type ExportPage = {
  width: number;
  height: number;
  unit: number;
  color: string;
  pdf?: { sourceId: string; index: number };
  backgroundPng?: Uint8Array;
  layers: ExportLayer[];
};
export type PdfExportJob = {
  pages: ExportPage[];
  sources: Record<string, PdfSource>;
  passwords: Record<string, string>;
};
