import { validateDocument, walkBlocks } from "./model.ts";
import type { DocumentModel, DocumentBlock, ParagraphBlock } from "./model.ts";

function updateContainers(
  model: DocumentModel,
  map: (blocks: DocumentBlock[]) => DocumentBlock[],
) {
  return {
    ...model,
    revision: model.revision + 1,
    blocks: map(model.blocks),
    sections: model.sections.map((section) => ({
      ...section,
      header: map(section.header),
      footer: map(section.footer),
    })),
  };
}
export function replaceBlock(
  model: DocumentModel,
  replacement: DocumentBlock,
): DocumentModel {
  let found = false;
  const map = (blocks: DocumentBlock[]): DocumentBlock[] =>
    blocks.map((block) => {
      if (block.id === replacement.id) {
        found = true;
        return structuredClone(replacement);
      }
      return block.kind === "table"
        ? {
            ...block,
            rows: block.rows.map((row) => ({
              cells: row.cells.map((cell) => ({
                ...cell,
                blocks: map(cell.blocks),
              })),
            })),
          }
        : block;
    });
  const next = updateContainers(model, map);
  if (!found)
    throw new Error("The source block is missing. Reopen the current draft.");
  return validateDocument(next);
}
export function insertParagraph(
  model: DocumentModel,
  afterId: string | null,
  text = "New explanation",
): { document: DocumentModel; blockId: string } {
  const blockId = "block:" + crypto.randomUUID();
  const block: ParagraphBlock = {
    id: blockId,
    kind: "paragraph",
    provenance: { part: "teacher", path: blockId },
    format: {},
    inlines: [
      { id: "inline:" + crypto.randomUUID(), kind: "text", text, format: {} },
    ],
  };
  const copy = structuredClone(model);
  const index = afterId
    ? copy.blocks.findIndex((block) => block.id === afterId)
    : copy.blocks.length - 1;
  if (afterId && index < 0)
    throw new Error(
      "Select a top-level block before inserting an explanation.",
    );
  copy.blocks.splice(index + 1, 0, block);
  copy.revision++;
  return { document: validateDocument(copy), blockId };
}
export function deleteBlock(model: DocumentModel, id: string): DocumentModel {
  let found = false;
  const map = (blocks: DocumentBlock[]): DocumentBlock[] =>
    blocks
      .filter((block) => {
        if (block.id === id) {
          found = true;
          return false;
        }
        return true;
      })
      .map((block) =>
        block.kind === "table"
          ? {
              ...block,
              rows: block.rows.map((row) => ({
                cells: row.cells.map((cell) => ({
                  ...cell,
                  blocks: map(cell.blocks),
                })),
              })),
            }
          : block,
      );
  const next = updateContainers(model, map);
  if (!found) throw new Error("The source block is missing.");
  const remaining = new Set(walkBlocks(next).map((block) => block.id));
  for (const section of next.sections)
    if (section.afterBlockId && !remaining.has(section.afterBlockId))
      delete section.afterBlockId;
  next.diagnostics = next.diagnostics.map((d) =>
    d.blockId && !remaining.has(d.blockId) ? { ...d, blockId: undefined } : d,
  );
  return validateDocument(next);
}
