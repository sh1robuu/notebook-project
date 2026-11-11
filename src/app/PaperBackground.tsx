import { useContext, useMemo } from "react";
import { useEditor, useValue } from "tldraw";
import { validatePaper } from "../modules/workspace/lesson-view.ts";
import { paperColors } from "../modules/board/pages.ts";
import { paperGuideSvg } from "../modules/board/paper-guides.ts";
import { PdfCanvas, PdfSessionContext } from "./PdfPage.tsx";
import { SlidePaper } from "./pptx/SlideCanvas.tsx";
export function PaperBackground() {
  const session = useContext(PdfSessionContext);
  const editor = useEditor(),
    page = useValue("page paper", () => editor.getCurrentPage(), [editor]),
    camera = useValue("paper camera", () => editor.getCamera(), [editor]);
  const paper = useMemo(
    () => validatePaper(page.meta.paper),
    [page.meta.paper],
  );
  const backgroundImage = useMemo(() => {
    const guides = paperGuideSvg(paper);
    return guides
      ? `url("data:image/svg+xml,${encodeURIComponent(guides)}")`
      : undefined;
  }, [paper]);
  return (
    <div className="tl-background paper-background" aria-hidden="true">
      <div
        className="paper-sheet"
        data-paper-pattern={paper.pattern}
        style={{
          position: "absolute",
          left: camera.x * camera.z,
          top: camera.y * camera.z,
          width: paper.width * camera.z,
          height: paper.height * camera.z,
          backgroundColor: paperColors[paper.color],
          backgroundImage,
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
          boxShadow: "0 0 0 1px #d7d8dc",
        }}
      >
        {paper.kind === "pdf" ? (
          <PdfCanvas
            key={paper.sourceId + ":" + paper.pageIndex}
            paper={paper}
            zoom={camera.z}
          />
        ) : null}
        {paper.kind === "pptx" && session ? (
          <SlidePaper
            key={page.id}
            session={session}
            pageId={page.id}
            paper={paper}
            zoom={camera.z}
          />
        ) : null}
      </div>
    </div>
  );
}
