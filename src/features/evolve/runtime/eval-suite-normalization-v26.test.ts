import { describe, expect, it } from "vitest";
import type { EvolveProject, TestCase } from "../schemas";
import { criterionCanUseLocalSnapshotEvidence, evidenceRouteForCriterion, normalizeEvalSuiteForProject } from "./eval-suite-normalization";

const project = {
  objectType: "codebase",
  evolutionCommand: "进化该系统，从系统成果物输入兼容、流程完整闭环、UIux更符合产品审美和操作习惯等角度去进化。",
  targetConnection: { adapter:"artifact" },
  semanticEvolution: { semanticObject: { typeId:"software-system" } },
  sourceArtifacts: [{ role:"target", artifactKind:"codebase" }],
  acceptanceRubric: [
    { id:"USER-INPUT-COMPAT",title:"成果物输入兼容",requirement:"真实用户可上传多类成果物并进入正确流程",source:"user-command",weight:35,hardGate:true,judgeType:"llm",validationMethod:"user-scenario",minScore:90,evidenceExpected:["真实上传场景"],protectedConstraint:false,artifactIds:[],category:"outcome" },
    { id:"USER-UIUX",title:"UI/UX",requirement:"界面清晰符合操作习惯",source:"user-command",weight:30,hardGate:true,judgeType:"llm",validationMethod:"visual-review",minScore:88,evidenceExpected:["视觉层级"],protectedConstraint:false,artifactIds:[],category:"outcome" },
  ],
} as unknown as EvolveProject;

function tc(id:string, criterionIds:string[], input:string, expected:string[]):TestCase { return { id,title:id,input,expected,tags:[],hidden:false,criterionIds,executionMode:"artifact-runtime",evidenceScope:"product-behavior" }; }

describe("V2.6 evidence-aware eval normalization",()=>{
  it("requires real runner for input compatibility and strips internal implementation objectives",()=>{
    const result=normalizeEvalSuiteForProject(project,[tc("compat",["USER-INPUT-COMPAT"],"上传融资 ZIP 并验证 semantic-evolution.ts 的 typeId",["workflow-engine.ts 六步状态机","Tailwind token 完整"])],[]);
    expect(result.validationCases[0]?.executionMode).toBe("external-runner");
    expect(`${result.validationCases[0]?.input} ${result.validationCases[0]?.expected.join(" ")}`).not.toMatch(/semantic-evolution|workflow-engine|tailwind|typeid/i);
    expect(result.validationCases[0]?.expected.join(" ")).toMatch(/真实上传场景|真实用户可上传/i);
  });
  it("keeps runtime evidence on the real Runner after the Runner connects",()=>{
    const criterion=project.acceptanceRubric[0]!;
    const hidden={...tc("compat-hidden",[criterion.id],"真实上传融资 ZIP，完成导入并保存",["上传成功并进入正确流程"]),hidden:true};
    const connected={...project,targetConnection:{adapter:"http",connectionId:"runner-gateway",status:"connected",label:"Server Target Proxy"},hiddenEvalSuite:[hidden]} as EvolveProject;
    const normalized=normalizeEvalSuiteForProject(connected,[],[hidden]);
    expect(normalized.hiddenCases[0]?.executionMode).toBe("external-runner");
    expect(evidenceRouteForCriterion(connected,criterion)).toBe("runner");
  });
  it("routes documentation-style codebase scenarios to local evidence instead of a fake E2E requirement",()=>{
    const criterion={...project.acceptanceRubric[0]!,id:"CONFIG-CLARITY",title:"配置流程可理解性",requirement:"配置流程必须直观易理解，使用清晰的步骤编号、示例和注意事项",evidenceExpected:["步骤编号","配置示例","注意事项"]} as EvolveProject["acceptanceRubric"][number];
    const hidden={...tc("config-clarity",[criterion.id],"检查配置说明是否完整清楚",criterion.evidenceExpected),hidden:true};
    const connected={...project,targetConnection:{adapter:"http",connectionId:"runner-gateway",status:"connected",label:"Server Target Proxy"},acceptanceRubric:[criterion],hiddenEvalSuite:[hidden]} as EvolveProject;
    const normalized=normalizeEvalSuiteForProject(connected,[],[hidden]);
    expect(normalized.hiddenCases[0]?.executionMode).toBe("static-evidence");
    expect(evidenceRouteForCriterion(connected,criterion)).toBe("local");
  });
  it("splits mixed visual, format and semantic criteria so visual evidence does not block unrelated requirements",()=>{
    const mixedProject={...project,acceptanceRubric:[
      {...project.acceptanceRubric[1]!,id:"VISUAL",validationMethod:"visual-review",title:"视觉层级",requirement:"页面视觉层级清晰",evidenceExpected:["截图"]},
      {...project.acceptanceRubric[1]!,id:"FORMAT",validationMethod:"format-roundtrip",title:"格式完整",requirement:"原格式可正常打开",evidenceExpected:["roundtrip"]},
      {...project.acceptanceRubric[1]!,id:"CONTENT",validationMethod:"semantic-judge",title:"内容完整",requirement:"关键内容完整保留",evidenceExpected:["正文"]},
    ]} as unknown as EvolveProject;
    const mixed=tc("mixed",["VISUAL","FORMAT","CONTENT"],"同时检查 UI 视觉、原格式和正文完整性",["视觉清晰","格式可打开","内容完整"]);
    const result=normalizeEvalSuiteForProject(mixedProject,[],[mixed]);
    expect(result.hiddenCases).toHaveLength(3);
    const byCriterion=new Map(result.hiddenCases.map((item)=>[item.criterionIds[0],item]));
    expect(byCriterion.get("VISUAL")?.executionMode).toBe("visual-review");
    expect(byCriterion.get("FORMAT")?.executionMode).toBe("roundtrip");
    expect(byCriterion.get("CONTENT")?.executionMode).toBe("artifact-runtime");
    expect(result.hiddenCases.every((item)=>item.criterionIds.length===1)).toBe(true);
  });
  it("routes UIUX criteria to visual review instead of static source pretending to prove UX",()=>{
    const result=normalizeEvalSuiteForProject(project,[tc("ux",["USER-UIUX"],"验证 UIUX 是否清晰",["视觉层级清晰"])],[]);
    expect(result.validationCases[0]?.executionMode).toBe("visual-review");
  });
  it("treats a TXT document user-scenario as local snapshot evidence, but keeps codebase scenarios on Runner",()=>{
    const criterion={...project.acceptanceRubric[0]!,id:"DOC-USE",title:"文档可执行性",requirement:"说明必须让用户按步骤完成任务",validationMethod:"user-scenario",artifactIds:["doc"]} as EvolveProject["acceptanceRubric"][number];
    const docProject={...project,objectType:"document",semanticEvolution:undefined,sourceArtifacts:[{id:"doc",role:"target",artifactKind:"document",extension:"txt",textContent:"第一步...第二步..."}],acceptanceRubric:[criterion]} as unknown as EvolveProject;
    expect(criterionCanUseLocalSnapshotEvidence(docProject,criterion)).toBe(true);
    expect(criterionCanUseLocalSnapshotEvidence(project,project.acceptanceRubric[0]!)).toBe(false);
    const result=normalizeEvalSuiteForProject(docProject,[],[tc("doc-use",[criterion.id],"检查用户能否按文字步骤完成",["步骤完整"])]);
    expect(result.hiddenCases[0]?.executionMode).toBe("artifact-runtime");
  });
  it("routes a readable DOCX SOP requirement to local Candidate review",()=>{
    const criterion={...project.acceptanceRubric[0]!,id:"DOC-CONFIG",title:"配置流程可理解性",requirement:"使用步骤编号、示例和注意事项",validationMethod:"user-scenario",artifactIds:["sop"]} as EvolveProject["acceptanceRubric"][number];
    const docProject={...project,objectType:"document",semanticEvolution:undefined,sourceArtifacts:[{
      id:"sop",role:"target",artifactKind:"document",name:"sop.docx",extension:"docx",textContent:"旧版配置流程",
      artifactDescriptor:{adapterId:"document-docx-ooxml"},structuredContent:{parts:[{path:"word/document.xml",textRuns:[{index:0,text:"旧版配置流程"}]}]},
    }],acceptanceRubric:[criterion]} as unknown as EvolveProject;
    const hidden=tc("doc-config",[criterion.id],"检查文档中的配置步骤",["步骤编号","示例","注意事项"]);
    expect(criterionCanUseLocalSnapshotEvidence(docProject,criterion)).toBe(true);
    expect(criterionCanUseLocalSnapshotEvidence({...docProject,sourceArtifacts:docProject.sourceArtifacts.map((artifact)=>({...artifact,artifactDescriptor:undefined}))},criterion)).toBe(true);
    expect(evidenceRouteForCriterion({...docProject,hiddenEvalSuite:[hidden]},criterion)).toBe("local");
    const unparsedDoc={...docProject,sourceArtifacts:docProject.sourceArtifacts.map((artifact)=>({...artifact,structuredContent:undefined}))};
    expect(evidenceRouteForCriterion({...unparsedDoc,hiddenEvalSuite:[hidden]},criterion)).toBe("capability");
    expect(normalizeEvalSuiteForProject(docProject,[],[hidden]).hiddenCases[0]?.executionMode).toBe("artifact-runtime");
  });
  it("routes an uploaded HTML readability requirement to local Candidate review",()=>{
    const criterion={...project.acceptanceRubric[0]!,id:"HTML-READ",title:"理解难度降低",requirement:"概念解释更直白，示例贴近实际",validationMethod:"user-scenario",artifactIds:["tutorial"]} as EvolveProject["acceptanceRubric"][number];
    const htmlProject={...project,objectType:"document",semanticEvolution:undefined,sourceArtifacts:[{
      id:"tutorial",role:"target",artifactKind:"document",name:"tutorial.html",extension:"html",mimeType:"text/html",
      textContent:"<!doctype html><html><body><h1>旧教程</h1></body></html>",
    }],acceptanceRubric:[criterion]} as unknown as EvolveProject;
    const hidden=tc("html-read",[criterion.id],"检查教程概念和示例",["解释直白","示例贴近实际"]);
    expect(criterionCanUseLocalSnapshotEvidence(htmlProject,criterion)).toBe(true);
    expect(evidenceRouteForCriterion({...htmlProject,hiddenEvalSuite:[hidden]},criterion)).toBe("local");
  });
  it("removes neighbouring tool expectations from a single-criterion case",()=>{
    const toolProject={...project,objectType:"document",sourceArtifacts:[],semanticEvolution:undefined,acceptanceRubric:[
      {...project.acceptanceRubric[0]!,id:"GIT",title:"Git 配置零起点可达",requirement:"Git 从账号注册到首次 push 可执行",evidenceExpected:["Git 注册、安装、SSH、push 步骤完整"]},
      {...project.acceptanceRubric[0]!,id:"SUPABASE",title:"Supabase 配置零起点可达",requirement:"Supabase 从注册到前端集成可执行",evidenceExpected:["Supabase 配置步骤完整"]},
      {...project.acceptanceRubric[0]!,id:"VERCEL",title:"Vercel 配置零起点可达",requirement:"Vercel 从注册到部署可执行",evidenceExpected:["Vercel 部署步骤完整"]},
    ]} as unknown as EvolveProject;
    const result=normalizeEvalSuiteForProject(toolProject,[],[tc("git",["GIT"],"检查 Git、Supabase、Vercel",["Git 步骤完整","Supabase 步骤完整","Vercel 步骤完整"])]);
    expect(result.hiddenCases[0]?.expected.join(" ")).toContain("Git");
    expect(result.hiddenCases[0]?.expected.join(" ")).not.toMatch(/Supabase|Vercel/i);
    expect(result.hiddenCases[0]?.tags).toContain("criterion-scope-repaired");
  });
});
