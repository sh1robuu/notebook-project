import {
  M,
  attribute,
  child,
  children,
  elements,
  parseXml,
  serializeXml,
} from "./package.ts";
import type { XmlElement } from "./package.ts";
export type OmmlConversion = {
  status: "editable" | "unsupported";
  source: string;
  original: string;
  reason?: string;
};
const symbols: Record<string, string> = {
  α: "\\alpha ",
  β: "\\beta ",
  γ: "\\gamma ",
  δ: "\\delta ",
  ε: "\\epsilon ",
  θ: "\\theta ",
  λ: "\\lambda ",
  μ: "\\mu ",
  π: "\\pi ",
  σ: "\\sigma ",
  φ: "\\phi ",
  ω: "\\omega ",
  Δ: "\\Delta ",
  Σ: "\\Sigma ",
  Ω: "\\Omega ",
  "→": "\\to ",
  "∞": "\\infty ",
  "≤": "\\le ",
  "≥": "\\ge ",
  "≠": "\\ne ",
  "×": "\\times ",
  "÷": "\\div ",
  "±": "\\pm ",
  "−": "-",
  "∈": "\\in ",
  "∂": "\\partial ",
  "∇": "\\nabla ",
  "·": "\\cdot ",
  "…": "\\ldots ",
  "∅": "\\emptyset ",
};
function mathText(text: string) {
  return [...text]
    .map((c) => symbols[c] ?? (/[#$%&_{}\\]/.test(c) ? `\\${c}` : c))
    .join("");
}
function delim(s: string) {
  return s === "{" ? "\\{" : s === "}" ? "\\}" : s || ".";
}
/** Deliberately bounded OMML subset; an unknown mathematical node rejects the
 * whole equation instead of silently dropping a token or guessing its meaning. */
export function convertOmml(input: string | XmlElement): OmmlConversion {
  const original = typeof input === "string" ? input : serializeXml(input);
  const root =
    typeof input === "string" ? parseXml(input).documentElement! : input;
  if (
    root.namespaceURI !== M ||
    !["oMath", "oMathPara"].includes(root.localName!)
  )
    throw new Error("Invalid OMML equation root.");
  let count = 0;
  const group = (el: XmlElement | undefined) =>
    el ? elements(el).map(convert).join("") : "";
  function convert(el: XmlElement): string {
    if (++count > 10000) throw new Error("OMML node limit exceeded.");
    if (el.namespaceURI !== M)
      throw new Error(`Unsupported OMML namespace on ${el.localName}.`);
    const name = el.localName!;
    if (
      [
        "ctrlPr",
        "rPr",
        "argPr",
        "oMathParaPr",
        "fPr",
        "radPr",
        "sSupPr",
        "sSubPr",
        "sSubSupPr",
        "sPrePr",
        "naryPr",
        "limLowPr",
        "limUppPr",
        "mPr",
        "mrPr",
        "dPr",
        "accPr",
        "barPr",
        "eqArrPr",
        "funcPr",
        "groupChrPr",
      ].includes(name)
    )
      return "";
    if (
      [
        "oMath",
        "oMathPara",
        "e",
        "num",
        "den",
        "deg",
        "sup",
        "sub",
        "lim",
        "fName",
      ].includes(name)
    )
      return group(el);
    if (name === "r") {
      if (elements(el).some((e) => !["rPr", "t"].includes(e.localName!)))
        throw new Error("Unsupported OMML run content.");
      const text = children(el, M, "t")
        .map((n) => n.textContent ?? "")
        .join("");
      const normal = child(child(el, M, "rPr"), M, "nor");
      return normal
        ? `\\text{${text.replace(/[{}\\]/g, "\\$&")}}`
        : mathText(text);
    }
    if (name === "t") return mathText(el.textContent ?? "");
    const required = (name: string) => {
      const value = group(child(el, M, name));
      if (!value.trim())
        throw new Error(
          `Incomplete OMML ${el.localName}: missing ${name} operand.`,
        );
      return value;
    };
    const e = () => required("e");
    // OMML scripts apply to the entire e argument, whereas TeX scripts attach
    // to one preceding atom. Keep a single atom readable; group every compound
    // base, including a prior scripted expression, before attaching scripts.
    const scriptBase = () => {
      const value = e();
      return /^[\p{L}\p{N}]$/u.test(value) || /^\\[A-Za-z]+\s*$/.test(value)
        ? value
        : `{${value}}`;
    };
    if (name === "f") {
      const type = attribute(child(child(el, M, "fPr"), M, "type"), M, "val");
      if (type && !["bar", "lin", "skw", "noBar"].includes(type))
        throw new Error("Unsupported fraction type.");
      const num = group(child(el, M, "num")),
        den = group(child(el, M, "den"));
      if (!num || !den) throw new Error("Incomplete OMML fraction.");
      if (type === "noBar") return `\\genfrac{}{}{0pt}{}{${num}}{${den}}`;
      if (type === "lin" || type === "skw") return `{${num}}/{${den}}`;
      return `\\frac{${num}}{${den}}`;
    }
    if (name === "rad") {
      const degree = group(child(el, M, "deg")),
        hidden = attribute(
          child(child(el, M, "radPr"), M, "degHide"),
          M,
          "val",
        );
      return `\\sqrt${degree && hidden !== "1" ? `[${degree}]` : ""}{${e()}}`;
    }
    if (name === "sSup") return `${scriptBase()}^{${required("sup")}}`;
    if (name === "sSub") return `${scriptBase()}_{${required("sub")}}`;
    if (name === "sSubSup")
      return `${scriptBase()}_{${required("sub")}}^{${required("sup")}}`;
    if (name === "sPre")
      return `{}_{${required("sub")}}^{${required("sup")}}${scriptBase()}`;
    if (name === "nary") {
      const pr = child(el, M, "naryPr"),
        chr = attribute(child(pr, M, "chr"), M, "val") || "∫";
      const op = (
        {
          "∑": "\\sum",
          "∏": "\\prod",
          "∫": "\\int",
          "∬": "\\iint",
          "∭": "\\iiint",
          "∮": "\\oint",
          "⋂": "\\bigcap",
          "⋃": "\\bigcup",
        } as Record<string, string>
      )[chr];
      if (!op) throw new Error(`Unsupported OMML n-ary operator ${chr}.`);
      const sub = group(child(el, M, "sub")),
        sup = group(child(el, M, "sup"));
      return (
        op +
        (sub && attribute(child(pr, M, "subHide"), M, "val") !== "1"
          ? `_{${sub}}`
          : "") +
        (sup && attribute(child(pr, M, "supHide"), M, "val") !== "1"
          ? `^{${sup}}`
          : "") +
        `{${e()}}`
      );
    }
    if (name === "limLow" || name === "limUpp") {
      const base = e(),
        lim = group(child(el, M, "lim"));
      if (["lim", "max", "min", "sup", "inf"].includes(base))
        return `\\${base}${name === "limLow" ? "_" : "^"}{${lim}}`;
      return `\\${name === "limLow" ? "underset" : "overset"}{${lim}}{${base}}`;
    }
    if (name === "m") {
      const rows = children(el, M, "mr");
      if (!rows.length) throw new Error("Empty OMML matrix.");
      const widths = rows.map((row) => children(row, M, "e").length);
      if (
        widths.some((n) => n !== widths[0]) ||
        widths[0] > 50 ||
        rows.length > 100
      )
        throw new Error("Invalid OMML matrix dimensions.");
      return `\\begin{matrix}${rows.map((row) => children(row, M, "e").map(group).join(" & ")).join(" \\\\ ")}\\end{matrix}`;
    }
    if (name === "d") {
      const pr = child(el, M, "dPr"),
        beg = child(pr, M, "begChr"),
        end = child(pr, M, "endChr"),
        sep = attribute(child(pr, M, "sepChr"), M, "val") || "|";
      const begin = beg ? attribute(beg, M, "val") : "(",
        finish = end ? attribute(end, M, "val") : ")";
      if (
        !["(", "[", "{", "|", "‖", "⟨", ""].includes(begin) ||
        ![")", "]", "}", "|", "‖", "⟩", ""].includes(finish)
      )
        throw new Error("Unsupported OMML delimiter.");
      return `\\left${delim(begin)}${children(el, M, "e")
        .map(group)
        .join(`\\middle${delim(sep)}`)}\\right${delim(finish)}`;
    }
    if (name === "acc") {
      const chr =
        attribute(child(child(el, M, "accPr"), M, "chr"), M, "val") || "̂";
      const cmd = (
        {
          "⃗": "vec",
          "̂": "hat",
          "̄": "bar",
          "̃": "tilde",
          "̇": "dot",
          "̈": "ddot",
        } as Record<string, string>
      )[chr];
      if (!cmd) throw new Error(`Unsupported OMML accent ${chr}.`);
      return `\\${cmd}{${e()}}`;
    }
    if (name === "bar")
      return `\\${attribute(child(child(el, M, "barPr"), M, "pos"), M, "val") === "bot" ? "underline" : "overline"}{${e()}}`;
    if (name === "eqArr")
      return `\\begin{aligned}${children(el, M, "e").map(group).join(" \\\\ ")}\\end{aligned}`;
    if (name === "func") {
      const fn = group(child(el, M, "fName")),
        arg = e();
      return `${["sin", "cos", "tan", "log", "ln", "exp", "det", "gcd", "arcsin", "arccos", "arctan"].includes(fn) ? `\\${fn}` : `\\operatorname{${fn}}`}{${arg}}`;
    }
    if (name === "groupChr") {
      const pr = child(el, M, "groupChrPr"),
        chr = attribute(child(pr, M, "chr"), M, "val"),
        pos = attribute(child(pr, M, "pos"), M, "val");
      if (chr === "⏞" || chr === "⏟")
        return `\\${pos === "bot" ? "underbrace" : "overbrace"}{${e()}}`;
      throw new Error("Unsupported OMML group character.");
    }
    throw new Error(`Unsupported OMML construct ${name}.`);
  }
  try {
    const source = convert(root);
    if (!source || source.length > 4000)
      throw new Error("Empty or oversized converted equation.");
    return { status: "editable", source, original };
  } catch (error) {
    return {
      status: "unsupported",
      source: "",
      original,
      reason:
        error instanceof Error
          ? error.message
          : "Unsupported equation structure.",
    };
  }
}
