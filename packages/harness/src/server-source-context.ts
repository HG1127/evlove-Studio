import type { EvolveProject, TestCase } from "@evolution/contracts";
import { htmlDocumentObservation } from "@evolution/core";
import { retrieveTextContext } from "./context-retrieval";

// Bump when semantic source selection changes so cached scores are not mixed across policies.
export const SERVER_SEMANTIC_CONTEXT_VERSION = "whole-document-text-v2";

export const SERVER_SOURCE_CONTEXT_INSTRUCTION = "Source content is bounded parsed-text context, not proof of complete Storage bytes or runtime behavior. originalChars measures available parsed source text. Do not invent section counts, facts or coverage outside supplied excerpts. For HTML body excerpts, chunk offsets are relative to the stated body start.";

type SourceProject = Pick<EvolveProject, "sourceArtifacts" | "goal" | "evolutionCommand">;

function htmlBodyStart(source: string) {
  // Select context outside comments, quoted attributes and raw-text elements.
  // This is excerpt selection, not HTML validation or an acceptance verdict.
  const tags = /<!--[\s\S]*?-->|<(script|style|title|textarea)\b(?:[^>"']|"[^"']*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<(?:[^>"']|"[^"']*"|'[^']*')*>/gi;
  for (const token of source.matchAll(tags)) {
    if (/^<body\b/i.test(token[0])) return token.index + token[0].length;
  }
  return undefined;
}

/** Select bounded source excerpts; offsets are context coordinates, never a verdict. */
export function compactServerSourceText(source: string, query: string, allowance: number, html: boolean) {
  if (!allowance) return "";
  if (source.length <= allowance) return source;
  const bodyStart = html ? htmlBodyStart(source) : undefined;
  if (bodyStart === undefined) return retrieveTextContext(source, query, { maxChars: allowance, maxChunks: 6 });
  // CSS/fonts in a large head must not displace the document's business content.
  const head = source.slice(0, Math.min(bodyStart, 2_000, Math.floor(allowance / 5)));
  const prefix = "[source head @0]\n" + head + "\n\n[source body starts @" + bodyStart + "; chunk offsets relative to body]\n";
  if (prefix.length >= allowance) return retrieveTextContext(source, query, { maxChars: allowance, maxChunks: 1 });
  return prefix + retrieveTextContext(source.slice(bodyStart), query, { maxChars: allowance - prefix.length, maxChunks: 6 });
}

/** Execution receives only its selected paper; Candidate construction never calls this helper. */
export function serverSemanticContextQuery(project: Pick<EvolveProject, "goal" | "evolutionCommand" | "acceptanceRubric">, testCases: TestCase[]) {
  const criterionIds = new Set(testCases.flatMap(testCase => testCase.criterionIds));
  return [project.goal, project.evolutionCommand,
    ...testCases.flatMap(testCase => [testCase.title, testCase.input.slice(0, 1600), ...testCase.expected]),
    ...project.acceptanceRubric.filter(criterion => criterionIds.has(criterion.id)).map(criterion => criterion.requirement),
  ].join("\n");
}

/** Budget source context for understanding/contract/exam setup; never mutate source bytes. */
export function compactServerSourceArtifacts(project: SourceProject | undefined) {
  if (!project) return [];
  const ordered = [...project.sourceArtifacts].sort((a, b) => Number(b.role === "target") - Number(a.role === "target"));
  const query = [project.evolutionCommand, project.goal].filter(Boolean).join("\n");
  let remaining = 60_000;
  return ordered.map((artifact) => {
    const source = artifact.textContent || artifact.textExcerpt || "";
    const allowance = Math.max(0, Math.min(remaining, 20_000));
    const html = /^html?$/i.test(artifact.extension) || /^text\/html(?:;|$)/i.test(artifact.mimeType);
    const content = compactServerSourceText(source, query, allowance, html);
    remaining = Math.max(0, remaining - content.length);
    return {
      id: artifact.id, name: artifact.name, role: artifact.role, artifactKind: artifact.artifactKind,
      structure: (artifact.structure ?? []).slice(0, 40), content, originalChars: source.length,
      contextSource: artifact.textContent ? "parsed-text" as const : "text-excerpt" as const,
      truncated: content !== source || (!artifact.textContent && Boolean(artifact.textExcerpt)),
    };
  }).filter((artifact) => artifact.content || artifact.role === "target");
}


/** A complete document-text projection is distinct from raw HTML or browser evidence. */
export function serverSemanticTextContext(source: string, query: string, allowance: number, html: boolean, documentContent: boolean) {
  if (source.length <= allowance) return { content: source, originalChars: source.length, truncated: false, contextRepresentation: "raw-source-complete-v1" };
  if (html && documentContent) {
    const index = htmlDocumentObservation(source);
    const indexed = "HTML DOCUMENT TEXT INDEX · complete static text, section IDs included\n"
      + "Scripts, styles, rendered visibility and runtime interaction are not represented.\n" + index.documentText;
    const content = compactServerSourceText(indexed, query, allowance, false);
    return { content, truncated: content !== indexed, contextRepresentation: "html-document-text-v1",
      indexedCharacters: indexed.length, originalChars: source.length,
      observationScope: "complete static document text when truncated=false; never browser behavior or raw HTML fidelity" };
  }
  const content = compactServerSourceText(source, query, allowance, html);
  return { content, originalChars: source.length, truncated: content !== source, contextRepresentation: "raw-source-excerpts-v1" };
}
