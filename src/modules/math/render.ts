import katex from "katex";
export function renderEquation(source: string): {
  source: string;
  html?: string;
  error?: string;
} {
  try {
    if (source.length > 4000)
      throw new Error("Equation source exceeds 4,000 characters.");
    return {
      source,
      html: katex.renderToString(source, {
        displayMode: true,
        throwOnError: true,
        trust: false,
        strict: "error",
        maxExpand: 1000,
        maxSize: 20,
        output: "htmlAndMathml",
        macros: {},
      }),
    };
  } catch (error) {
    return {
      source,
      error:
        error instanceof Error
          ? error.message
          : "Equation could not be rendered.",
    };
  }
}
