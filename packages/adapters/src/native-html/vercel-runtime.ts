import {randomUUID} from "node:crypto";
import {Sandbox} from "@vercel/sandbox";
import type {SandboxHtmlNativeRequest} from "@evolution/contracts";
import {ensureBrowserRuntimeSnapshot} from "../vercel-sandbox-adapter";
import {getExplicitSandboxCredentials,sandboxCredentialIssue} from "../vercel-sandbox-credentials";
import {runKnownHtmlNativeProfile} from "./runner";

/** No credentials enter the guest, no ports are exposed, and user subjects are never snapshotted. */
export async function createVercelHtmlNativeRuntime(){
  const issue=sandboxCredentialIssue();
  if(issue)throw new Error(issue.message);
  const snapshotId=await ensureBrowserRuntimeSnapshot();
  return Sandbox.create({...getExplicitSandboxCredentials(),name:"evolution-html-native-"+randomUUID(),
    source:{type:"snapshot",snapshotId},timeout:180_000,resources:{vcpus:2},persistent:false,
    networkPolicy:"deny-all",tags:{product:"evolution-os",purpose:"html-native-validation"}});
}

export function runVercelSandboxHtmlNativeProfile(raw:SandboxHtmlNativeRequest){
  return runKnownHtmlNativeProfile(raw,createVercelHtmlNativeRuntime);
}
