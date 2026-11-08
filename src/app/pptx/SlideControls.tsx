import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Box, useValue } from "tldraw";
import type { BoardEngine } from "../../modules/board/engine.ts";
import { validatePaper } from "../../modules/workspace/lesson-view.ts";
import { missingSlideFonts, slideForPaper } from "../../modules/pptx/render.ts";
import type { SlideDiagnostic } from "../../modules/pptx/model.ts";
import { playbackKey } from "./SlideCanvas.tsx";
import { Icon } from "../Icon.tsx";
import type { ComponentProps } from "react";

function SlideButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ComponentProps<typeof Icon>["name"];
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="pptx-control-label">{label}</span>
      <span className="pptx-control-icon">
        <Icon name={icon} />
      </span>
    </button>
  );
}

export function SlideWarnings({
  diagnostics,
  missingFonts,
}: {
  diagnostics: SlideDiagnostic[];
  missingFonts: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const count = diagnostics.length + missingFonts.length;
  if (!count) return null;
  return (
    <details
      className="pptx-warnings"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        {count} PowerPoint compatibility {count === 1 ? "notice" : "notices"}
      </summary>
      {expanded ? (
        <ul>
          {missingFonts.map((font) => (
            <li key={font}>
              Font unavailable on this device. Arial or sans-serif will
              substitute for {font}.
            </li>
          ))}
          {diagnostics.map((d, i) => (
            <li key={i}>
              {d.slideId ? d.slideId + " · " : ""}
              {d.elementId ? d.elementId + " · " : ""}
              {d.message}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

export function SlideControls({ engine }: { engine: BoardEngine }) {
  const { session } = engine;
  const editor = engine.pages.editor;
  const lesson = session.workspace.lesson;
  const ui = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const frame = useSyncExternalStore(
    session.slides.subscribe,
    session.slides.getSnapshot,
  );
  const pages = useValue("slide lesson pages", () => editor.getPages(), [
    editor,
  ]);
  const page = useValue("current slide page", () => editor.getCurrentPage(), [
    editor,
  ]);
  const paper = validatePaper(page.meta.paper);
  const current = slideForPaper(lesson, paper);
  const deck = current?.deck,
    slide = current?.slide;
  const key = deck ? playbackKey(page.id, deck.id) : "";
  useLayoutEffect(() => {
    if (slide) session.slides.enter(key, slide.builds);
    else session.slides.clear();
  }, [key, slide, session]);
  const fonts = useMemo(() => (slide ? missingSlideFonts(slide) : []), [slide]);
  const neighbours = useMemo(() => {
    const inDeck = pages.filter((p) => {
      const info = slideForPaper(lesson, validatePaper(p.meta.paper));
      return (
        info?.deck === deck &&
        (p.id === page.id || !ui.presentation || !info?.slide.hidden)
      );
    });
    const index = inDeck.findIndex((p) => p.id === page.id);
    return { prev: inDeck[index - 1]?.id, next: inDeck[index + 1]?.id };
  }, [pages, deck, page.id, ui.presentation, lesson]);
  useEffect(() => {
    if (!slide || !ui.presentation) return;
    const controller = new AbortController();
    window.addEventListener(
      "keydown",
      (event) => {
        if (
          event.defaultPrevented ||
          event.isComposing ||
          event.repeat ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey ||
          session.state.active !== "main" ||
          engine.isPointing() ||
          editor.getEditingShapeId() ||
          (event.target instanceof Element &&
            event.target.closest(
              'dialog,input,select,textarea,[contenteditable],[role="menu"]',
            ))
        )
          return;
        const forward = ["PageDown", "ArrowRight"].includes(event.key);
        if (!forward && !["PageUp", "ArrowLeft"].includes(event.key)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const { step, last, pending } = session.slides.getSnapshot();
        if (forward) {
          if (step < last || pending) session.slides.next();
          else if (neighbours.next) engine.pages.navigate(neighbours.next);
        } else if (step > 0) session.slides.previous();
        else if (neighbours.prev) engine.pages.navigate(neighbours.prev);
      },
      { capture: true, signal: controller.signal },
    );
    return () => controller.abort();
  }, [slide, ui.presentation, engine, editor, session, neighbours]);
  if (!deck || !slide) return null;
  const diagnostics = deck.diagnostics.filter(
    (notice) => !notice.slideId || notice.slideId === slide.id,
  );
  const position = deck.slides.indexOf(slide) + 1;
  return (
    <div
      className="pptx-controls"
      role="group"
      aria-label="PowerPoint presentation controls"
    >
      <div
        className="pptx-status"
        aria-live="polite"
        data-testid="slide-build-status"
      >
        <strong>{slide.title || "Untitled slide"}</strong>
        <span>
          Slide {position} of {deck.slides.length}
          {slide.hidden ? " · hidden in source" : ""} · Build {frame.step} of{" "}
          {frame.last}
          {frame.pending ? " · playing" : ""}
        </span>
      </div>
      <div className="pptx-control-scroll">
        <SlideButton
          label="Previous slide"
          icon="previousSlide"
          disabled={!neighbours.prev}
          onClick={() =>
            neighbours.prev && engine.pages.navigate(neighbours.prev)
          }
        />
        <SlideButton
          label="Previous build"
          icon="previousBuild"
          disabled={!frame.step}
          onClick={() => session.slides.previous()}
        />
        <SlideButton
          label="Next build"
          icon="nextBuild"
          disabled={frame.step === frame.last && !frame.pending}
          onClick={() => session.slides.next()}
        />
        <SlideButton
          label="Next slide"
          icon="nextSlide"
          disabled={!neighbours.next}
          onClick={() =>
            neighbours.next && engine.pages.navigate(neighbours.next)
          }
        />
        <SlideButton
          label="Restart slide"
          icon="restart"
          onClick={() => session.slides.restart()}
        />
        <SlideButton
          label="Reveal all"
          icon="reveal"
          disabled={!frame.hidden.size}
          onClick={() => session.slides.revealAll()}
        />
        <SlideButton
          label="Fit slide"
          icon="fit"
          onClick={() => {
            editor.updateViewportScreenBounds(editor.getContainer());
            editor.zoomToBounds(new Box(0, 0, paper.width, paper.height));
          }}
        />
      </div>
      <SlideWarnings diagnostics={diagnostics} missingFonts={fonts} />
    </div>
  );
}
