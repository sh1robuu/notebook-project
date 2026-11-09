import { createShapeId } from "tldraw";
import type {
  Editor,
  TLContent,
  TLShapeId,
  TLImageAsset,
  TLRichText,
  TLShape,
} from "tldraw";
import type { EditingController } from "./editing.ts";
import type { Lesson } from "../workspace/model.ts";
import { validateLesson } from "../workspace/model.ts";
import {
  plainRichText,
  clipboardHtml,
  MAX_CLIPBOARD_CHARS,
} from "./clipboard-html.ts";
import { dataImage, MAX_TOTAL_IMAGE_BYTES } from "../media/image-format.ts";
import { prepareImage } from "../media/images.ts";
import { checkAssetBudget } from "../media/asset-budget.ts";
import { canCreateShapes } from "./capacity.ts";
import { beginOperation } from "../workspace/activity.ts";
const appAttribute = "data-lessonboard-content";
function base64(text: string) {
  const bytes = new TextEncoder().encode(text),
    chunks = [];
  for (let i = 0; i < bytes.length; i += 32768)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return btoa(chunks.join(""));
}
function plaintext(rich: TLRichText): string {
  const walk = (n: any): string =>
    n.type === "text"
      ? n.text
      : (n.content ?? []).map(walk).join(n.type === "doc" ? "\n" : "");
  return walk(rich);
}
/** All native paste/drop entry points terminate here, before any SDK importer. */
export class ClipboardController {
  #editor: Editor;
  #editing: EditingController;
  #lesson: () => Lesson;
  #scope: () => string;
  #fallback: string | undefined;
  #copying: Promise<void> = Promise.resolve();
  constructor(
    editor: Editor,
    editing: EditingController,
    lesson: () => Lesson,
    scope: () => string,
  ) {
    this.#editor = editor;
    this.#editing = editing;
    this.#lesson = lesson;
    this.#scope = scope;
  }
  #selectionLesson(): Lesson | null {
    const e = this.#editor,
      content = e.getContentFromCurrentPage(e.getSelectedShapeIds());
    if (!content?.shapes.length) return null;
    if (content.shapes.some((shape) => shape.type === "interactive"))
      throw new Error(
        "Use Duplicate or a lesson archive to keep interactive source files with their objects.",
      );
    if (content.shapes.some((shape) => shape.type === "word-block"))
      throw new Error(
        "Use Word Terminal to copy or edit structured teaching content. Original documents are not put on the object clipboard.",
      );
    const original = this.#lesson(),
      ids = new Set(content.shapes.map((s) => s.id)),
      store: Lesson["document"]["store"] = {};
    for (const r of Object.values(original.document.store))
      if (
        r.typeName === "document" ||
        r.typeName === "page" ||
        r.typeName === "user"
      )
        store[r.id] = r;
    for (const s of content.shapes)
      store[s.id] = {
        ...s,
        meta: Object.fromEntries(
          Object.entries(s.meta).filter(
            ([key]) => key !== "wordAnchor" && key !== "wordDetached",
          ),
        ),
        parentId: ids.has(s.parentId as TLShapeId)
          ? s.parentId
          : original.pageId,
      } as TLShape;
    for (const r of [...content.assets, ...(content.bindings ?? [])])
      store[r.id] = r;
    return validateLesson({
      ...original,
      document: { ...original.document, store },
    });
  }
  copy(cut = false): Promise<void> {
    const previous = this.#copying,
      pending = this.#writeCopy(cut, previous);
    this.#copying = Promise.all([previous, pending]).then(() => undefined);
    return this.#copying;
  }
  async #writeCopy(cut: boolean, previous: Promise<void>): Promise<void> {
    const finish = beginOperation(cut ? "Cắt đối tượng" : "Sao chép đối tượng");
    try {
      const lesson = this.#selectionLesson();
      if (!lesson) return;
      const json = JSON.stringify({
        format: "lessonboard.clipboard",
        version: 1,
        lesson,
      });
      if (json.length > MAX_CLIPBOARD_CHARS / 1.4)
        throw new Error(
          "Selection is too large for the system clipboard. Download a lesson instead.",
        );
      const html = `<div ${appAttribute}="${base64(json)}">${product.name} objects</div>`;
      const text = Object.values(lesson.document.store)
        .filter((r) => r.typeName === "shape")
        .map((r) =>
          r.typeName === "shape" && r.type === "text"
            ? plaintext(r.props.richText)
            : r.typeName === "shape" && r.type === "equation"
              ? r.props.source
              : `[${product.name} object]`,
        )
        .join("\n");
      this.#fallback = html;
      const ids = this.#editor.getSelectedShapeIds(),
        scope = this.#scope();
      const copiedRecords = Object.values(lesson.document.store).map(
        (r) => [r.id, this.#editor.store.get(r.id)] as const,
      );
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
        throw new Error("System clipboard is unavailable.");
      await previous;
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      if (cut) {
        if (
          scope !== this.#scope() ||
          ids.join() !== this.#editor.getSelectedShapeIds().join() ||
          copiedRecords.some(
            ([id, before]) => this.#editor.store.get(id) !== before,
          )
        ) {
          this.#editing.notify("Selected work changed. Cut was cancelled.");
          return;
        }
        if (
          !this.#editing.command("cut objects", () =>
            this.#editor.deleteShapes(ids),
          )
        )
          return;
      }
      this.#editing.notify(
        cut
          ? "Objects cut to the system clipboard."
          : "Objects copied to the system clipboard.",
      );
    } catch (error) {
      this.#editing.notify(
        `${cut ? "Cut cancelled. " : ""}${error instanceof Error ? error.message : "Clipboard permission denied."} Original work is kept. ${this.#fallback ? "Paste within this tab remains available." : ""}`,
      );
    } finally {
      finish();
    }
  }
  async paste(): Promise<void> {
    const finish = beginOperation("Đọc bộ nhớ tạm");
    const scope = this.#scope();
    try {
      await this.#copying;
      if (!navigator.clipboard?.read)
        throw new Error("Clipboard read is unavailable.");
      const items = await navigator.clipboard.read();
      let html = "",
        rtf = "",
        text = "";
      const files: File[] = [];
      for (const item of items) {
        if (item.types.includes("text/html"))
          html = await (await item.getType("text/html")).text();
        if (item.types.includes("text/plain"))
          text = await (await item.getType("text/plain")).text();
        if (item.types.includes("text/rtf"))
          rtf = await (await item.getType("text/rtf")).text();
        for (const type of ["image/png", "image/jpeg"])
          if (item.types.includes(type))
            files.push(
              new File([await item.getType(type)], "Clipboard image", { type }),
            );
      }
      if (scope !== this.#scope()) {
        this.#editing.notify("The active lesson changed. Paste was cancelled.");
        return;
      }
      await this.insert({ html, text, files, rtf });
    } catch {
      if (scope !== this.#scope()) {
        this.#editing.notify("The active lesson changed. Paste was cancelled.");
        return;
      }
      if (this.#fallback) {
        if (await this.insert({ html: this.#fallback, text: "", files: [] }))
          this.#editing.notify(
            "System clipboard read unavailable. Pasted the copy held in this tab.",
          );
      } else
        this.#editing.notify(
          "Clipboard permission denied or unavailable. Use browser Paste / Ctrl+V, or choose a local image.",
        );
    } finally {
      finish();
    }
  }
  install(host: HTMLElement) {
    const abort = new AbortController(),
      opts = { capture: true, signal: abort.signal };
    const editingTarget = (e: Event) =>
      e.target instanceof Element &&
      !!e.target.closest(
        'input,textarea,[contenteditable="true"],[data-pdf-reading]',
      );
    host.addEventListener(
      "paste",
      (e) => {
        if (
          e.target instanceof Element &&
          e.target.closest("input,textarea,[data-pdf-reading]")
        )
          return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const data = e.clipboardData;
        if (data)
          void this.insert({
            html: data.getData("text/html"),
            text: data.getData("text/plain"),
            rtf: data.getData("text/rtf"),
            files: Array.from(data.files),
            inText: editingTarget(e),
          });
      },
      opts,
    );
    host.addEventListener(
      "copy",
      (e) => {
        if (editingTarget(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        void this.copy();
      },
      opts,
    );
    host.addEventListener(
      "cut",
      (e) => {
        if (editingTarget(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        void this.copy(true);
      },
      opts,
    );
    host.addEventListener(
      "dragover",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      opts,
    );
    host.addEventListener(
      "drop",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        void this.insert({
          html: "",
          text: "",
          files: Array.from(e.dataTransfer?.files ?? []),
          point: this.#editor.screenToPage({ x: e.clientX, y: e.clientY }),
        });
      },
      opts,
    );
    return () => abort.abort();
  }
  async insert(input: {
    html: string;
    text: string;
    files: File[];
    inText?: boolean;
    point?: { x: number; y: number };
    rtf?: string;
  }): Promise<boolean> {
    if (this.#editor.getIsReadonly()) return false;
    const finish = beginOperation("Dán nội dung");
    const scope = this.#scope(),
      rte = input.inText ? this.#editor.getRichTextEditor() : null;
    const caret = rte
      ? {
          doc: rte.state.doc,
          from: rte.state.selection.from,
          to: rte.state.selection.to,
        }
      : null;
    try {
      if (
        input.html.length > MAX_CLIPBOARD_CHARS ||
        input.text.length > 100000 ||
        input.files.length > 12
      )
        throw new Error("Clipboard content exceeds supported size limits.");
      if (
        input.files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_IMAGE_BYTES
      )
        throw new Error("Clipboard image files exceed the 50 MB limit.");
      if (
        !input.html.includes(appAttribute) &&
        (input.rtf ||
          /\bMso|oMath|<\s*math\b|<\s*table\b|\[if[^\]]*mso/i.test(input.html))
      ) {
        if ((input.rtf?.length ?? 0) > MAX_CLIPBOARD_CHARS)
          throw new Error(
            "Word clipboard source exceeds supported limits. Import the DOCX file instead.",
          );
        window.dispatchEvent(
          new CustomEvent("lessonboard:word-terminal", {
            detail: {
              clipboard: {
                html: input.html,
                text: input.text,
                rtf: input.rtf,
                images: input.files,
              },
            },
          }),
        );
        this.#editing.notify(
          "Word content opened in the source terminal for structured review. The board is unchanged.",
        );
        return true;
      }
      const app = new RegExp(`${appAttribute}="([A-Za-z0-9+/=]+)"`).exec(
        input.html,
      );
      if (app && !rte) {
        const data = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from(atob(app[1]), (c) => c.charCodeAt(0)),
          ),
        );
        if (data.format !== "lessonboard.clipboard" || data.version !== 1)
          throw new Error("Unsupported app clipboard version.");
        const lesson = validateLesson(data.lesson);
        const figures = Object.values(lesson.document.store).flatMap(
          (record) =>
            record.typeName === "shape" && record.type === "math-figure"
              ? [record.props.figure]
              : [],
        );
        if (figures.length) {
          const { MathWorkerClient } = await import("../math/worker-client.ts");
          const checker = new MathWorkerClient();
          try {
            const result = await checker.run({ kind: "verify", figures });
            if (result.status !== "supported") throw new Error(result.message);
          } finally {
            checker.close();
          }
        }
        if (
          Object.values(lesson.document.store).some(
            (record) =>
              record.typeName === "shape" &&
              (record.type === "word-block" ||
                record.meta.wordAnchor !== undefined),
          )
        )
          throw new Error(
            "Structured Word content cannot be pasted as native objects. Use Word Terminal or open the complete lesson archive; the current board is unchanged.",
          );
        const records = Object.values(lesson.document.store),
          assets = records.filter(
            (r): r is TLImageAsset =>
              r.typeName === "asset" && r.type === "image",
          );
        const remap = new Map<string, TLImageAsset>();
        for (const a of assets) {
          const image = dataImage(a.props.src!);
          remap.set(
            a.id,
            await prepareImage(
              new File([new Uint8Array(image.bytes).buffer], a.props.name, {
                type: image.mime,
              }),
            ),
          );
        }
        if (scope !== this.#scope())
          throw new Error("The active lesson changed. Paste was cancelled.");
        const shapes = records
          .filter((r): r is TLShape => r.typeName === "shape")
          .map((s) =>
            s.type === "image"
              ? {
                  ...s,
                  props: {
                    ...s.props,
                    assetId: remap.get(s.props.assetId!)?.id ?? s.props.assetId,
                  },
                }
              : s,
          );
        const content: TLContent = {
          schema: lesson.document.schema,
          shapes,
          rootShapeIds: shapes
            .filter((s) => s.parentId === lesson.pageId)
            .map((s) => s.id),
          assets: [...remap.values()],
          bindings: records.filter((r) => r.typeName === "binding"),
        };
        checkAssetBudget(this.#editor, content.assets as TLImageAsset[]);
        if (
          !canCreateShapes(
            this.#editor,
            content.shapes.map((s) => s.id),
          )
        )
          throw new Error(
            "Page capacity reached. Paste was cancelled without changing work.",
          );
        return this.#editing.command("paste objects", () => {
          // These sources were decoded and validated above. Native content paste
          // otherwise stages unseen data URLs as src:null and reimports later.
          this.#editor.createAssets(
            content.assets.filter((a) => !this.#editor.getAsset(a.id)),
          );
          this.#editor.putContentOntoCurrentPage(content, {
            select: true,
            point: input.point,
          });
          this.#editor.setCurrentTool("select");
        });
      }
      let rich: TLRichText = plainRichText(input.text),
        notice = "",
        images: { src: string; alt: string }[] = [];
      if (input.html) {
        try {
          const parsed = clipboardHtml(input.html);
          rich = parsed.richText;
          images = parsed.images;
          notice = parsed.notice;
        } catch (error) {
          if (!input.text) throw error;
          notice = "Unsupported HTML rejected; plain text was preserved.";
        }
      }
      const assets: TLImageAsset[] = [];
      for (const file of input.files) assets.push(await prepareImage(file));
      if (!input.files.length)
        for (const image of images) {
          const data = dataImage(image.src);
          assets.push(
            await prepareImage(
              new File([new Uint8Array(data.bytes).buffer], image.alt, {
                type: data.mime,
              }),
            ),
          );
        }
      if (
        scope !== this.#scope() ||
        (rte &&
          (rte !== this.#editor.getRichTextEditor() ||
            rte.state.doc !== caret!.doc ||
            rte.state.selection.from !== caret!.from ||
            rte.state.selection.to !== caret!.to))
      )
        throw new Error(
          "The active lesson or text edit changed. Paste was cancelled.",
        );
      checkAssetBudget(this.#editor, assets);
      const text = plaintext(rich),
        point = input.point ?? this.#editor.getViewportPageBounds().center;
      const additions = assets.length + (text && !rte ? 1 : 0);
      if (
        !canCreateShapes(
          this.#editor,
          Array.from({ length: additions }, () => createShapeId()),
        )
      )
        throw new Error(
          "Page capacity reached. Paste was cancelled without changing work.",
        );
      const apply = () => {
        const selected: TLShapeId[] = [];
        if (text) {
          if (rte) {
            if (!input.html && !input.text.includes("\n"))
              rte
                .chain()
                .focus()
                .insertContent({ type: "text", text: input.text })
                .run();
            else
              rte
                .chain()
                .focus()
                .insertContent(rich.content ?? [])
                .run();
          } else {
            const id = createShapeId();
            this.#editor.createShape({
              id,
              type: "text",
              x: point.x - 180,
              y: point.y - 60,
              props: { richText: rich, font: "sans", w: 360, autoSize: false },
            });
            if (!this.#editor.getShape(id))
              throw new Error("Text insertion failed. Paste was cancelled.");
            selected.push(id);
          }
        }
        this.#editor.createAssets(
          assets.filter((a) => !this.#editor.getAsset(a.id)),
        );
        assets.forEach((a, i) => {
          const id = createShapeId(),
            scale = Math.min(1, 600 / a.props.w, 400 / a.props.h);
          this.#editor.createShape({
            id,
            type: "image",
            x: point.x - 180 + i * 24,
            y: point.y + (text ? 60 : 0) + i * 24,
            props: {
              w: a.props.w * scale,
              h: a.props.h * scale,
              assetId: a.id,
              playing: false,
              altText: a.props.name,
            },
          });
          if (!this.#editor.getShape(id))
            throw new Error("Image insertion failed. Paste was cancelled.");
          selected.push(id);
        });
        if (!rte && selected.length) {
          this.#editor.setCurrentTool("select");
          this.#editor.select(...selected);
        }
      };
      if (rte) {
        const mark = this.#editor.markHistoryStoppingPoint("paste at caret");
        try {
          this.#editor.run(apply);
          this.#editor.squashToMark(mark);
        } catch (error) {
          this.#editor.bailToMark(mark);
          throw error;
        }
      } else if (!this.#editing.command("paste content", apply)) return false;
      this.#editing.notify(
        notice || "Supported clipboard content inserted locally.",
      );
      return true;
    } catch (error) {
      this.#editing.notify(
        error instanceof Error
          ? error.message
          : "Paste failed. Original work was kept.",
      );
      return false;
    } finally {
      finish();
    }
  }
}
import { product } from "../../config/product.ts";
