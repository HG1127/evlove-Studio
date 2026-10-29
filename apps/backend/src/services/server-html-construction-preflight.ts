import {HtmlSemanticLayoutError,HtmlOriginalCodeRetentionError,HtmlParagraphConstructionError,HtmlNumberedListConstructionError,HtmlRendererStepNumberError} from "@evolution/core";

type CheckError=HtmlSemanticLayoutError|HtmlOriginalCodeRetentionError|HtmlParagraphConstructionError|HtmlNumberedListConstructionError|HtmlRendererStepNumberError;
export type ServerHtmlConstructionFailure={stage:"before-layout"|"after-layout";error:CheckError};
export const isServerHtmlConstructionCheckError=(error:unknown):error is CheckError=>error instanceof HtmlSemanticLayoutError
  ||error instanceof HtmlOriginalCodeRetentionError||error instanceof HtmlParagraphConstructionError||error instanceof HtmlNumberedListConstructionError||error instanceof HtmlRendererStepNumberError;

/** Known static facts from one rejected proposal, never evaluation or provider failures. */
export class ServerHtmlConstructionPreflightError extends Error{
  readonly code="HTML_CONSTRUCTION_PREFLIGHT_FAILED";
  readonly policy="html-construction-feedback-v1";
  readonly failures:ServerHtmlConstructionFailure[];
  constructor(failures:ServerHtmlConstructionFailure[]){
    if(failures.length<2||failures.length>5||failures.some(f=>!isServerHtmlConstructionCheckError(f.error))
      ||new Set(failures.map(f=>f.error.code)).size!==failures.length)throw new Error("Construction aggregation requires distinct measured static errors");
    super("HTML pre-freeze checks failed: "+failures.map(f=>f.error.code).join(", "));
    this.name="ServerHtmlConstructionPreflightError";this.failures=failures;
  }
}
