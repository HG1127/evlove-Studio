import { htmlDocumentObservation } from "@evolution/core";

/** Reads the whole inert tree and document text; does not assert runtime or visual fidelity. */
export function serverHtmlStaticObservation(html: string) {
  const index = htmlDocumentObservation(html);
  const full = "COMPLETE HTML STATIC OBSERVATION\n" + JSON.stringify(index.structure)
    + "\nCOMPLETE STATIC DOCUMENT TEXT (scripts/styles excluded)\n" + index.documentText;
  const complete = full.length <= 56_000;
  return { content: full.slice(0, 56_000), complete,
    limitation: complete ? "The complete static tree report and document text are supplied; runtime and visual behavior remain unobserved."
      : "The whole file was indexed, but its report/text exceeds the output budget. Supplied evidence is partial." };
}
