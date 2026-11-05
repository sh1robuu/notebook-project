const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** Native JSON only: no arbitrary tag names, URLs, event handlers or inline HTML. */
export function validateRichText(value: unknown): void {
  let nodes = 0,
    characters = 0;
  function visit(node: unknown, depth: number, parent?: string) {
    if (!obj(node) || depth > 24 || ++nodes > 10000)
      throw new Error("Rich text exceeds depth/node limits.");
    if (!["doc", "paragraph", "text", "hardBreak"].includes(String(node.type)))
      throw new Error("Unsupported rich text node.");
    if (
      (!parent && node.type !== "doc") ||
      (parent === "doc" && node.type !== "paragraph") ||
      (parent === "paragraph" &&
        !["text", "hardBreak"].includes(String(node.type))) ||
      ["text", "hardBreak"].includes(parent ?? "") ||
      (parent && node.type === "doc")
    )
      throw new Error("Invalid rich text block/inline structure.");
    if (
      (node.type === "text" || node.type === "hardBreak") &&
      node.content !== undefined
    )
      throw new Error("Rich text leaf nodes cannot have content.");
    if (node.type === "text") {
      if (
        typeof node.text !== "string" ||
        !node.text.length ||
        (characters += node.text.length) > 100000
      )
        throw new Error("Rich text exceeds the text limit.");
    }
    if (node.attrs !== undefined) {
      if (
        !obj(node.attrs) ||
        Object.keys(node.attrs).some((k) => !["dir", "textAlign"].includes(k))
      )
        throw new Error("Unsupported rich text attributes.");
      if (
        node.attrs.dir != null &&
        !["auto", "ltr", "rtl"].includes(String(node.attrs.dir))
      )
        throw new Error("Unsupported rich text direction.");
      if (
        node.attrs.textAlign != null &&
        !["left", "center", "right", "start", "end", "justify"].includes(
          String(node.attrs.textAlign),
        )
      )
        throw new Error("Unsupported rich text alignment.");
    }
    if (node.marks !== undefined) {
      if (node.type !== "text")
        throw new Error("Rich text marks require text nodes.");
      if (!Array.isArray(node.marks) || node.marks.length > 6)
        throw new Error("Invalid rich text marks.");
      for (const m of node.marks) {
        if (
          !obj(m) ||
          !["bold", "italic", "underline", "code", "highlight"].includes(
            String(m.type),
          )
        )
          throw new Error("Unsupported rich text mark.");
        if (
          m.attrs !== undefined &&
          (!obj(m.attrs) ||
            Object.entries(m.attrs).some(
              ([k, v]) =>
                m.type !== "highlight" ||
                k !== "color" ||
                (v !== null && typeof v !== "string") ||
                (typeof v === "string" && !/^#[0-9a-f]{6}$/i.test(v)),
            ))
        )
          throw new Error("Unsupported rich text mark attributes.");
      }
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content))
        throw new Error("Invalid rich text content.");
      for (const child of node.content)
        visit(child, depth + 1, String(node.type));
    }
  }
  if (!obj(value) || value.type !== "doc")
    throw new Error("Rich text needs a document root.");
  visit(value, 0);
}
export function finiteBox(props: Record<string, unknown>): void {
  const walk = (v: unknown, depth = 0) => {
    if (depth > 26) throw new Error("Object geometry depth limit exceeded.");
    if (
      typeof v === "number" &&
      (!Number.isFinite(v) || Math.abs(v) > 1_000_000)
    )
      throw new Error("Object geometry exceeds numeric bounds.");
    if (v && typeof v === "object")
      for (const value of Object.values(v)) walk(value, depth + 1);
  };
  walk(props);
  for (const key of ["w", "h"])
    if (
      key in props &&
      (typeof props[key] !== "number" ||
        !Number.isFinite(props[key]) ||
        Number(props[key]) < 0 ||
        Number(props[key]) > 100000)
    )
      throw new Error("Object dimensions exceed supported bounds.");
}
