import { useEffect, useSyncExternalStore } from "react";
import type { BoardEngine } from "../../modules/board/engine.ts";
import { getWordTeaching } from "../../modules/documents/teaching.ts";
import { orderedTeachingBlocks } from "../../modules/documents/layout.ts";
export function TeachingControls({ engine }: { engine: BoardEngine }) {
  const controller = getWordTeaching(engine.pages.editor);
  const state = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
    ),
    model = controller.model();
  const teachingActive = Boolean(model) && state.enabled;
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    if (!teachingActive) return;
    const enabled = () =>
      controller.getSnapshot().enabled &&
      !engine.isPointing() &&
      engine.session.state.active === "main" &&
      !engine.session.state.reading;
    const dispose = [
      engine.commands.register(
        "word-next",
        "Reveal next",
        controller.next,
        ["ArrowRight", "PageDown"],
        enabled,
      ),
      engine.commands.register(
        "word-previous",
        "Reveal previous",
        controller.previous,
        ["ArrowLeft", "PageUp"],
        enabled,
      ),
    ];
    return () => {
      for (const stop of dispose) stop();
    };
  }, [controller, engine, teachingActive]);
  if (!model) return null;
  function edit() {
    if (
      !model ||
      engine.session.workspace.readOnly ||
      engine.session.state.presentation
    )
      return;
    engine.cancel();
    engine.pages.editor.getContainer().dispatchEvent(
      new CustomEvent("lessonboard:word-terminal", {
        detail: { document: model, blockId: state.currentBlockId },
      }),
    );
  }
  return (
    <div
      className="word-teaching-controls"
      role="group"
      aria-label="Structured teaching"
    >
      {!state.enabled ? (
        <>
          <button onClick={controller.start}>Start teaching</button>
          {state.currentBlockId ? (
            <button onClick={controller.resume}>Resume teaching</button>
          ) : null}
        </>
      ) : (
        <>
          <button
            onClick={controller.previous}
            disabled={!state.visibleIds.length}
          >
            Reveal previous
          </button>
          <button
            onClick={controller.next}
            disabled={state.visibleIds.length === state.total}
          >
            Reveal next
          </button>
          <button
            onClick={controller.revealAll}
            disabled={state.visibleIds.length === state.total}
          >
            Reveal all
          </button>
          <button onClick={controller.stop}>Return to editing</button>
        </>
      )}
      <span aria-label="Teaching progress">
        {state.enabled ? state.visibleIds.length : state.total} of {state.total}{" "}
        blocks
      </span>
      <select
        aria-label="Select teaching block"
        value={state.currentBlockId ?? ""}
        onChange={(event) => controller.selectBlock(event.target.value)}
      >
        <option value="">Select a block</option>
        {orderedTeachingBlocks(model)
          .filter(
            (block) => !state.enabled || state.visibleIds.includes(block.id),
          )
          .map((block, index) => (
            <option key={block.id} value={block.id}>
              {index + 1}. {block.kind}
            </option>
          ))}
      </select>
      <button
        disabled={
          engine.session.workspace.readOnly || engine.session.state.presentation
        }
        onClick={edit}
      >
        Edit revealed block
      </button>
      {model.sections.length > 1 ? (
        <select
          aria-label="Jump to document section"
          defaultValue=""
          onChange={(event) => {
            if (event.target.value != "")
              controller.jumpSection(Number(event.target.value));
          }}
        >
          <option value="">Section</option>
          {model.sections.map((section, index) => (
            <option key={section.id} value={index}>
              Section {index + 1} · {section.orientation}
            </option>
          ))}
        </select>
      ) : null}
      <small>
        Reveal position resets on reopen. Exports contain all compiled blocks.
      </small>
    </div>
  );
}
