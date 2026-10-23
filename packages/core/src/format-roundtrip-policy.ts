import type {SourceArtifact} from "@evolution/contracts";

const PLAIN_TEXT_EXTENSIONS=new Set([
  "txt","md","markdown","mdx","css","scss","less",
  "js","jsx","ts","tsx","mjs","cjs","html","htm","sql","py",
  "go","rs","java","kt","php","vue","svelte","toml","ini","conf","log",
  "graphql","gql","sh","bash","zsh","env","rb","kts",
]);
const STRUCTURED_TEXT_EXTENSIONS=new Set(["json","jsonl","yaml","yml","xml","svg"]);
export const TEXT_ARTIFACT_EXTENSIONS=Object.freeze([...PLAIN_TEXT_EXTENSIONS,...STRUCTURED_TEXT_EXTENSIONS]);
function normalized(extension:string){return extension.trim().replace(/^\./,"").toLowerCase();}
/** A semantic codebase can be a single file; only ZIP uses package overlays. */
export function isZipArtifact(source:Pick<SourceArtifact,"extension">){
  return normalized(source.extension)==="zip";
}
export function isTextArtifactExtension(extension:string){
  return PLAIN_TEXT_EXTENSIONS.has(normalized(extension))||STRUCTURED_TEXT_EXTENSIONS.has(normalized(extension));
}
export function isStructuredTextArtifactExtension(extension:string){
  return STRUCTURED_TEXT_EXTENSIONS.has(normalized(extension));
}
/** File-format roundtrip policy. CSV/TSV are native table overlays, not text-blueprint output. */
export function requiresIndependentFormatValidation(extension:string){
  return !PLAIN_TEXT_EXTENSIONS.has(normalized(extension));
}
