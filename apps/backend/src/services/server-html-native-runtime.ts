import {createRequire} from "node:module";
import path from "node:path";
import {z} from "zod";
import type {EvolveProject,SandboxHtmlNativeRequest} from "@evolution/contracts";
import {HTML_NATIVE_KERNEL_SHA256,runVercelSandboxHtmlNativeProfile} from "@evolution/adapters/sandbox";
import {runLocalKnownHtmlNativeProfile,LOCAL_HTML_NATIVE_RUNTIME_VERSION} from "@evolution/adapters/html-native-local";
import {serverHtmlNativeAuthorized,serverLocalHtmlNativeAuthorized} from "./server-html-native-consent";
import {isKnownHtmlNativeSubject} from "@evolution/adapters/html-native-profile";

type LocalRunner=typeof import("@evolution/local-runner");
let local:LocalRunner|undefined;
export const serverLocalHtmlNativeSelected=(project:EvolveProject)=>project.experimentPolicy?.nativeHtmlRuntime==="local-browser-v1";
function localRunner(){
  if(process.env.VERCEL||Number(process.versions.node.split(".")[0])<22)throw Error("Local native runtime requires a local Node 22+ process");
  // Local-only public workspace dependency. It remains outside the deployed application bundle.
  const name="@evolution/local-runner";
  return local??=(createRequire(path.join(process.cwd(),"package.json"))(name) as LocalRunner);
}
const localReadiness=z.object({ready:z.literal(true),assertions:z.literal(20),browserVersion:z.string().min(1).max(160),kernelSha256:z.string().regex(/^[a-f0-9]{64}$/),runId:z.string().regex(/^local-native-[a-zA-Z0-9-]+$/).max(200)}).strict();
export async function assertServerLocalHtmlBrowserReady(project:EvolveProject){
  if(!serverLocalHtmlNativeSelected(project)||!serverLocalHtmlNativeAuthorized(project.id))throw Error("Local native browser execution is not authorized");
  const targets=project.sourceArtifacts.filter(source=>source.role==="target");
  if(!targets.length||targets.some(source=>!/^html?$/i.test(source.extension)||!isKnownHtmlNativeSubject(source.textContent??"")))throw Error("Local native preflight requires known complete HTML targets");
  const runner=localRunner(),expected=runner.localNativeKernelIdentity().kernelSha256;
  const observed=localReadiness.parse(await runner.probeLocalNativeBrowser());
  if(observed.kernelSha256!==expected)throw Error("Local browser preflight kernel identity differs");
}
export function serverNativeHtmlRuntime(project:EvolveProject){
  if(!serverLocalHtmlNativeSelected(project))return {local:false,authorized:serverHtmlNativeAuthorized(project.id),kernelSha256:HTML_NATIVE_KERNEL_SHA256,fingerprint:HTML_NATIVE_KERNEL_SHA256,execute:(request:SandboxHtmlNativeRequest)=>runVercelSandboxHtmlNativeProfile(request)};
  let kernelSha256:string|undefined;
  try{kernelSha256=localRunner().localNativeKernelIdentity().kernelSha256;}catch{ /* Capability stays unavailable; never fall back to cloud. */ }
  return {local:true,authorized:serverLocalHtmlNativeAuthorized(project.id),kernelSha256,
    fingerprint:JSON.stringify([LOCAL_HTML_NATIVE_RUNTIME_VERSION,kernelSha256??"unavailable"]),
    execute:async(request:SandboxHtmlNativeRequest)=>{
      if(!serverLocalHtmlNativeAuthorized(project.id)||!kernelSha256)throw Error("Local native execution is not authorized or available");
      return runLocalKnownHtmlNativeProfile(request,{kernelSha256,execute:args=>localRunner().executeLocalNativeHtml(args)});
    }};
}
