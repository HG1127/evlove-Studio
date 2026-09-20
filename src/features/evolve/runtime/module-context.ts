import type { SourceArtifact } from "../schemas";
import type { CodeFileAnalysis } from "../sources/code-analysis";
import { retrieveRepositoryEvidence, type RepositoryEntry, type RepositoryIntelligence } from "../sources/repository-intelligence";
import { retrieveTextContext } from "./context-retrieval";

/** Read indexed modules plus immediate dependencies, including files absent from the upload digest. */
export function moduleContext(artifact: SourceArtifact, query: string, budget: number) {
  const data = artifact.structuredContent as { entries?: RepositoryEntry[]; codeIndex?: { files?: CodeFileAnalysis[] }; repositoryIntelligence?: RepositoryIntelligence } | undefined;
  if (!data?.repositoryIntelligence || !Array.isArray(data.entries)) return undefined;
  const files = retrieveRepositoryEvidence({ entries: data.entries, codeAnalyses: data.codeIndex?.files ?? [], intelligence: data.repositoryIntelligence, query, limit: 3 }).filter(file => typeof file.content === "string");
  let remaining = Math.max(0, budget);
  const selected = files.map((file, index) => {
    const allowance = Math.floor(remaining / (files.length - index));
    const header = `FILE ${file.path}\n`;
    const text = retrieveTextContext(file.content, query, { maxChars: Math.max(0, allowance - header.length - 2), maxChunks: 2 });
    const part = `${header}${text}\n\n`.slice(0, allowance);
    remaining -= part.length;
    return { path: file.path, coverage: text === file.content ? "full-file" : "excerpt", part };
  });
  return { text: selected.map(file => file.part).join(""), modules: selected.map(({path, coverage}) => ({path, coverage})), indexedFiles: data.entries.length };
}
