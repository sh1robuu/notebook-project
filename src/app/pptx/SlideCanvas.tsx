import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { LessonSession } from "../../modules/board/lesson-session.ts";
import type { Paper } from "../../modules/workspace/lesson-view.ts";
import type {
  Slide,
  SlideDocument,
  PptxSources,
} from "../../modules/pptx/model.ts";
import { buildFrame, buildTimeline } from "../../modules/pptx/playback.ts";
import { paintSlide, slideForPaper } from "../../modules/pptx/render.ts";

const fullyRevealed = new Set<string>();
export const playbackKey = (pageId: string, sourceId: string) =>
  pageId + ":" + sourceId;

export function SlidePaper({
  session,
  paper,
  pageId,
  zoom,
}: {
  session: LessonSession;
  paper: Paper;
  pageId: string;
  zoom: number;
}) {
  const lesson = session.workspace.lesson;
  const source = slideForPaper(lesson, paper);
  const frame = useSyncExternalStore(
    session.slides.subscribe,
    session.slides.getSnapshot,
  );
  const slide = source?.slide;
  const entry = useMemo(
    () =>
      slide
        ? buildFrame(buildTimeline(slide.builds), 0, 0).hidden
        : fullyRevealed,
    [slide],
  );
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  useEffect(() => {
    const media = matchMedia("(resolution: " + dpr + "dppx)");
    const update = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener("resize", update);
    media.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      media.removeEventListener("change", update);
    };
  }, [dpr]);
  return source ? (
    <SlideCanvas
      deck={source.deck}
      slide={source.slide}
      sources={lesson.pptxSources}
      hidden={
        frame.key === playbackKey(pageId, source.deck.id) ? frame.hidden : entry
      }
      scale={Math.min(3, Math.max(0.5, Math.ceil(zoom * dpr * 2) / 2))}
    />
  ) : (
    <span className="pdf-canvas-status">PowerPoint source unavailable</span>
  );
}

export function SlideCanvas({
  deck,
  slide,
  sources,
  hidden = fullyRevealed,
  scale = 0.5,
}: {
  deck: SlideDocument;
  slide: Slide;
  sources: PptxSources;
  hidden?: ReadonlySet<string>;
  scale?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    const signal = new AbortController();
    const target = canvas.current!;
    const size = Math.min(
      scale,
      4096 / deck.width,
      4096 / deck.height,
      Math.sqrt(8_000_000 / (deck.width * deck.height)),
    );
    const staging = document.createElement("canvas");
    staging.width = Math.max(1, Math.floor(deck.width * size));
    staging.height = Math.max(1, Math.floor(deck.height * size));
    const ctx = staging.getContext("2d")!;
    ctx.scale(staging.width / deck.width, staging.height / deck.height);
    setStatus("loading");
    void paintSlide(
      ctx,
      slide,
      deck.width,
      deck.height,
      sources,
      hidden,
      signal.signal,
    )
      .then(() => {
        if (signal.signal.aborted) return;
        target.width = staging.width;
        target.height = staging.height;
        target.getContext("2d")!.drawImage(staging, 0, 0);
        setStatus("ready");
      })
      .catch(() => {
        if (!signal.signal.aborted) setStatus("error");
      })
      .finally(() => {
        staging.width = staging.height = 0;
      });
    return () => signal.abort();
  }, [deck, slide, sources, hidden, scale]);
  return (
    <div
      className="pptx-frame"
      style={{ aspectRatio: deck.width + "/" + deck.height }}
    >
      <canvas
        ref={canvas}
        aria-label={slide.title}
        role="img"
        data-slide-render={status}
      />
      {status === "error" ? (
        <span className="pdf-canvas-status" role="alert">
          PowerPoint slide could not render.
        </span>
      ) : null}
    </div>
  );
}
