import { useEditor, useValue } from "tldraw";
import { validatePaper } from "../modules/workspace/lesson-view.ts";
import { paperColors } from "../modules/board/pages.ts";
import { PdfCanvas } from "./PdfPage.tsx";
export function PaperBackground() {
  const editor = useEditor(),
    paper = useValue(
      "page paper",
      () => validatePaper(editor.getCurrentPage().meta.paper),
      [editor],
    ),
    camera = useValue("paper camera", () => editor.getCamera(), [editor]);
  return (
    <div className="tl-background paper-background" aria-hidden="true">
      <div
        style={{
          position: "absolute",
          left: camera.x * camera.z,
          top: camera.y * camera.z,
          width: paper.width * camera.z,
          height: paper.height * camera.z,
          background: paperColors[paper.color],
          boxShadow: "0 0 0 1px #9caeaf",
        }}
      >
        {paper.kind === "pdf" ? (
          <PdfCanvas
            key={paper.sourceId + ":" + paper.pageIndex}
            paper={paper}
            zoom={camera.z}
          />
        ) : null}
      </div>
    </div>
  );
}
