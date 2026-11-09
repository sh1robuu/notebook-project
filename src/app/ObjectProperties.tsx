import { useState, useSyncExternalStore } from "react";
import type { BoardEngine } from "../modules/board/engine.ts";
import type { TLDefaultFontStyle, TLDefaultFillStyle } from "tldraw";
export function ObjectProperties({ engine }: { engine: BoardEngine }) {
  const c = engine.editing,
    state = useSyncExternalStore(c.subscribe, c.getSnapshot),
    [lock, setLock] = useState(true),
    selected = state.selected,
    single = selected.length === 1 ? selected[0] : null,
    bounds = c.bounds();
  if (!selected.length && !state.isTextEditing) return null;
  const text = single?.type === "text" ? single : null;
  return (
    <section className="object-properties" aria-label="Object properties">
      <h2>
        {selected.length === 1
          ? `${single!.type === "geo" ? single!.props.geo : single!.type} properties`
          : `${selected.length} selected`}
      </h2>
      <div className="object-actions">
        <button onClick={() => c.duplicate()} aria-label="Duplicate">
          Duplicate
        </button>
        <button onClick={() => c.delete()} aria-label="Delete">
          Delete
        </button>
        {selected.length > 1 ? (
          <button onClick={() => c.group()}>Group</button>
        ) : null}
        {single?.type === "group" ? (
          <button onClick={() => c.ungroup()}>Ungroup</button>
        ) : null}
      </div>
      {bounds ? (
        <div className="geometry-fields">
          {(
            [
              ["x", "Position X", bounds.x],
              ["y", "Position Y", bounds.y],
              ["w", "Object width", bounds.w],
              ["h", "Object height", bounds.h],
              [
                "rotation",
                "Rotation degrees",
                single ? (single.rotation * 180) / Math.PI : 0,
              ],
            ] as const
          ).map(([key, label, value]) => (
            <NumberField
              key={`${selected.map((s) => s.id).join()}:${key}:${value}`}
              label={label}
              value={value}
              commit={(n) => c.geometry(key, n, lock)}
            />
          ))}
        </div>
      ) : null}
      {selected.some((s) => s.type === "image") ? (
        <label>
          <input
            type="checkbox"
            checked={lock}
            onChange={(e) => setLock(e.target.checked)}
          />{" "}
          Keep image aspect ratio
        </label>
      ) : null}
      <label>
        Opacity
        <select
          aria-label="Object opacity"
          value={single?.opacity ?? 1}
          onChange={(e) => c.setOpacity(Number(e.target.value))}
        >
          {[1, 0.75, 0.5, 0.25].map((v) => (
            <option key={v} value={v}>
              {v * 100}%
            </option>
          ))}
        </select>
      </label>
      {selected.some((s) => s.type === "geo") ? (
        <>
          <label>
            Fill
            <select
              aria-label="Shape fill"
              value={single?.type === "geo" ? single.props.fill : "none"}
              onChange={(e) => c.setFill(e.target.value as TLDefaultFillStyle)}
            >
              <option value="none">None</option>
              <option value="solid">Solid</option>
              <option value="semi">Light</option>
              <option value="pattern">Pattern</option>
            </select>
          </label>
          <label>
            Fill color
            <input
              aria-label="Fill color"
              type="color"
              defaultValue={String(single?.meta.fillColor ?? "#e1f0ec")}
              onChange={(e) => c.setFillColor(e.target.value)}
            />
          </label>
        </>
      ) : null}
      {text || state.isTextEditing ? (
        <>
          <div
            className="format-controls"
            role="group"
            aria-label="Text formatting"
          >
            {(["bold", "italic", "underline", "highlight"] as const).map(
              (mark) => (
                <button
                  key={mark}
                  aria-label={
                    mark === "highlight"
                      ? "Text background"
                      : `${mark[0].toUpperCase() + mark.slice(1)} text`
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => c.format(mark)}
                >
                  {mark === "bold"
                    ? "B"
                    : mark === "italic"
                      ? "I"
                      : mark === "underline"
                        ? "U"
                        : "Mark"}
                </button>
              ),
            )}
          </div>
          <label>
            Font family
            <select
              aria-label="Font family"
              value={text?.props.font ?? "sans"}
              onChange={(e) => c.setFont(e.target.value as TLDefaultFontStyle)}
            >
              <option value="sans">Sans serif</option>
              <option value="serif">Serif</option>
              <option value="mono">Monospace</option>
              <option value="draw">Handwriting</option>
            </select>
          </label>
          <NumberField
            key={`font:${text?.props.scale}:${text?.props.size}`}
            label="Font size"
            value={
              text
                ? { s: 18, m: 24, l: 36, xl: 44 }[text.props.size] *
                  text.props.scale
                : 24
            }
            commit={(v) => c.setFontSize(v)}
          />
          <label>
            Alignment
            <select
              aria-label="Text alignment"
              value={text?.props.textAlign ?? "start"}
              onChange={(e) =>
                c.setTextAlign(e.target.value as "start" | "middle" | "end")
              }
            >
              <option value="start">Left</option>
              <option value="middle">Center</option>
              <option value="end">Right</option>
            </select>
          </label>
        </>
      ) : null}
      {single?.type === "math-figure" ? (
        <button onClick={() => c.editMathFigure()}>Edit math figure</button>
      ) : null}
      {single?.type === "equation" ? (
        <button onClick={() => c.editEquation()} aria-label="Edit equation">
          Edit equation
        </button>
      ) : null}
      {single?.type === "draw" ? (
        <button onClick={() => c.straighten()}>Straighten ink</button>
      ) : null}
      {selected.length > 1 ? (
        <div className="object-actions">
          <button onClick={() => c.align("left")}>Align left</button>
          <button onClick={() => c.align("top")}>Align top</button>
        </div>
      ) : null}
      <p className="property-note">
        Shift-click adds or removes objects. Alt-drag selects with a freeform
        brush. Shift constrains native transforms.
      </p>
    </section>
  );
}
function NumberField({
  label,
  value,
  commit,
}: {
  label: string;
  value: number;
  commit: (n: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        step="any"
        defaultValue={Math.round(value * 100) / 100}
        onBlur={(e) => {
          if (
            e.currentTarget.value.trim() &&
            Number(e.currentTarget.value) !== value
          )
            commit(Number(e.currentTarget.value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
