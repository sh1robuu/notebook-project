import { useRef, useSyncExternalStore } from "react";
import type { BoardEngine, BoardTool } from "../modules/board/engine.ts";
import { Icon } from "./Icon.tsx";
import { ObjectProperties } from "./ObjectProperties.tsx";
const tools = [
  ["draw", "pen", "Pen", "P"],
  ["highlight", "highlight", "Highlighter", "Shift+P"],
  ["eraser", "erase", "Whole stroke eraser", "E"],
  ["partial_eraser", "partial", "Partial eraser", "Shift+E"],
  ["hand", "hand", "Pan", "H"],
] as const;
const colors = [
  ["black", "Black", "#182127"],
  ["blue", "Blue", "#2463b5"],
  ["red", "Red", "#c13d45"],
  ["green", "Green", "#27825b"],
  ["orange", "Orange", "#c07422"],
  ["yellow", "Yellow", "#e4bd2a"],
] as const;
const widths = [
  ["s", "Fine", 2],
  ["m", "Medium", 3],
  ["l", "Bold", 5],
  ["xl", "Broad", 8],
] as const;
export function Toolbar({ engine }: { engine: BoardEngine }) {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const editing = useSyncExternalStore(
      engine.editing.subscribe,
      engine.editing.getSnapshot,
    ),
    file = useRef<HTMLInputElement>(null);
  return (
    <aside className="palette" aria-label="Drawing controls">
      <div className="tool-list" role="group" aria-label="Drawing tools">
        <button
          className="tool"
          aria-label="Select"
          aria-pressed={state.tool === "select"}
          onClick={() => engine.setTool("select")}
        >
          <Icon name="select" />
          <span>Select</span>
          <kbd>V</kbd>
        </button>
        {tools.map(([tool, icon, label, key]) => (
          <button
            key={tool}
            type="button"
            className="tool"
            aria-label={label}
            aria-pressed={state.tool === tool}
            disabled={state.readOnly && tool !== "hand"}
            title={`${label} (${key})`}
            onClick={() => engine.setTool(tool as BoardTool)}
          >
            <Icon name={icon} />
            <span>
              {tool === "eraser"
                ? "Stroke"
                : tool === "partial_eraser"
                  ? "Partial"
                  : label}
            </span>
            <kbd>
              {key === "Shift+P" ? "⇧P" : key === "Shift+E" ? "⇧E" : key}
            </kbd>
          </button>
        ))}
        <button
          className="tool"
          aria-label="Shapes"
          aria-pressed={["geo", "line", "arrow"].includes(state.tool)}
          disabled={state.readOnly}
          onClick={() => engine.setTool("geo")}
        >
          <Icon name="shapes" />
          <span>Shapes</span>
        </button>
        <button
          className="tool"
          aria-label="Text"
          aria-pressed={state.tool === "text"}
          disabled={state.readOnly}
          onClick={() => engine.setTool("text")}
        >
          <Icon name="text" />
          <span>Text</span>
          <kbd>T</kbd>
        </button>
        <button
          className="tool"
          aria-label="Equation"
          disabled={state.readOnly}
          onClick={() => engine.editing.newEquation()}
        >
          <Icon name="equation" />
          <span>Equation</span>
        </button>
        <button
          className="tool"
          aria-label="Import image"
          disabled={state.readOnly || editing.busy}
          onClick={() => file.current?.click()}
        >
          <Icon name="image" />
          <span>Image</span>
        </button>
      </div>
      <input
        hidden
        ref={file}
        type="file"
        multiple
        accept="image/png,image/jpeg"
        aria-label="Local images"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void engine.editing.importImages(files);
        }}
      />
      {["geo", "line", "arrow"].includes(state.tool) ? (
        <div className="shape-choices" role="group" aria-label="Basic shapes">
          {(
            ["rectangle", "ellipse", "triangle", "pentagon", "hexagon"] as const
          ).map((geo) => (
            <button key={geo} onClick={() => engine.editing.geo(geo)}>
              {geo[0].toUpperCase() + geo.slice(1)}
            </button>
          ))}
          <button onClick={() => engine.setTool("line")}>Line</button>
          <button onClick={() => engine.setTool("arrow")}>Arrow</button>
        </div>
      ) : null}
      <label className="snap-control">
        <input
          type="checkbox"
          checked={editing.snap}
          onChange={(e) => engine.editing.setSnap(e.target.checked)}
        />{" "}
        Snapping
      </label>
      <ObjectProperties engine={engine} />
      {editing.message ? (
        <p role="status" className="editing-message">
          {editing.message}
        </p>
      ) : null}
      <div
        className="history-controls"
        role="group"
        aria-label="Drawing history"
      >
        <button
          aria-label="Undo"
          title="Undo (Ctrl/Cmd+Z)"
          disabled={!state.canUndo || state.readOnly}
          onClick={() => engine.undo()}
        >
          <Icon name="undo" />
          <span>Undo</span>
        </button>
        <button
          aria-label="Redo"
          title="Redo (Ctrl/Cmd+Shift+Z)"
          disabled={!state.canRedo || state.readOnly}
          onClick={() => engine.redo()}
        >
          <Icon name="redo" />
          <span>Redo</span>
        </button>
      </div>
      <fieldset className="ink-colors" disabled={state.readOnly}>
        <legend>Ink color</legend>
        <div className="swatches">
          {colors.map(([color, label, hex]) => (
            <button
              key={color}
              aria-label={`${label} ink`}
              title={`${label} ink`}
              aria-pressed={state.color === color}
              style={{ "--swatch": hex } as React.CSSProperties}
              onClick={() => engine.setColor(color)}
            >
              <span className="swatch-dot" />
              {state.color === color ? (
                <span className="swatch-selected" />
              ) : null}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="ink-widths" disabled={state.readOnly}>
        <legend>Stroke width</legend>
        <div className="widths">
          {widths.map(([size, label, width]) => (
            <button
              key={size}
              aria-label={`${label} width`}
              title={`${label} width`}
              aria-pressed={state.size === size}
              onClick={() => engine.setSize(size)}
            >
              <span style={{ height: width }} />
            </button>
          ))}
        </div>
        <select
          className="width-select"
          aria-label="Stroke width"
          value={state.size}
          onChange={(e) => engine.setSize(e.target.value as typeof state.size)}
        >
          {widths.map(([size, label]) => (
            <option key={size} value={size}>
              {label} stroke
            </option>
          ))}
        </select>
      </fieldset>
      <label className="touch-control">
        <span>Touch behavior</span>
        <select
          aria-label="Touch behavior"
          value={state.touchMode}
          onChange={(e) =>
            engine.setTouchMode(e.target.value as "pan" | "write")
          }
        >
          <option value="pan">Touch to navigate</option>
          <option value="write">Touch to write</option>
        </select>
      </label>
      <div className="palette-note">
        <span className="note-rule" />
        <p>Saved here. Download a lesson file to keep a separate copy.</p>
        <p className="secondary">
          Hold Space to pan.
          <br />
          Pinch or use the zoom controls.
        </p>
      </div>
    </aside>
  );
}
