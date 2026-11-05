import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  BlockFormat,
  DocumentBlock,
  DocumentInline,
  DocumentModel,
  EquationInline,
  ImageInline,
} from "../../modules/documents/model.ts";
import { validateDocument } from "../../modules/documents/model.ts";
import type { DocumentSources } from "../../modules/documents/sources.ts";
import {
  loadWordMath,
  wordMath,
  useWordMath,
} from "../../modules/documents/math-loader.ts";

type Props = {
  active: boolean;
  block: DocumentBlock;
  document: DocumentModel;
  sources: DocumentSources;
  onApply: (block: DocumentBlock) => void;
};

/** Local source edit: the compiled/draft model changes only after validation. */
export function BlockEditor({
  active,
  block,
  document,
  sources,
  onApply,
}: Props) {
  const [draft, setDraft] = useState(() => structuredClone(block));
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const operation = useRef(0);
  useLayoutEffect(() => {
    operation.current++;
    setApplying(false);
    return () => {
      operation.current++;
    };
  }, [active, block, document, sources]);
  const ordinals = useMemo(() => {
    const out = new Map<string, number>();
    const visit = (b: DocumentBlock) => {
      if (b.kind === "paragraph")
        for (const inline of b.inlines)
          if (inline.kind === "equation") out.set(inline.id, out.size + 1);
      if (b.kind === "table")
        for (const row of b.rows)
          for (const cell of row.cells) cell.blocks.forEach(visit);
    };
    visit(block);
    return out;
  }, [block]);
  async function apply() {
    if (!active || applying) return;
    const current = ++operation.current;
    setApplying(true);
    try {
      if (ordinals.size) await loadWordMath();
      if (operation.current !== current) return;
      const check = (b: DocumentBlock) => {
        if (b.kind === "paragraph")
          for (const inline of b.inlines)
            if (inline.kind === "equation" && inline.status === "editable") {
              const result = wordMath(inline.source);
              if (result.error)
                throw new Error(
                  `Equation ${ordinals.get(inline.id)} is invalid. Revert or correct its source before applying. ${result.error}`,
                );
            }
        if (b.kind === "table")
          for (const row of b.rows)
            for (const cell of row.cells) cell.blocks.forEach(check);
      };
      check(draft);
      const replace = (blocks: DocumentBlock[]): DocumentBlock[] =>
        blocks.map((b) =>
          b.id === draft.id
            ? draft
            : b.kind === "table"
              ? {
                  ...b,
                  rows: b.rows.map((row) => ({
                    cells: row.cells.map((cell) => ({
                      ...cell,
                      blocks: replace(cell.blocks),
                    })),
                  })),
                }
              : b,
        );
      validateDocument(
        {
          ...document,
          blocks: replace(document.blocks),
          sections: document.sections.map((section) => ({
            ...section,
            header: replace(section.header),
            footer: replace(section.footer),
          })),
        },
        sources,
      );
      onApply(structuredClone(draft));
      setError("");
    } catch (cause) {
      if (operation.current === current)
        setError(cause instanceof Error ? cause.message : "Block edit failed.");
    } finally {
      if (operation.current === current) setApplying(false);
    }
  }
  return (
    <section className="word-block-editor" aria-label="Block source editor">
      <BlockFields
        value={draft}
        original={block}
        ordinals={ordinals}
        onChange={(next) => {
          operation.current++;
          setApplying(false);
          setDraft(next);
        }}
        path="Block"
      />
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" disabled={!active || applying} onClick={apply}>
        {applying ? "Checking equation…" : "Apply block edit"}
      </button>
      <button
        type="button"
        onClick={() => {
          operation.current++;
          setApplying(false);
          setDraft(structuredClone(block));
          setError("");
        }}
      >
        Revert block edits
      </button>
    </section>
  );
}

function FormatFields({
  format,
  onChange,
  path,
}: {
  format: BlockFormat;
  onChange: (format: BlockFormat) => void;
  path: string;
}) {
  return (
    <fieldset>
      <legend>{path} formatting</legend>
      <label>
        Font family
        <input
          aria-label={`${path} font family`}
          value={format.fontFamily ?? "Arial"}
          maxLength={100}
          onChange={(ev) =>
            onChange({ ...format, fontFamily: ev.target.value })
          }
        />
      </label>
      <label>
        Font size
        <input
          aria-label={`${path} font size`}
          type="number"
          min={6}
          max={144}
          value={format.fontSize ?? 24}
          onChange={(ev) =>
            onChange({ ...format, fontSize: ev.target.valueAsNumber })
          }
        />
      </label>
      {(["bold", "italic", "underline"] as const).map((key) => (
        <label key={key}>
          <input
            aria-label={`${path} ${key}`}
            type="checkbox"
            checked={format[key] ?? false}
            onChange={(ev) => onChange({ ...format, [key]: ev.target.checked })}
          />
          {key}
        </label>
      ))}
      <label>
        Alignment
        <select
          aria-label={`${path} alignment`}
          value={format.align ?? "left"}
          onChange={(ev) =>
            onChange({
              ...format,
              align: ev.target.value as BlockFormat["align"],
            })
          }
        >
          {(["left", "center", "right", "justify"] as const).map((align) => (
            <option key={align}>{align}</option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

type FieldsProps = {
  value: DocumentBlock;
  original: DocumentBlock;
  ordinals: Map<string, number>;
  onChange: (block: DocumentBlock) => void;
  path: string;
};

function BlockFields({
  value,
  original,
  ordinals,
  onChange,
  path,
}: FieldsProps) {
  const body = (() => {
    if (value.kind === "paragraph") {
      const plain = value.inlines.every((inline) => inline.kind === "text");
      const inlineChange = (next: DocumentInline) =>
        onChange({
          ...value,
          inlines: value.inlines.map((inline) =>
            inline.id === next.id ? next : inline,
          ),
        });
      return plain ? (
        <>
          <label>
            Paragraph text
            <textarea
              aria-label={
                path === "Block" ? "Paragraph text" : `${path} paragraph text`
              }
              rows={4}
              maxLength={100000}
              value={value.inlines
                .map((inline) => (inline.kind === "text" ? inline.text : ""))
                .join("")}
              onChange={(ev) => {
                const first = value.inlines[0];
                onChange({
                  ...value,
                  inlines: [
                    {
                      id: first?.id ?? `inline:${crypto.randomUUID()}`,
                      kind: "text",
                      text: ev.target.value,
                      format: first?.kind === "text" ? first.format : {},
                    },
                  ],
                });
              }}
            />
          </label>
          {value.inlines.length > 1 ? (
            <p>
              Replacing combined paragraph text uses the first text run's
              formatting. Original source remains available.
            </p>
          ) : null}
        </>
      ) : (
        <div>
          {value.inlines.map((inline, index) => {
            const originalInline =
              original.kind === "paragraph"
                ? original.inlines.find((i) => i.id === inline.id)
                : undefined;
            if (inline.kind === "text")
              return (
                <label key={inline.id}>
                  Text run {index + 1}
                  <textarea
                    aria-label={`${path} text run ${index + 1}`}
                    rows={2}
                    maxLength={100000}
                    value={inline.text}
                    onChange={(ev) =>
                      inlineChange({ ...inline, text: ev.target.value })
                    }
                  />
                </label>
              );
            if (inline.kind === "equation")
              return (
                <EquationFields
                  key={inline.id}
                  value={inline}
                  original={
                    originalInline?.kind === "equation"
                      ? originalInline
                      : inline
                  }
                  number={ordinals.get(inline.id) ?? index + 1}
                  onChange={inlineChange}
                />
              );
            return (
              <ImageFields
                key={inline.id}
                value={inline}
                path={`${path} image ${index + 1}`}
                onChange={inlineChange}
              />
            );
          })}
        </div>
      );
    }
    if (value.kind === "table")
      return (
        <div>
          <p>
            Cell edits retain the source rows, merged spans and nested table
            identities.
          </p>
          {value.rows.map((row, rowIndex) =>
            row.cells.map((cell, cellIndex) => (
              <fieldset key={`${rowIndex}:${cellIndex}`}>
                <legend>
                  Row {rowIndex + 1}, cell {cellIndex + 1} ({cell.colSpan}{" "}
                  columns × {cell.rowSpan} rows)
                </legend>
                {cell.blocks.map((nested, blockIndex) => (
                  <BlockFields
                    key={nested.id}
                    value={nested}
                    original={
                      original.kind === "table"
                        ? (original.rows[rowIndex]?.cells[cellIndex]?.blocks[
                            blockIndex
                          ] ?? nested)
                        : nested
                    }
                    ordinals={ordinals}
                    path={`${path} row ${rowIndex + 1} cell ${cellIndex + 1} block ${blockIndex + 1}`}
                    onChange={(next) =>
                      onChange({
                        ...value,
                        rows: value.rows.map((r, ri) =>
                          ri === rowIndex
                            ? {
                                cells: r.cells.map((c, ci) =>
                                  ci === cellIndex
                                    ? {
                                        ...c,
                                        blocks: c.blocks.map((b) =>
                                          b.id === next.id ? next : b,
                                        ),
                                      }
                                    : c,
                                ),
                              }
                            : r,
                        ),
                      })
                    }
                  />
                ))}
              </fieldset>
            )),
          )}
        </div>
      );
    if (value.kind === "image")
      return (
        <ImageFields
          value={value}
          path={path}
          onChange={(next) => onChange({ ...value, ...next })}
        />
      );
    return (
      <div role="note">
        <strong>{value.label}</strong>
        <p>{value.reason}</p>
        <p>
          The original source is retained. Convert the affected object in Word
          or supply a safe PNG/JPEG preview and reimport; this placeholder is
          not editable mathematical content.
        </p>
      </div>
    );
  })();
  return (
    <div>
      {body}
      {value.kind !== "unsupported" ? (
        <FormatFields
          path={path}
          format={value.format}
          onChange={(format) => {
            if (value.kind !== "paragraph") {
              onChange({ ...value, format });
              return;
            }
            const changed = Object.fromEntries(
              Object.entries(format).filter(
                ([key, next]) =>
                  [
                    "fontFamily",
                    "fontSize",
                    "color",
                    "highlight",
                    "bold",
                    "italic",
                    "underline",
                  ].includes(key) &&
                  value.format[key as keyof BlockFormat] !== next,
              ),
            );
            onChange({
              ...value,
              format,
              inlines: value.inlines.map((inline) =>
                inline.kind === "text"
                  ? { ...inline, format: { ...inline.format, ...changed } }
                  : inline,
              ),
            });
          }}
        />
      ) : null}
      <details>
        <summary>Original source location</summary>
        <p>
          {value.provenance.part} · {value.provenance.path}
        </p>
        {value.provenance.xml ? <pre>{value.provenance.xml}</pre> : null}
      </details>
    </div>
  );
}

function EquationFields({
  value,
  original,
  number,
  onChange,
}: {
  value: EquationInline;
  original: EquationInline;
  number: number;
  onChange: (equation: EquationInline) => void;
}) {
  const result = useWordMath(value.source);
  return (
    <fieldset>
      <legend>
        Equation {number} · {value.encoding} · {value.status}
      </legend>
      {value.status === "editable" ? (
        <>
          <label>
            LaTeX equation {number}
            <textarea
              aria-label={`LaTeX equation ${number}`}
              value={value.source}
              rows={3}
              maxLength={4000}
              spellCheck={false}
              onChange={(ev) => onChange({ ...value, source: ev.target.value })}
            />
          </label>
          {result?.error ? (
            <p role="alert">{result.error}</p>
          ) : result?.html ? (
            <div
              className="word-equation-preview"
              aria-label={`Equation ${number} preview`}
              dangerouslySetInnerHTML={{ __html: result.html }}
            />
          ) : null}
          <button
            type="button"
            onClick={() => onChange({ ...value, source: original.source })}
          >
            Revert equation {number}
          </button>
        </>
      ) : (
        <p>
          Editable conversion is unavailable. The original representation and
          available visual fallback remain retained. Convert this equation with
          an authorized Word/MathType workflow, then reimport.
        </p>
      )}
      <details>
        <summary>Original equation representation</summary>
        <pre>{value.original}</pre>
      </details>
    </fieldset>
  );
}

function ImageFields<
  T extends ImageInline | (DocumentBlock & { kind: "image" }),
>({
  value,
  path,
  onChange,
}: {
  value: T;
  path: string;
  onChange: (image: T) => void;
}) {
  const [linked, setLinked] = useState(true);
  const dimension = (axis: "width" | "height", n: number) => {
    const other = axis === "width" ? "height" : "width";
    onChange({
      ...value,
      [axis]: n,
      ...(linked ? { [other]: (n * value[other]) / value[axis] } : {}),
    });
  };
  return (
    <fieldset>
      <legend>{path}</legend>
      <label>
        Description
        <input
          aria-label={`${path} description`}
          value={value.alt}
          maxLength={500}
          onChange={(ev) => onChange({ ...value, alt: ev.target.value })}
        />
      </label>
      {(["width", "height"] as const).map((axis) => (
        <label key={axis}>
          {axis}
          <input
            aria-label={`${path} ${axis}`}
            type="number"
            min={1}
            max={10000}
            value={value[axis]}
            onChange={(ev) => dimension(axis, ev.target.valueAsNumber)}
          />
        </label>
      ))}
      <label>
        <input
          type="checkbox"
          checked={linked}
          onChange={(ev) => setLinked(ev.target.checked)}
        />
        Keep image aspect ratio
      </label>
      {value.floating ? (
        <p>
          Source floating position is retained in provenance; teaching layout
          uses document flow.
        </p>
      ) : null}
    </fieldset>
  );
}
