// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {acceptedPackageFixture} from "@evolution/testkit";
import {buildServerPlanningDocuments} from "./server-planning-documents";

const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
const html='<html><head><style>PRIVATE_STYLE</style></head><body><article id="slide-1"><h3>入门</h3><p>准备工具</p></article>'
  +'<article id="slide-111"><h3>完整配置</h3><p>默认值、依赖关系和验证结果</p></article><script>PRIVATE_SCRIPT</script></body></html>';
function fixture(){
  const {project:p}=acceptedPackageFixture(false),source=p.sourceArtifacts[0]!;
  source.textContent="STALE INDEX";source.size=Buffer.byteLength(html);
  p.baselineRun.originalReferences=[{schemaVersion:"original-artifact-reference-v1",missionId:p.id,sourceArtifactId:source.id,blobId:source.id,sha256:sha(html),sizeBytes:source.size}];
  const readCurrentText=vi.fn(async()=>html);
  return {p,readCurrentText};
}
beforeEach(()=>vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS","mission"));
afterEach(()=>vi.unstubAllEnvs());
describe("physical complete planning documents",()=>{
  it("reads the SHA-bound full parent rather than the stale upload index",async()=>{
    const x=fixture(),before=structuredClone(x.p),docs=await buildServerPlanningDocuments(x.p,{readCurrentText:x.readCurrentText});
    expect(docs).toHaveLength(1);expect(docs[0]).toMatchObject({sourceArtifactId:"source",parentSha256:sha(html),complete:true});
    expect(docs[0]!.outline).toHaveLength(2);expect(docs[0]!.text).toContain("默认值、依赖关系和验证结果");
    expect(JSON.stringify(docs)).not.toMatch(/PRIVATE_SCRIPT|PRIVATE_STYLE|STALE INDEX/);expect(x.p).toEqual(before);
  });
  it.each(["other-mission","invalid-allowlist"])("does not read or share complete body under %s consent",async kind=>{
    const x=fixture();vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS",kind==="other-mission"?"different":x.p.id+",*");
    expect(await buildServerPlanningDocuments(x.p,{readCurrentText:x.readCurrentText})).toEqual([]);expect(x.readCurrentText).not.toHaveBeenCalled();
  });
  it.each(["changed","missing-reference","duplicate-reference","oversized"])("does not silently truncate or use a %s parent",async kind=>{
    const x=fixture();
    if(kind==="changed")x.readCurrentText.mockResolvedValue(html.replace("准备工具","配置工具"));
    if(kind==="missing-reference")x.p.baselineRun.originalReferences=[];
    if(kind==="duplicate-reference")x.p.baselineRun.originalReferences!.push({...x.p.baselineRun.originalReferences![0]!});
    if(kind==="oversized"){
      const large=html.replace("准备工具","正文".repeat(40_000));x.readCurrentText.mockResolvedValue(large);
      x.p.sourceArtifacts[0]!.size=Buffer.byteLength(large);x.p.baselineRun.originalReferences![0]!.sizeBytes=Buffer.byteLength(large);x.p.baselineRun.originalReferences![0]!.sha256=sha(large);
    }
    await expect(buildServerPlanningDocuments(x.p,{readCurrentText:x.readCurrentText})).rejects.toThrow();
  });
});
