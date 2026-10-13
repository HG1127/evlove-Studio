import { createHash } from "node:crypto";
import { isBuiltin } from "node:module";
import path from "node:path";
import { build, type Plugin } from "vite";

export const HTML_PROTECTION_RUNTIME_MODULE="virtual:evolution-html-protection-runtime";
const resolvedModule="\0"+HTML_PROTECTION_RUNTIME_MODULE;
const runtimeVersion="html-protection-private-cloud-v1" as const;
const maximumRuntimeBytes=4*1024*1024;
export type BuiltHtmlProtectionRuntime={version:typeof runtimeVersion;sha256:string;byteLength:number;text:string};

/** Compile owned repository code only. Never execute or compile Mission/model supplied code. */
export async function buildOwnedHtmlProtectionRuntime(projectRoot:string):Promise<BuiltHtmlProtectionRuntime>{
  const output=await build({
    configFile:false,envFile:false,root:projectRoot,logLevel:"error",
    resolve:{alias:{"@evolution/contracts":path.join(projectRoot,"packages/contracts/src/index.ts")}},
    ssr:{noExternal:true},
    build:{
      ssr:path.join(projectRoot,"packages/adapters/src/vercel-sandbox-html-protection-cloud-runtime.ts"),
      write:false,minify:false,sourcemap:false,target:"node24",
      rolldownOptions:{external:(id)=>isBuiltin(id),output:{format:"es",inlineDynamicImports:true}},
    },
  });
  if(Array.isArray(output)||!("output" in output)||output.output.length!==1){
    throw new Error("Owned HTML runtime must emit one self-contained ESM chunk");
  }
  const chunk=output.output[0];
  if(!chunk||chunk.type!=="chunk"||chunk.dynamicImports.length||chunk.imports.some(id=>!isBuiltin(id))
    ||!chunk.exports.includes("runPrivateHtmlProtectionCloudRuntime")||!chunk.exports.includes("runPrivateHtmlProtectionSearchCloudRuntime")){
    throw new Error("Owned HTML runtime contains unsupported external code");
  }
  const bytes=Buffer.from(chunk.code,"utf8");
  if(!bytes.byteLength||bytes.byteLength>maximumRuntimeBytes)throw new Error("Owned HTML runtime size unavailable");
  return Object.freeze({version:runtimeVersion,sha256:createHash("sha256").update(bytes).digest("hex"),byteLength:bytes.byteLength,text:chunk.code});
}

/** Server-only module embeds fixed build bytes and its independently built expectation. */
export function htmlProtectionRuntimePlugin():Plugin{
  let root=process.cwd(),compiled:Promise<BuiltHtmlProtectionRuntime>|undefined;
  return {
    name:"evolution-owned-html-protection-runtime",
    configResolved(config){root=config.root;},
    async buildStart(){
      // Compile even if no Mission currently selects this optional collector. Never emit it to client assets.
      compiled??=buildOwnedHtmlProtectionRuntime(root).catch(error=>{compiled=undefined;throw error;});
      await compiled;
    },
    resolveId(id){
      if(id!==HTML_PROTECTION_RUNTIME_MODULE)return;
      if(this.environment?.name==="client")throw new Error("Private HTML runtime is server-only");
      return resolvedModule;
    },
    async load(id){
      if(id!==resolvedModule)return;
      if(this.environment?.name==="client")throw new Error("Private HTML runtime is server-only");
      compiled??=buildOwnedHtmlProtectionRuntime(root).catch(error=>{compiled=undefined;throw error;});
      const runtime=await compiled;
      return "export default Object.freeze("+JSON.stringify(runtime)+");";
    },
  };
}
