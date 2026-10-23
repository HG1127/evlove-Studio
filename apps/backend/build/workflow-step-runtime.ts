import {pathToFileURL} from "node:url";
import {isAbsolute} from "node:path";
import {normalizePath,type Plugin} from "vite";

/** Compatibility shim for Workflow 4.8's dev Step bundle under Nitro's Vite evaluator. */
export function workflowStepModuleCode(code:string,id:string):string|undefined{
  const file=id.split("?")[0]!;
  if(!isAbsolute(file)||!normalizePath(file).endsWith("/.nitro/workflow/steps.mjs"))return undefined;
  if(/\b(?:const|let|var)\s+require\s*=/.test(code))return undefined;
  // These imports are explicitly externalized by the SDK builder. Vite's module
  // runner still inlines relative file imports, including their CommonJS children.
  // Keep them in Node's native loader; keep registered Steps in the generated bundle.
  const external=/^import\s+(?:(.+?)\s+from\s+)?(["'])(\.\.\/\.\.\/\.pnpm\/[^"'\r\n]+)\2;?$/gm;
  let replaced=false;
  const bridged=code.replace(external,(original:string,binding:string|undefined,_quote:string,source:string)=>{
    const call=`require(${JSON.stringify(source)})`;
    if(!binding){replaced=true;return call+";";}
    const named=binding.startsWith("{");
    const namespace=binding.match(/^\*\s+as\s+(\w+)$/);
    if(!named&&!namespace)return original;
    replaced=true;
    const target=named?binding.replace(/\s+as\s+/g,": "):namespace![1];
    return `const ${target}=${call};`;
  });
  if(!replaced&&!code.includes("Dynamic require of"))return undefined;
  // The require base is the physical file, even under Vite's virtual evaluation.
  const base=JSON.stringify(pathToFileURL(file).href);
  return `import {createRequire as __evolutionStepCreateRequire} from "node:module";\nconst require=__evolutionStepCreateRequire(${base});\n${bridged}`;
}

export function workflowStepRuntimePlugin():Plugin{
  return {
    name:"evolution-workflow-step-runtime",apply:"serve",enforce:"pre",
    transform(code,id){
      const transformed=workflowStepModuleCode(code,id);
      return transformed===undefined?null:{code:transformed,map:null};
    },
  };
}
