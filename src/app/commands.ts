import type { BoardEngine } from "../modules/board/engine.ts";
type Command = {
  id: string;
  label: string;
  keys?: string[];
  run: () => void;
  enabled: () => boolean;
};
/** One shortcut and menu dispatch point; editable/IME contexts keep native keys. */
export class CommandRegistry {
  #engine: BoardEngine;
  #commands = new Map<string, Command>();
  #composing = false;
  constructor(engine: BoardEngine) {
    this.#engine = engine;
    const e = engine.editing,
      selected = () => e.state.selected.length > 0,
      writable = () =>
        !engine.state.readOnly && !engine.session.state.presentation,
      edit = () => selected() && writable();
    const add = (
      id: string,
      label: string,
      run: () => void,
      keys?: string[],
      enabled: () => boolean = writable,
    ) => this.#commands.set(id, { id, label, run, keys, enabled });
    add(
      "undo",
      "Undo",
      () => engine.undo(),
      ["mod+z"],
      () => writable() && engine.state.canUndo,
    );
    add(
      "redo",
      "Redo",
      () => engine.redo(),
      ["mod+shift+z", "mod+y"],
      () => writable() && engine.state.canRedo,
    );
    add(
      "select",
      "Select",
      () => engine.setTool("select"),
      ["v"],
      () => true,
    );
    add("pen", "Pen", () => engine.setTool("draw"), ["p"]);
    add("highlight", "Highlighter", () => engine.setTool("highlight"), [
      "shift+p",
    ]);
    add("erase", "Whole stroke eraser", () => engine.setTool("eraser"), ["e"]);
    add("partial", "Partial eraser", () => engine.setTool("partial_eraser"), [
      "shift+e",
    ]);
    add(
      "hand",
      "Pan",
      () => engine.setTool("hand"),
      ["h"],
      () => true,
    );
    add("text", "Text", () => engine.setTool("text"), ["t"]);
    add("shapes", "Shapes", () => engine.setTool("geo"), ["r"]);
    add(
      "copy",
      "Copy",
      () => void engine.clipboard.copy(),
      ["mod+c"],
      selected,
    );
    add("cut", "Cut", () => void engine.clipboard.copy(true), ["mod+x"], edit);
    add("paste", "Paste", () => void engine.clipboard.paste(), ["mod+v"]);
    add("duplicate", "Duplicate", () => e.duplicate(), ["mod+d"], edit);
    add("delete", "Delete", () => e.delete(), ["Delete", "Backspace"], edit);
    add(
      "all",
      "Select all",
      () => e.selectAll(),
      ["mod+a"],
      () => true,
    );
    add(
      "escape",
      "Deselect",
      () => {
        engine.escape();
      },
      ["Escape"],
      () => true,
    );
    add(
      "group",
      "Group",
      () => e.group(),
      ["mod+g"],
      () => writable() && e.state.selected.length > 1,
    );
    add(
      "ungroup",
      "Ungroup",
      () => e.ungroup(),
      ["mod+shift+g"],
      () => writable() && e.state.selected.some((s) => s.type === "group"),
    );
    add("front", "Bring to front", () => e.arrange(true), undefined, edit);
    add("back", "Send to back", () => e.arrange(false), undefined, edit);
    add(
      "fit",
      "Fit drawing",
      () => engine.zoom("fit"),
      undefined,
      () => true,
    );
    add(
      "equation",
      "Edit equation",
      () => e.editEquation(),
      ["Enter"],
      () =>
        writable() &&
        e.state.selected.length === 1 &&
        e.state.selected[0].type === "equation",
    );
    add(
      "math-figure",
      "Edit math figure",
      () => e.editMathFigure(),
      ["Enter"],
      () =>
        writable() &&
        e.state.selected.length === 1 &&
        e.state.selected[0].type === "math-figure" &&
        !e.state.selected[0].isLocked,
    );
  }
  register(
    id: string,
    label: string,
    run: () => void,
    keys: string[],
    enabled: () => boolean = () => true,
  ) {
    const command = { id, label, run, keys, enabled };
    this.#commands.set(id, command);
    return () => {
      if (this.#commands.get(id) === command) this.#commands.delete(id);
    };
  }
  execute(id: string) {
    const command = this.#commands.get(id);
    if (command?.enabled()) command.run();
  }
  entries(ids: string[]) {
    return ids
      .map((id) => this.#commands.get(id))
      .filter((v): v is Command => !!v)
      .map((c) => ({ id: c.id, label: c.label, enabled: c.enabled() }));
  }
  shortcuts() {
    return [...this.#commands.values()]
      .filter((command) => command.keys?.length)
      .map((command) => ({
        id: command.id,
        label: command.label,
        keys: [...command.keys!],
        enabled: command.enabled(),
      }));
  }
  install() {
    const abort = new AbortController(),
      opts = { capture: true, signal: abort.signal };
    window.addEventListener(
      "compositionstart",
      () => {
        this.#composing = true;
      },
      opts,
    );
    window.addEventListener(
      "compositionend",
      () => {
        this.#composing = false;
      },
      opts,
    );
    window.addEventListener(
      "blur",
      () => {
        this.#composing = false;
      },
      { signal: abort.signal },
    );
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.isComposing || this.#composing || e.keyCode === 229) return;
        const target = e.target instanceof Element ? e.target : null;
        if (
          (e.key === "Enter" || e.key === " ") &&
          target?.closest('button,a[href],summary,[role="button"]')
        ) {
          e.stopImmediatePropagation();
          return;
        }
        if (
          e.key === "Escape" &&
          target?.closest(
            'details[open], [data-adaptive-menu][data-open="true"], [data-board-controls]',
          )
        )
          return;
        if (target?.closest("[data-board-controls]")) {
          // Keep page-control keys out of both our commands and SDK shortcuts.
          // Native button/select behavior still runs because default is retained.
          e.stopImmediatePropagation();
          return;
        }
        const editable = target?.closest(
          'dialog,input,textarea,select,[role="menu"],[contenteditable="true"]',
        );
        const reading =
          target?.closest("[data-pdf-reading]") ??
          (!editable &&
          this.#engine.surface === "main" &&
          this.#engine.session.state.reading
            ? document.querySelector("[data-pdf-reading]")
            : null);
        if (reading) {
          // The SDK also installs document keyboard handlers. Stop before those
          // handlers while retaining native text selection/copy defaults.
          e.stopImmediatePropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            this.#engine.session.setReading(false);
            this.#engine.pages.editor.focus();
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
            e.preventDefault();
            const text = reading.querySelector(
              '[data-testid="pdf-text-layer"]',
            );
            if (text) {
              const range = document.createRange();
              range.selectNodeContents(text);
              const selection = window.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
            }
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            this.execute("download");
          }
          return;
        }
        if (target?.closest('dialog,input,textarea,select,[role="menu"]'))
          return;
        if (target?.closest('[contenteditable="true"]')) {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.#engine.editing.textDone();
          }
          return;
        }
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        const chord = `${e.ctrlKey || e.metaKey ? "mod+" : ""}${e.shiftKey ? "shift+" : ""}${key}`;
        const command = [...this.#commands.values()].find((c) =>
          c.keys?.includes(chord),
        );
        if (command) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (command.enabled()) command.run();
        }
        // Prevent vendor-only tools until their controlled product adapters exist.
        else if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[a-z]$/.test(key))
          e.stopPropagation();
      },
      opts,
    );
    return () => abort.abort();
  }
}
