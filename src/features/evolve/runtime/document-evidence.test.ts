import { it, expect } from "vitest";
import { demoProject } from "../data/mock-project";
import { EvolveProjectSchema, type TestCase } from "../schemas";
import { runStaticEvidence, runRoundtripEvidence } from "./static-evidence";
function fixture() {
 const p=EvolveProjectSchema.parse(structuredClone(demoProject));
 p.sourceArtifacts=[{id:"doc",name:"guide.txt",role:"target",artifactKind:"document",extension:"txt",textContent:"# 使用说明\n这是完整的当前文档。",structure:[]} as unknown as typeof p.sourceArtifacts[number]];
 const t={id:"case",title:"检查文档结构",input:"检查当前内容",expected:["说明"],evidenceScope:"implementation",criterionIds:[]} as unknown as TestCase;
 return {p,t};
}
it("单份非代码文档可以提供静态内容证据",async()=>{
 const {p,t}=fixture();expect((await runStaticEvidence(p,t)).verificationStatus).toBe("verified");
});
it("静态内容不能代替真实行为验证",async()=>{
 const {p,t}=fixture();t.evidenceScope="product-behavior";expect((await runStaticEvidence(p,t)).verificationStatus).toBe("partial");
});
it("纯文本实际执行编码回读而非仅检查适配器",async()=>{
 const {p,t}=fixture();const result=await runRoundtripEvidence(p,t);expect(result.verificationStatus).toBe("verified");expect(result.output).toContain('"preserved":true');
});
it("空文件不能伪造可用内容证据",async()=>{
 const {p,t}=fixture();p.sourceArtifacts[0].textContent="";expect((await runStaticEvidence(p,t)).verificationStatus).toBe("unverified");
});
