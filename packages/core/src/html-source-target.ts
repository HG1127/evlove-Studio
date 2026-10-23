import type {EvolveProject} from "@evolution/contracts";

type HtmlSourceProject=Pick<EvolveProject,"targetConnection"|"sourceArtifacts">;

export function hasExecutableHtmlSource(project:HtmlSourceProject):boolean {
  return project.sourceArtifacts.some(source=>
    source.role==="target" && /^(?:html|htm)$/i.test(source.extension));
}

/** Detect a background HTTP Proxy that mistakenly replaced an uploaded HTML Artifact Target. */
export function hasAmbiguousAutoProxyHtmlTarget(project:HtmlSourceProject):boolean {
  return hasExecutableHtmlSource(project)
    &&project.targetConnection.adapter==="http"
    &&project.targetConnection.connectionId==="runner-gateway";
}

/** Require isolated HTML bytes/Browser evidence, including legacy auto-bound proxy projects. */
export function requiresSandboxHtmlSourceExecution(project:HtmlSourceProject):boolean {
  return hasExecutableHtmlSource(project)
    &&(project.targetConnection.adapter==="artifact"
      ||hasAmbiguousAutoProxyHtmlTarget(project));
}
