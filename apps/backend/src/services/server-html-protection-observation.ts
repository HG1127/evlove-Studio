import {
  createVercelSandboxHtmlProtectionBrowser,runVercelSandboxHtmlProtectionCloudObservation,
  HtmlProtectionOwnedRuntimeBindingSchema,HTML_PROTECTION_CLOUD_LIMITS,
  type HtmlProtectionPreparedBrowserFactory,
} from "@evolution/adapters/sandbox";
import { HtmlProtectionSnapshotRequestSchema, type HtmlProtectionSnapshotRequest } from "@evolution/contracts";
import { z } from "zod";

const OwnedRuntimeModuleSchema=HtmlProtectionOwnedRuntimeBindingSchema.extend({text:z.string().max(HTML_PROTECTION_CLOUD_LIMITS.runtimeBytes)}).strict();
type OwnedRuntimeModule=z.infer<typeof OwnedRuntimeModuleSchema>;
type RuntimeLoader=()=>Promise<OwnedRuntimeModule>;
const deploymentRuntime:RuntimeLoader=async()=>{
  const module=await import("virtual:evolution-html-protection-runtime");
  return module.default;
};
/** App composition only. These ports cannot be supplied through a Mission/AI/HTTP request. */
export function createServerHtmlProtectionObserver(ports:{
  loadOwnedRuntime?:RuntimeLoader;
  createPreparedBrowserSandbox?:HtmlProtectionPreparedBrowserFactory["createPreparedBrowserSandbox"];
}={}){
  const load=ports.loadOwnedRuntime??deploymentRuntime;
  const create=ports.createPreparedBrowserSandbox??createVercelSandboxHtmlProtectionBrowser;
  return async(args:{request:HtmlProtectionSnapshotRequest;physicalHtml:Uint8Array})=>{
    const request=HtmlProtectionSnapshotRequestSchema.parse(args.request);
    if(args.physicalHtml.byteLength>HTML_PROTECTION_CLOUD_LIMITS.htmlBytes){
      return runVercelSandboxHtmlProtectionCloudObservation({request,physicalHtml:args.physicalHtml});
    }
    const input={request,physicalHtml:Buffer.from(args.physicalHtml)};
    let runtime:OwnedRuntimeModule;
    try{runtime=OwnedRuntimeModuleSchema.parse(await load());}catch{
      return runVercelSandboxHtmlProtectionCloudObservation(input);
    }
    // The generated module is deployment-owned. Bounds and schema precede any VM creation.
    const expected=HtmlProtectionOwnedRuntimeBindingSchema.safeParse({version:runtime.version,sha256:runtime.sha256,byteLength:runtime.byteLength});
    if(!expected.success||Buffer.byteLength(runtime.text,"utf8")>HTML_PROTECTION_CLOUD_LIMITS.runtimeBytes){
      return runVercelSandboxHtmlProtectionCloudObservation(input);
    }
    const bytes=Buffer.from(runtime.text,"utf8");
    return runVercelSandboxHtmlProtectionCloudObservation(input,{
      trustedRuntimeBinding:expected.data,trustedRuntimeBytes:bytes,createPreparedBrowserSandbox:create,
    });
  };
}
export const collectServerHtmlProtectionObservation=createServerHtmlProtectionObserver();
