import type {Sandbox} from "@vercel/sandbox";
import {z} from "zod";
import {HTML_NATIVE_OBSERVATION_VERSION,HTML_NATIVE_STYLE_STATE_POLICY,HtmlNativeBrowserAssertionsSchema,HtmlNativeObservationSchema,HtmlNativeStyleComparisonSchema,HtmlNativeSubjectSchema,
  SandboxHtmlNativeRequestSchema,SandboxHtmlNativeResponseSchema,type SandboxHtmlNativeRequest,type SandboxHtmlNativeResponse} from "@evolution/contracts";
import {fastHash,isSourceGroundedHtmlSearchPlan,novelHtmlSearchQueries} from "@evolution/core";
import {HTML_NATIVE_KERNEL_SOURCE} from "./kernel";
import {identifyHtmlNativeSubjects,nativeHtmlSha256,type HtmlNativeProfile} from "./profile";

const RawSubject=HtmlNativeSubjectSchema.omit({bodyTextFingerprint:true}).extend({label:z.enum(["original","candidate"]),bodyText:z.string().min(1).max(64_000),fatal:z.object({name:z.string().max(160),message:z.string().max(500)}).nullish()}).strip();
const RawObservation=z.object({observedAt:z.iso.datetime(),results:z.array(RawSubject).length(2),styleComparison:z.array(HtmlNativeStyleComparisonSchema).length(2),browserAssertions:HtmlNativeBrowserAssertionsSchema.optional()}).strict();
const NativeWire=z.object({schemaVersion:z.literal("native-html-output-v1"),sizeBytes:z.number().int().positive().max(1_000_000),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),payloadBase64:z.string().min(1).max(1_333_336).regex(/^[A-Za-z0-9+/]*={0,2}$/)}).strict();
export const HTML_NATIVE_KERNEL_SHA256=nativeHtmlSha256(HTML_NATIVE_KERNEL_SOURCE);

/** createSandbox is supplied by the existing Sandbox composition; the host only transports bytes. */
export async function runKnownHtmlNativeProfile(raw:SandboxHtmlNativeRequest,createSandbox:()=>Promise<Sandbox>,profiles?:readonly HtmlNativeProfile[]):Promise<SandboxHtmlNativeResponse>{
  const args=SandboxHtmlNativeRequestSchema.parse(raw);
  const unavailable=(reason:string)=>SandboxHtmlNativeResponseSchema.parse({status:"unavailable",reason});
  if(nativeHtmlSha256(args.original)!==args.expectedOriginalSha256||nativeHtmlSha256(args.subject)!==args.expectedSubjectSha256)return unavailable("Native profile input does not match its physical SHA-256 binding.");
  const decoder=new TextDecoder("utf-8",{fatal:true});
  let originalHtml:string,subjectHtml:string;
  try{originalHtml=decoder.decode(args.original);subjectHtml=decoder.decode(args.subject);}catch{return unavailable("Native profile requires complete UTF-8 HTML subjects.");}
  if(args.browserAssertions?.plans.some(plan=>!isSourceGroundedHtmlSearchPlan(originalHtml,plan)))return unavailable("Declared predicates are not an exact source-grounded search plan.");
  let identity:ReturnType<typeof identifyHtmlNativeSubjects>;
  try{identity=identifyHtmlNativeSubjects(originalHtml,subjectHtml,profiles);}catch{return unavailable("The complete native subject could not be parsed safely.");}
  if(!identity)return unavailable("No complete known native profile matches this program/style surface; ordinary evidence stays partial.");
  const contentSearchQueries=novelHtmlSearchQueries(originalHtml,subjectHtml);
  let sandbox:Sandbox|undefined;
  try{
    sandbox=await createSandbox();
    const cwd=sandbox.cwd;
    const directory=await sandbox.runCommand({cmd:"mkdir",args:["-p",cwd+"/.evolution/private"],cwd});
    if(directory.exitCode!==0)return unavailable("The isolated native observation directory is unavailable.");
    const input={originalSha256:args.expectedOriginalSha256,subjectSha256:args.expectedSubjectSha256,
      expectedCardCount:identity.protection.originalSlideCardCount,contentSearchQueries,...(args.browserAssertions?{browserAssertions:args.browserAssertions}:{})};
    await sandbox.writeFiles([
      {path:cwd+"/.evolution/private/original.html",content:Buffer.from(args.original)},
      {path:cwd+"/.evolution/private/candidate.html",content:Buffer.from(args.subject)},
      {path:cwd+"/.evolution/private/native-input.json",content:Buffer.from(JSON.stringify(input))},
      {path:cwd+"/.evolution/runtime/native-html-profile.mjs",content:Buffer.from(HTML_NATIVE_KERNEL_SOURCE)},
    ]);
    const command=await sandbox.runCommand({cmd:"node",args:[cwd+"/.evolution/runtime/native-html-profile.mjs"],cwd,timeoutMs:170_000});
    if(command.exitCode!==0)return unavailable("The isolated native profile could not complete; no acceptance verdict is inferred.");
    const stdout=await command.stdout();if(stdout.length>1_400_000)return unavailable("Native profile result exceeds its observation boundary.");
    const wire=NativeWire.safeParse(JSON.parse(stdout));if(!wire.success)return unavailable("Native profile result has no complete byte-verified transport envelope.");
    const payload=Buffer.from(wire.data.payloadBase64,"base64");
    if(payload.length!==wire.data.sizeBytes||nativeHtmlSha256(payload)!==wire.data.sha256||payload.toString("base64")!==wire.data.payloadBase64)
      return unavailable("Native profile transport byte count or SHA-256 differs; no document evidence is inferred.");
    const parsed=RawObservation.safeParse(JSON.parse(decoder.decode(payload)));if(!parsed.success)return unavailable("Native profile result is incomplete or has an unsupported observation shape.");
    const measured=parsed.data,original=measured.results.find(row=>row.label==="original"),subject=measured.results.find(row=>row.label==="candidate");
    if(JSON.stringify(measured.browserAssertions)!==JSON.stringify(args.browserAssertions))return unavailable("Native profile declared predicate receipt differs from the requested plan.");
    if(!original||!subject||original.fatal||subject.fatal||original.sha256!==args.expectedOriginalSha256||subject.sha256!==args.expectedSubjectSha256)return unavailable("Native profile result has a missing/mismatched physical subject.");
    if(measured.styleComparison.some(row=>!row.state||row.state.policy!==HTML_NATIVE_STYLE_STATE_POLICY||row.state.original.requestedHref!==original.inventory.internalLinks[0]
      ||row.state.subject.requestedHref!==original.inventory.internalLinks[0]))return unavailable("Native style comparison lacks its recorded Original navigation binding.");
    const observation=HtmlNativeObservationSchema.parse({
      schemaVersion:HTML_NATIVE_OBSERVATION_VERSION,profileId:identity.profile.id,isolation:"network-denied-ephemeral",observedAt:measured.observedAt,kernelSha256:HTML_NATIVE_KERNEL_SHA256,
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
        "Page-copy whitespace is normalized; original code blocks and prompt-copy internal whitespace are checked separately."]});
    return SandboxHtmlNativeResponseSchema.parse({status:"observed",observation,subjectText:subject.bodyText});
  }catch{return unavailable("The isolated native profile is unavailable; original evidence and unknown states must be retained.");}
  finally{if(sandbox)await sandbox.stop();}
}
