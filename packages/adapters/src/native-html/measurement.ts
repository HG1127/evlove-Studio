import {z} from "zod";
import {HTML_NATIVE_OBSERVATION_VERSION,HTML_NATIVE_LOCAL_OBSERVATION_VERSION,HTML_NATIVE_STYLE_STATE_POLICY,HtmlNativeBrowserAssertionsSchema,HtmlNativeObservationSchema,HtmlNativeStyleComparisonSchema,HtmlNativeSubjectSchema,
  SandboxHtmlNativeResponseSchema,type SandboxHtmlNativeRequest,type SandboxHtmlNativeResponse,type HtmlNativeLocalBoundarySchema} from "@evolution/contracts";
import {fastHash} from "@evolution/core";
import {identifyHtmlNativeSubjects} from "./profile";

const RawSubject=HtmlNativeSubjectSchema.omit({bodyTextFingerprint:true}).extend({label:z.enum(["original","candidate"]),bodyText:z.string().min(1).max(64_000),fatal:z.object({name:z.string().max(160),message:z.string().max(500)}).nullish()}).strip();
export const RawNativeObservationSchema=z.object({observedAt:z.iso.datetime(),results:z.array(RawSubject).length(2),styleComparison:z.array(HtmlNativeStyleComparisonSchema).length(2),browserAssertions:HtmlNativeBrowserAssertionsSchema.optional()}).strict();
/** Mirrors the VM measurement checks without changing that legacy producer; no semantic verdict is inferred. */
export function settleNativeHtmlMeasurement(args:SandboxHtmlNativeRequest,identity:NonNullable<ReturnType<typeof identifyHtmlNativeSubjects>>,measured:z.infer<typeof RawNativeObservationSchema>,contentSearchQueries:Array<{cardId:string;query:string}>,kernelSha256:string,executionBoundary?:z.infer<typeof HtmlNativeLocalBoundarySchema>):SandboxHtmlNativeResponse{
  const unavailable=(reason:string)=>SandboxHtmlNativeResponseSchema.parse({status:"unavailable",reason});
  const original=measured.results.find(row=>row.label==="original"),subject=measured.results.find(row=>row.label==="candidate");
  if(JSON.stringify(measured.browserAssertions)!==JSON.stringify(args.browserAssertions))return unavailable("Native profile declared predicate receipt differs from the requested plan.");
  if(!original||!subject||original.fatal||subject.fatal||original.sha256!==args.expectedOriginalSha256||subject.sha256!==args.expectedSubjectSha256)return unavailable("Native profile result has a missing/mismatched physical subject.");
  if(measured.styleComparison.some(row=>!row.state||row.state.policy!==HTML_NATIVE_STYLE_STATE_POLICY||row.state.original.requestedHref!==original.inventory.internalLinks[0]
    ||row.state.subject.requestedHref!==original.inventory.internalLinks[0]))return unavailable("Native style comparison lacks its recorded Original navigation binding.");
  const observation=HtmlNativeObservationSchema.parse({
    schemaVersion:executionBoundary?HTML_NATIVE_LOCAL_OBSERVATION_VERSION:HTML_NATIVE_OBSERVATION_VERSION,profileId:identity.profile.id,isolation:"network-denied-ephemeral",observedAt:measured.observedAt,kernelSha256,
    programSignature:identity.original.signature,styleSignature:identity.original.styleSignature,originalCodeBlocksRetained:identity.originalCodeBlocksRetained,
    codeBlockRetention:identity.codeBlockRetention,
    originalNamedElementsRetained:identity.protection.originalNamedIdentitiesWithCanonicalSearchRetained===true,
    originalNamedElementCount:identity.protection.originalNamedElementCount,
    rawNamedAttributesRetained:identity.protection.originalNamedElementsRetained,
    derivedSearchMetadataUpdates:identity.protection.canonicalSearchIndexChangedIds?.length??0,
    originalInteractiveSequenceRetained:identity.protection.originalInteractiveElementSequenceRetained,
    originalSlideCardOrderRetained:identity.protection.slideCardOrderUnchanged,contentSearchQueries,
    ...(measured.browserAssertions?{browserAssertions:measured.browserAssertions}:{}),
    original:HtmlNativeSubjectSchema.strip().parse({...original,bodyTextFingerprint:fastHash(original.bodyText)}),
    subject:HtmlNativeSubjectSchema.strip().parse({...subject,bodyTextFingerprint:fastHash(subject.bodyText)}),styleComparison:measured.styleComparison,
    billingStatus:"unavailable",limitations:["Known self-contained HTML renderer profile only; unknown scripts/styles/templates/frames remain unsupported.",
      "Observed execution and rendered text do not declare semantic quality, independent final acceptance or actual user benefit.",
      "Page-copy whitespace is normalized; original code blocks and prompt-copy internal whitespace are checked separately.",
      ...(executionBoundary?["Local sandboxed browser processes are not a cloud virtual machine or production deployment attestation."]:[])],
    ...(executionBoundary?{executionBoundary}:{}),
  });
  return SandboxHtmlNativeResponseSchema.parse({status:"observed",observation,subjectText:subject.bodyText});
}
