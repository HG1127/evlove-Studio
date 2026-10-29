import {z} from "zod";
import {HtmlNativeLocalBoundarySchema,SandboxHtmlNativeRequestSchema,SandboxHtmlNativeResponseSchema,type SandboxHtmlNativeRequest,type SandboxHtmlNativeResponse} from "@evolution/contracts";
import {isSourceGroundedHtmlSearchPlan,novelHtmlSearchQueries} from "@evolution/core";
import {identifyHtmlNativeSubjects,nativeHtmlSha256,type HtmlNativeProfile} from "./profile";
import {RawNativeObservationSchema,settleNativeHtmlMeasurement} from "./measurement";

export const LOCAL_HTML_NATIVE_RUNTIME_VERSION="native-html-local-browser-v1";
export type LocalHtmlNativeKernelPort={
  kernelSha256:string;
  execute(args:{inputs:{originalSha256:string;subjectSha256:string;expectedCardCount:number;contentSearchQueries:Array<{cardId:string;query:string}>;browserAssertions?:SandboxHtmlNativeRequest["browserAssertions"]};subjects:{original:Uint8Array;candidate:Uint8Array};timeoutMs:number}):Promise<unknown>;
};
const resultSchema=z.object({measurement:RawNativeObservationSchema,browserVersion:z.string().min(1).max(160),runId:z.string().regex(/^local-native-[a-zA-Z0-9-]+$/).max(200),kernelSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();

/** User bytes are parsed as data here and executed only inside the injected browser process sandbox. */
export async function runLocalKnownHtmlNativeProfile(raw:SandboxHtmlNativeRequest,port:LocalHtmlNativeKernelPort,profiles?:readonly HtmlNativeProfile[]):Promise<SandboxHtmlNativeResponse>{
  const parsed=SandboxHtmlNativeRequestSchema.parse(raw),args={...parsed,original:new Uint8Array(parsed.original),subject:new Uint8Array(parsed.subject)};
  const unavailable=(reason:string)=>SandboxHtmlNativeResponseSchema.parse({status:"unavailable",reason});
  if(!/^[a-f0-9]{64}$/.test(port.kernelSha256)||nativeHtmlSha256(args.original)!==args.expectedOriginalSha256||nativeHtmlSha256(args.subject)!==args.expectedSubjectSha256)return unavailable("Local native input or trusted kernel identity differs.");
  try{
    const decoder=new TextDecoder("utf-8",{fatal:true}),originalHtml=decoder.decode(args.original),subjectHtml=decoder.decode(args.subject);
    if(args.browserAssertions?.plans.some(plan=>!isSourceGroundedHtmlSearchPlan(originalHtml,plan)))return unavailable("Local native browser predicates differ from the physical Original.");
    const identity=identifyHtmlNativeSubjects(originalHtml,subjectHtml,profiles);if(!identity)return unavailable("No known local native renderer profile matches both physical subjects.");
    const contentSearchQueries=novelHtmlSearchQueries(originalHtml,subjectHtml),rawResult=await port.execute({
      inputs:{originalSha256:args.expectedOriginalSha256,subjectSha256:args.expectedSubjectSha256,expectedCardCount:identity.protection.originalSlideCardCount,contentSearchQueries,...(args.browserAssertions?{browserAssertions:args.browserAssertions}:{})},
      subjects:{original:args.original,candidate:args.subject},timeoutMs:170000,
    });
    const result=resultSchema.parse(rawResult);if(result.kernelSha256!==port.kernelSha256)return unavailable("Local observer implementation differs from its registered identity.");
    const boundary=HtmlNativeLocalBoundarySchema.parse({kind:"local-browser-process-sandbox-v1",runId:result.runId,browserVersion:result.browserVersion,
      chromiumSandbox:true,headless:true,freshProcessPerSubject:true,networkPolicy:"deny-all",serviceWorkers:"block",downloads:false,popups:"blocked",credentialEnvironment:"excluded",storage:"ephemeral"});
    return settleNativeHtmlMeasurement(args,identity,result.measurement,contentSearchQueries,port.kernelSha256,boundary);
  }catch{return unavailable("Local sandboxed native browser execution did not complete; original evidence stays unverified.");}
}
