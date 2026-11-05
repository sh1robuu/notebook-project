import { PDFDocument, PDFName, PDFRawStream, PDFNumber } from "@cantoo/pdf-lib";
self.onmessage = async (
  event: MessageEvent<{ bytes: Uint8Array; password?: string }>,
) => {
  try {
    const pdf = await PDFDocument.load(event.data.bytes, {
        password: event.data.password,
      }),
      entries = pdf.context.enumerateIndirectObjects();
    if (
      pdf.catalog.has(PDFName.of("AcroForm")) &&
      (pdf.getForm().hasXFA() || pdf.getForm().getFields().length > 0)
    )
      throw new Error(
        "Interactive PDF forms and XFA are unsupported. Flatten the form in its original application before importing.",
      );
    if (entries.length > 200000)
      throw new Error("PDF exceeds 200,000 indirect objects.");
    for (const [, value] of entries) {
      if (!(value instanceof PDFRawStream)) continue;
      const subtype = pdf.context.lookup(value.dict.get(PDFName.of("Subtype")));
      if (subtype?.toString() !== "/Image") continue;
      const w = pdf.context.lookup(value.dict.get(PDFName.of("Width"))),
        h = pdf.context.lookup(value.dict.get(PDFName.of("Height")));
      if (
        !(w instanceof PDFNumber) ||
        !(h instanceof PDFNumber) ||
        !Number.isFinite(w.asNumber() * h.asNumber()) ||
        w.asNumber() <= 0 ||
        h.asNumber() <= 0 ||
        w.asNumber() * h.asNumber() > 16_000_000
      )
        throw new Error(
          "PDF image exceeds the 16 million pixel source-image limit.",
        );
    }
    self.postMessage({ ok: true });
  } catch (e) {
    self.postMessage({
      ok: false,
      error: e instanceof Error ? e.message : "PDF resource validation failed.",
    });
  }
};
