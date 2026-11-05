import { PDFDocument, rgb } from "@cantoo/pdf-lib";
import { multiply } from "./geometry.ts";
import type { PdfExportJob } from "./export-contract.ts";
self.onmessage = async (event: MessageEvent<PdfExportJob>) => {
  try {
    const job = event.data,
      out = await PDFDocument.create();
    out.setProducer(product.name);
    out.setCreator(product.name);
    const sources = new Map<string, PDFDocument>();
    for (let n = 0; n < job.pages.length; n++) {
      const p = job.pages[n],
        u = p.unit,
        page = out.addPage([p.width * u, p.height * u]);
      const c = p.color
        .match(/[a-f0-9]{2}/gi)!
        .map((v) => parseInt(v, 16) / 255);
      page.drawRectangle({
        x: 0,
        y: 0,
        width: p.width * u,
        height: p.height * u,
        color: rgb(c[0], c[1], c[2]),
      });
      if (p.pdf) {
        const source = job.sources[p.pdf.sourceId],
          info = source.pages[p.pdf.index];
        let original = sources.get(source.id);
        if (!original) {
          original = await PDFDocument.load(source.bytes, {
            password: job.passwords[source.id],
          });
          sources.set(source.id, original);
        }
        const [left, bottom, right, top] = info.viewBox;
        const embedded = await out.embedPage(
          original.getPage(p.pdf.index),
          { left, bottom, right, top },
          multiply([u, 0, 0, -u, 0, p.height * u], info.transform),
        );
        page.drawPage(embedded, { x: 0, y: 0 });
      }
      if (p.backgroundPng) {
        const im = await out.embedPng(p.backgroundPng);
        page.drawImage(im, {
          x: 0,
          y: 0,
          width: p.width * u,
          height: p.height * u,
        });
      }
      for (const layer of p.layers) {
        const b = layer.bounds;
        if (layer.svg)
          page.drawSvg(layer.svg, {
            x: b.x * u,
            // Cantoo drawSvg anchors y at the SVG's top edge (unlike drawImage).
            // Verified independently with the 100x60 SVG placement fixture.
            y: (p.height - b.y) * u,
            width: b.w * u,
            height: b.h * u,
          });
        else if (layer.png) {
          const image = await out.embedPng(layer.png);
          page.drawImage(image, {
            x: b.x * u,
            y: (p.height - b.y - b.h) * u,
            width: b.w * u,
            height: b.h * u,
          });
        } else
          throw new Error("An annotation layer is missing. Export cancelled.");
      }
      self.postMessage({ progress: n + 1, total: job.pages.length });
    }
    const bytes = await out.save();
    if (bytes.length > 250_000_000)
      throw new Error("Generated PDF exceeds 250 MB. Export a smaller range.");
    self.postMessage({ ok: true, bytes }, { transfer: [bytes.buffer] });
  } catch (e) {
    self.postMessage({
      ok: false,
      error: e instanceof Error ? e.message : "PDF writer failed.",
    });
  }
};
import { product } from "../../config/product.ts";
