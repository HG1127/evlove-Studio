import type { SourceArtifact } from "@evolution/contracts";

const TEXT_EXTENSION = /^(txt|md|markdown|mdx|csv|tsv|json|yaml|yml|css|js|jsx|ts|tsx|html|htm|xml|svg)$/i;

function fileExtension(name: string) {
  const file = (name ?? "").split(/[\\/]/).pop() ?? "";
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
}

/** Text Targets keep their original format while allowing a different filename stem. */
export function hasSourceTextArtifactFileFormat(
  source: Pick<SourceArtifact, "name"> & Partial<Pick<SourceArtifact, "extension">>,
  name: string,
): boolean {
  const expected = (source.extension?.replace(/^\./, "") || fileExtension(source.name ?? "")).toLowerCase();
  if (!TEXT_EXTENSION.test(expected)) return true;
  const actual = fileExtension(name);
  return actual === expected
    || (/^html?$/.test(expected) && /^html?$/.test(actual));
}
