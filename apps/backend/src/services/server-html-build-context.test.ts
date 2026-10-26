// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {acceptedPackageFixture} from "@evolution/testkit";
import {applyExactEdits,htmlRepairTextNodeContext} from "@evolution/core";
import {serverHtmlBuildBodyContext} from "./server-html-build-context";
import {buildServerCandidateTargetContext} from "./server-candidate-context";
const {known}=vi.hoisted(()=>({known:vi.fn(()=>true)}));
vi.mock("@evolution/adapters/html-native-profile",()=>({isKnownHtmlNativeSubject:known}));
const original='<html><head><script>const HEAD_SECRET_PROGRAM=true;</script><style>p{color:magenta}</style></head><body><article class="slide-card" id="slide-11"><div class="slide-body"><div class="content-block"><div class="text-lines"><p>非常适合</p><p>内部工具 &amp; 参数 🚀</p></div></div><p>最后一个正文节点</p></div></article><script>const BODY_SECRET_PROGRAM=true;</script></body></html>';
afterEach(()=>{vi.unstubAllEnvs();known.mockReturnValue(true);});
describe("complete authorized initial HTML build context",()=>{
  it("provides every body node and exact full-source offsets without script/style or raw-attribute indexes",()=>{
    vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS","mission");
    const result=serverHtmlBuildBodyContext("mission","html",original)!;
    expect(result.context.parentSha256).toBe(createHash("sha256").update(original).digest("hex"));
    expect(result.context.anchors).toHaveLength(htmlRepairTextNodeContext(original).length);
    expect(result.context.components).toEqual([{section:"slide-11",label:"非常适合",paragraphCount:2}]);
    const wire=JSON.stringify(result);
    expect(wire).not.toContain("HEAD_SECRET_PROGRAM");expect(wire).not.toContain("BODY_SECRET_PROGRAM");expect(wire).not.toContain("magenta");
    for(const anchor of result.context.anchors)expect(original.slice(anchor.start,anchor.end)).toBe(anchor.before);
    const last=result.context.anchors.at(-1)!;
    expect(applyExactEdits(original,JSON.stringify({kind:"text-edits",edits:[{before:last.before,start:last.start,end:last.end,after:"真实新增配置说明"}]}),{strict:true})).toContain("真实新增配置说明");
  });
  it.each(["no-consent","wrong-mission","other-format"])("does not broaden %s body sharing",kind=>{
    vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS",kind==="no-consent"?"":"mission");
    expect(serverHtmlBuildBodyContext(kind==="wrong-mission"?"other":"mission",kind==="other-format"?"md":"html",original)).toBeUndefined();
  });
  it("keeps unknown renderers within body-only consent without inventing known-profile constraints or falling back to raw scripts",()=>{
    vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS","mission");known.mockReturnValue(false);
    const result=serverHtmlBuildBodyContext("mission","html",original)!;
    expect(result.context.anchors).toHaveLength(htmlRepairTextNodeContext(original).length);
    expect(result.context.components).toEqual([]);expect(JSON.stringify(result)).not.toMatch(/SECRET_PROGRAM|magenta/);
  });
  it("keeps all distant chapters available while allowing exact markup edits beyond the partial retrieval",async()=>{
    const {project,current:candidate}=acceptedPackageFixture(false);vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS",project.id);
    const chapters=Array.from({length:40},(_,i)=>`<article class="slide-card" id="slide-${i+1}"><div class="slide-body"><p>第${i+1}章 ${"保持原有信息。".repeat(100)}</p></div></article>`).join("");
    const source=original.replace(/<article[\s\S]*<\/article>/,chapters);
    const artifact=project.sourceArtifacts[0]!;Object.assign(artifact,{extension:"html",mimeType:"text/html",structuredContent:{entries:[{path:"head",content:"RAW_STRUCTURED_SECRET"}]}});
    const [context]=await buildServerCandidateTargetContext(project,candidate,async()=>source);
    expect(context?.truncated).toBe(true);expect(context?.mutationMode).toBe("text-edits");expect(context?.bodyIndexComplete).toBe(true);
    expect(context?.chunkOffsetsAreProjectionOnly).toBe(true);expect(context?.structuredContext).toBeUndefined();
    expect(context?.htmlBuildBodyContext?.anchors).toHaveLength(40);
    expect(context?.htmlBuildBodyContext?.anchors.at(-1)?.before).toContain("第40章");
    expect(JSON.stringify(context)).not.toContain("HEAD_SECRET_PROGRAM");expect(JSON.stringify(context)).not.toContain("RAW_STRUCTURED_SECRET");
  });
});
