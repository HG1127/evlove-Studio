// @vitest-environment node
import {mkdtemp,mkdir,writeFile,unlink,rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {workflowStepModuleCode} from "./workflow-step-runtime";

describe("Workflow dev Step CommonJS compatibility",()=>{
  it("resolves a bundled dependency relative to the physical Step file under virtual evaluation",async()=>{
    const root=await mkdtemp(join(tmpdir(),"evolution-step-load-"));
    const dir=join(root,".nitro","workflow");
    try{
      await mkdir(dir,{recursive:true});
      await mkdir(join(root,".pnpm"));
      await writeFile(join(root,".pnpm","external.cjs"),'module.exports={value:42}');
      await writeFile(join(dir,"fixture.cjs"),'module.exports={loaded:true}');
      const source='import {value as alias} from "../../.pnpm/external.cjs";\nimport * as namespace from "../../.pnpm/external.cjs";\nimport "../../.pnpm/external.cjs";\nexport const native=[alias,namespace.value];\nconst __require=(path)=>{if(typeof require!=="undefined")return require(path);throw Error("Dynamic require of "+path+" is not supported")}; export const loaded=__require("./fixture.cjs").loaded;';
      const transformed=workflowStepModuleCode(source,join(dir,"steps.mjs")+"?revision=2")!;
      const result=await import("data:text/javascript;base64,"+Buffer.from(transformed).toString("base64"));
      expect(result.loaded).toBe(true);
      expect(result.native).toEqual([42,42]);
    }finally{
      await unlink(join(dir,"fixture.cjs")).catch(()=>{});
      await rmdir(dir).catch(()=>{});
      await rmdir(join(root,".nitro")).catch(()=>{});
      await unlink(join(root,".pnpm","external.cjs")).catch(()=>{});
      await rmdir(join(root,".pnpm")).catch(()=>{});
      await rmdir(root);
    }
  });
  it("limits the bridge to generated server Steps and avoids duplicate bindings",()=>{
    const source='throw Error("Dynamic require of")';
    expect(workflowStepModuleCode(source,join(tmpdir(),"client.mjs"))).toBeUndefined();
    expect(workflowStepModuleCode('const require=existing;'+source,join(tmpdir(),".nitro/workflow/steps.mjs"))).toBeUndefined();
  });
});
