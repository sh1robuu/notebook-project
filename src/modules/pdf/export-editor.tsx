import { createRoot } from "react-dom/client";
import { Tldraw, loadSnapshot } from "tldraw";
import type { Editor, TLStoreSnapshot } from "tldraw";
import { shapeUtils, textOptions, sdkOptions } from "../board/sdk-config.ts";
import { abortError, checkAbort } from "./runtime.ts";
import { WordSourcesContext } from "../documents/render.tsx";
import type { DocumentSources } from "../documents/sources.ts";
import { bindWordSources } from "../documents/editor-sources.ts";
/** A detached native store, never a live editor or a second authored object model. */
export async function exportEditor(
  document: TLStoreSnapshot,
  signal: AbortSignal,
  sources: DocumentSources = {},
): Promise<{ editor: Editor; close: () => void }> {
  checkAbort(signal);
  const host = window.document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  Object.assign(host.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: "1280px",
    height: "960px",
    pointerEvents: "none",
  });
  window.document.body.append(host);
  const root = createRoot(host);
  let releaseSources = () => {};
  const close = () => {
    root.unmount();
    releaseSources();
    host.remove();
  };
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      close();
      reject(abortError());
    };
    const timer = setTimeout(abort, 15000);
    signal.addEventListener("abort", abort, { once: true });
    root.render(
      <WordSourcesContext.Provider value={sources}>
        <Tldraw
          hideUi
          shapeUtils={shapeUtils}
          textOptions={textOptions}
          options={sdkOptions}
          licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY || undefined}
          onMount={(editor) => {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            try {
              checkAbort(signal);
              releaseSources = bindWordSources(editor, () => sources);
              loadSnapshot(editor.store, { document });
              editor.updateInstanceState({ isReadonly: true });
              resolve({ editor, close });
            } catch (e) {
              queueMicrotask(close);
              reject(e);
            }
          }}
        />
      </WordSourcesContext.Provider>,
    );
  });
}
