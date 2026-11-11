import { useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ComponentProps } from "react";
import type { BoardEngine } from "../modules/board/engine.ts";
import { Icon } from "./Icon.tsx";
import { ObjectProperties } from "./ObjectProperties.tsx";
import { MathTools } from "./math/MathTools.tsx";
import { InteractiveTools } from "./interactive/InteractiveTools.tsx";
import { AdaptiveTools } from "./ToolDisclosures.tsx";
import { ScratchpadControls } from "./ScratchpadPane.tsx";

const drawingTools = [
  ["select", "select", "Select", "V"],
  ["draw", "pen", "Pen", "P"],
  ["highlight", "highlight", "Highlighter", "Shift+P"],
  ["eraser", "erase", "Whole stroke eraser", "E"],
  ["partial_eraser", "partial", "Partial eraser", "Shift+E"],
  ["hand", "hand", "Pan", "H"],
] as const;
const primaryColors = [
  ["black", "Black", "#182127"],
  ["blue", "Blue", "#2463b5"],
  ["red", "Red", "#c13d45"],
  ["green", "Green", "#27825b"],
  ["orange", "Orange", "#c07422"],
  ["yellow", "Yellow", "#e4bd2a"],
] as const;
const extraColors = [
  ["violet", "Violet", "#7945be"],
  ["light-violet", "Light violet", "#b886e9"],
  ["light-blue", "Light blue", "#4b9fe9"],
  ["light-green", "Light green", "#5cb973"],
  ["light-red", "Light red", "#e58188"],
  ["grey", "Grey", "#73777f"],
  ["white", "White", "#ffffff"],
] as const;
const widths = [
  ["s", "Fine", 3],
  ["m", "Medium", 7],
  ["l", "Bold", 11],
  ["xl", "Broad", 15],
] as const;
const shapes = [
  "rectangle",
  "ellipse",
  "triangle",
  "pentagon",
  "hexagon",
] as const;
type InkColor = (typeof primaryColors)[number] | (typeof extraColors)[number];
type IconName = ComponentProps<typeof Icon>["name"];

export function Toolbar({ engine }: { engine: BoardEngine }) {
  const tool = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().tool,
  );
  const readOnly = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().readOnly,
  );
  const editing = engine.editing;
  const math = useSyncExternalStore(
    editing.subscribe,
    () => editing.getSnapshot().mathPanel,
  );
  const busy = useSyncExternalStore(
    editing.subscribe,
    () => editing.getSnapshot().busy,
  );
  const file = useRef<HTMLInputElement>(null);
  return (
    <aside className="drawing-bar" aria-label="Drawing controls">
      <div className="draw-group" role="group" aria-label="Drawing tools">
        {drawingTools.map(([id, icon, label, key]) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            title={label + " (" + key + ")"}
            aria-pressed={tool === id}
            disabled={readOnly && id !== "hand" && id !== "select"}
            onClick={() => engine.setTool(id)}
          >
            <Icon name={icon} />
          </button>
        ))}
      </div>
      <AdaptiveTools label="Ink and teaching tools" className="drawing-extra">
        <InkControls engine={engine} readOnly={readOnly} />
        <div
          className="draw-group teaching-tools"
          role="group"
          aria-label="Insert and teaching tools"
        >
          <Shapes engine={engine} tool={tool} readOnly={readOnly} />
          <ToolButton
            label="Text"
            tooltip="Text (T)"
            icon="text"
            pressed={tool === "text"}
            disabled={readOnly}
            action={() => engine.setTool("text")}
          />
          <ToolButton
            label="Equation"
            icon="equation"
            disabled={readOnly}
            action={() => editing.newEquation()}
          />
          <ToolButton
            label="Import image"
            icon="image"
            disabled={readOnly || busy}
            action={() => file.current?.click()}
          />
        </div>
        <div
          className="draw-group teaching-tools"
          role="group"
          aria-label="Math and simulations"
        >
          <MathTools engine={engine} request={math} readOnly={readOnly} />
          <InteractiveTools
            key={engine.surface + ":" + engine.editorEpoch}
            engine={engine}
            canInsert={!readOnly}
          />
        </div>
        <DrawingSettings engine={engine} />
      </AdaptiveTools>
      <div className="draw-group scratch-command">
        <ScratchpadControls session={engine.session} section="toggle" />
      </div>
      <SelectionInspector engine={engine} />
      <input
        hidden
        ref={file}
        type="file"
        multiple
        accept="image/png,image/jpeg"
        aria-label="Local images"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void editing.importImages(files);
        }}
      />
    </aside>
  );
}

function ToolButton({
  icon,
  label,
  tooltip = label,
  pressed,
  disabled,
  action,
}: {
  icon: IconName;
  label: string;
  tooltip?: string;
  pressed?: boolean;
  disabled?: boolean;
  action: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={tooltip}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={action}
    >
      <Icon name={icon} />
    </button>
  );
}
function Shapes({
  engine,
  tool,
  readOnly,
}: {
  engine: BoardEngine;
  tool: ReturnType<BoardEngine["getSnapshot"]>["tool"];
  readOnly: boolean;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  return (
    <details
      className="tool-disclosure shapes-disclosure"
      data-tool-disclosure
      ref={disclosure}
    >
      <summary
        role="button"
        aria-label="Shapes"
        className="chrome-control"
        title="Shapes"
        aria-pressed={["geo", "line", "arrow"].includes(tool)}
        onClick={() => {
          if (
            !disclosure.current?.open &&
            !readOnly &&
            !["geo", "line", "arrow"].includes(tool)
          )
            engine.setTool("geo");
        }}
      >
        <Icon name="shapes" />
        <Icon name="chevron" />
      </summary>
      <div
        className="tool-flyout shape-choices"
        role="group"
        aria-label="Basic shapes"
      >
        {shapes.map((shape) => (
          <button
            key={shape}
            type="button"
            disabled={readOnly}
            onClick={() => {
              engine.editing.geo(shape);
              if (disclosure.current) disclosure.current.open = false;
            }}
          >
            {shape[0].toUpperCase() + shape.slice(1)}
          </button>
        ))}
        {(["line", "arrow"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={readOnly}
            onClick={() => {
              engine.setTool(kind);
              if (disclosure.current) disclosure.current.open = false;
            }}
          >
            {kind[0].toUpperCase() + kind.slice(1)}
          </button>
        ))}
      </div>
    </details>
  );
}
function InkControls({
  engine,
  readOnly,
}: {
  engine: BoardEngine;
  readOnly: boolean;
}) {
  const activeColor = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().color,
  );
  const activeSize = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().size,
  );
  const extra = useRef<HTMLDetailsElement>(null);
  const selection = [...primaryColors, ...extraColors].find(
    ([color]) => color === activeColor,
  );
  const colorButton = ([color, label, hex]: InkColor, more = false) => (
    <button
      key={color}
      type="button"
      className="ink-swatch"
      aria-label={label + " ink"}
      title={label + " ink"}
      aria-pressed={activeColor === color}
      style={{ "--swatch": hex } as CSSProperties}
      onClick={() => {
        engine.setColor(color);
        if (more && extra.current) {
          extra.current.open = false;
          extra.current.querySelector("summary")?.focus();
        }
      }}
    >
      <span aria-hidden="true" />
    </button>
  );
  return (
    <div className="draw-group ink-controls">
      <fieldset className="ink-palette" disabled={readOnly}>
        <legend className="sr-only">Ink color</legend>
        {primaryColors.map((color) => colorButton(color))}
        <details
          className="tool-disclosure extra-ink"
          data-tool-disclosure
          ref={extra}
        >
          <summary
            className="chrome-control"
            title="More ink colors"
            aria-label="More ink colors"
            style={{ "--swatch": selection?.[2] } as CSSProperties}
          >
            <span className="current-swatch" aria-hidden="true" />
            <Icon name="chevron" />
          </summary>
          <div className="tool-flyout extra-swatches">
            {extraColors.map((color) => colorButton(color, true))}
          </div>
        </details>
      </fieldset>
      <fieldset className="ink-sizes" disabled={readOnly}>
        <legend className="sr-only">Stroke width</legend>
        {widths.map(([size, label, diameter]) => (
          <button
            key={size}
            type="button"
            aria-label={label + " width"}
            title={label + " width"}
            aria-pressed={activeSize === size}
            onClick={() => engine.setSize(size)}
          >
            <span
              aria-hidden="true"
              style={{ inlineSize: diameter, blockSize: diameter }}
            />
          </button>
        ))}
      </fieldset>
    </div>
  );
}
function DrawingSettings({ engine }: { engine: BoardEngine }) {
  const snap = useSyncExternalStore(
    engine.editing.subscribe,
    () => engine.editing.getSnapshot().snap,
  );
  const touchMode = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().touchMode,
  );
  return (
    <details className="tool-disclosure drawing-settings" data-tool-disclosure>
      <summary
        className="chrome-control"
        role="button"
        aria-label="Drawing settings"
        title="Drawing settings"
      >
        <Icon name="settings" />
        <span className="sr-only">Drawing settings</span>
      </summary>
      <div className="tool-flyout">
        <label className="snap-control">
          <input
            type="checkbox"
            checked={snap}
            onChange={(event) => engine.editing.setSnap(event.target.checked)}
          />{" "}
          Snapping
        </label>
        <label className="touch-setting">
          Touch behavior
          <select
            value={touchMode}
            onChange={(event) =>
              engine.setTouchMode(
                event.target.value === "write" ? "write" : "pan",
              )
            }
          >
            <option value="pan">Touch to navigate</option>
            <option value="write">Touch to write</option>
          </select>
        </label>
      </div>
    </details>
  );
}
function SelectionInspector({ engine }: { engine: BoardEngine }) {
  const editing = engine.editing;
  const selection = useSyncExternalStore(
    editing.subscribe,
    () => editing.getSnapshot().selected.length,
  );
  const textEditing = useSyncExternalStore(
    editing.subscribe,
    () => editing.getSnapshot().isTextEditing,
  );
  const message = useSyncExternalStore(
    editing.subscribe,
    () => editing.getSnapshot().message,
  );
  const [closed, setClosed] = useState(false);
  const show = selection > 0 || textEditing;
  return (
    <>
      {show && closed ? (
        <ToolButton
          label="Show object properties"
          icon="settings"
          action={() => setClosed(false)}
        />
      ) : null}
      {show && !closed ? (
        <div className="selection-inspector">
          <button
            type="button"
            className="inspector-close"
            aria-label="Hide object properties"
            title="Hide object properties"
            onClick={() => setClosed(true)}
          >
            <Icon name="close" />
          </button>
          <ObjectProperties engine={engine} />
        </div>
      ) : null}
      {message ? (
        <p role="status" className="file-message editing-message">
          {message}
        </p>
      ) : null}
    </>
  );
}
