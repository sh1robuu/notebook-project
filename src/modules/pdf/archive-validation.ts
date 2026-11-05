import type { Lesson } from "../workspace/model.ts";
import { inspectPdf, checkAbort } from "./runtime.ts";
/** ZIP checksums do not prove that a PDF or its claimed page mapping is valid. */
export async function validateArchivedPdfs(
  lesson: Lesson,
  signal: AbortSignal,
  progress: (s: string) => void,
  password: (name: string, wrong: boolean) => Promise<string>,
  known: (id: string) => string | undefined,
): Promise<Record<string, string>> {
  const passwords: Record<string, string> = {};
  for (const source of Object.values(lesson.pdfSources)) {
    checkAbort(signal);
    const result = await inspectPdf(
      new File([new Uint8Array(source.bytes).buffer], source.name, {
        type: "application/pdf",
      }),
      signal,
      progress,
      (wrong) => password(source.name, wrong),
      known(source.id),
    );
    if (
      JSON.stringify(result.source.pages) !== JSON.stringify(source.pages) ||
      result.source.sha256 !== source.sha256
    )
      throw new Error(
        "Archived PDF geometry or source content differs from its manifest. Current lesson is unchanged.",
      );
    if (result.password !== undefined) passwords[source.id] = result.password;
  }
  return passwords;
}
