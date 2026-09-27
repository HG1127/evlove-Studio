import { describe, expect, it } from "vitest";
import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { normalizeLocallyVerifiableCandidateRuns } from "./candidate-snapshot-evidence";

describe("candidate snapshot evidence",()=>{
  it("verifies a text roundtrip against the exact Candidate snapshot without an external runner",()=>{
    const project={
      evolutionCommand:"保持 Markdown 原格式",
      acceptanceRubric:[{
        id:"FORMAT",title:"原格式",requirement:"Markdown 可原格式交付",source:"system-integrity",weight:100,hardGate:true,
        judgeType:"integrity",validationMethod:"format-roundtrip",minScore:90,evidenceExpected:[],protectedConstraint:false,
        artifactIds:["source-1"],category:"artifact-specific",
      }],
      sourceArtifacts:[{id:"source-1",name:"source.md",extension:"md"}],
    } as unknown as EvolveProject;
    const candidate={artifactSnapshots:[{id:"snap-1",sourceArtifactId:"source-1",name:"source.md",content:"# evolved"}]} as Candidate;
    const testCase={
      id:"H-FORMAT",title:"格式往返",input:"检查 Markdown",expected:["逐字保持"],criterionIds:["FORMAT"],
      executionMode:"roundtrip",evidenceScope:"format",
    } as TestCase;
    const seed:TargetRunResult={testCaseId:testCase.id,output:"pending",latencyMs:0,cost:0,trace:[],verificationStatus:"unverified"};
    const [run]=normalizeLocallyVerifiableCandidateRuns(project,candidate,[testCase],[seed]);
    expect(run?.verificationStatus).toBe("verified");
    expect(run?.output).toContain("CANDIDATE TEXT FORMAT ROUNDTRIP VERIFIED");
    expect(run?.trace.some((step)=>step.stage==="format-roundtrip"&&step.status==="pass")).toBe(true);
  });

  it("binds static repository evidence to the exact codebase Candidate overlay",()=>{
    const project={
      evolutionCommand:"让配置流程步骤、示例和注意事项更清楚",
      acceptanceRubric:[{
        id:"CONFIG",title:"配置流程可理解性",requirement:"使用清晰的步骤编号、示例和注意事项",source:"user-command",weight:100,hardGate:true,
        judgeType:"structural",validationMethod:"static-structure",minScore:85,evidenceExpected:["步骤编号","示例","注意事项"],protectedConstraint:false,
        artifactIds:["repo-1"],category:"outcome",
      }],
      sourceArtifacts:[{id:"repo-1",name:"app.zip",extension:"zip",artifactKind:"codebase",role:"target"}],
    } as unknown as EvolveProject;
    const content=JSON.stringify({kind:"codebase",overlay:true,files:[{path:"src/settings.tsx",content:"1. 填写地址\n示例：https://example.test\n注意事项：保存后重新检测"}]});
    const candidate={artifactSnapshots:[{id:"snap-static",sourceArtifactId:"repo-1",name:"app.zip",content}]} as Candidate;
    const testCase={
      id:"H-CONFIG",title:"配置流程可理解性",input:"检查配置说明",expected:["步骤编号","示例","注意事项"],criterionIds:["CONFIG"],
      executionMode:"static-evidence",evidenceScope:"implementation",
    } as TestCase;
    const seed:TargetRunResult={testCaseId:testCase.id,output:"未检索到足够相关的源码/结构证据。",latencyMs:1,cost:0,trace:[],verificationStatus:"unverified"};
    const [run]=normalizeLocallyVerifiableCandidateRuns(project,candidate,[testCase],[seed]);
    expect(run?.verificationStatus).toBe("partial");
    expect(run?.output).toContain("CURRENT CANDIDATE STATIC SNAPSHOT EVIDENCE");
    expect(run?.output).toContain("overlay only");
    expect(run?.output).toContain("FILE: src/settings.tsx");
    expect(run?.output).toContain("注意事项：保存后重新检测");
    expect(run?.output).not.toContain("未检索到足够相关的源码/结构证据");
    expect(run?.trace.some((step)=>step.stage==="candidate-static-evidence"&&step.status==="warning")).toBe(true);
    const fullPackage={...candidate,artifactSnapshots:[{...candidate.artifactSnapshots[0]!,content:JSON.stringify({kind:"codebase",overlay:false,files:[
      {path:"src/settings.tsx",content:"1. 填写地址。示例：输入地址。注意事项：保存后检查。"},
    ]})}]} as Candidate;
    expect(normalizeLocallyVerifiableCandidateRuns(project,fullPackage,[testCase],[seed])[0]?.verificationStatus).toBe("verified");
    const duplicateFiles={...candidate,artifactSnapshots:[{...candidate.artifactSnapshots[0]!,content:JSON.stringify({kind:"codebase",files:[
      {path:"src/settings.tsx",content:"first"},{path:"src/settings.tsx",content:"second"},
    ]})}]} as Candidate;
    expect(normalizeLocallyVerifiableCandidateRuns(project,duplicateFiles,[testCase],[seed])[0]?.verificationStatus).toBe("unverified");
    const partialFile={...candidate,artifactSnapshots:[{...candidate.artifactSnapshots[0]!,content:JSON.stringify({kind:"codebase",files:[
      {path:"src/settings.tsx",content:"valid"},{path:"src/missing.tsx"},
    ]})}]} as Candidate;
    expect(normalizeLocallyVerifiableCandidateRuns(project,partialFile,[testCase],[seed])[0]?.verificationStatus).toBe("unverified");
    const longFile={...candidate,artifactSnapshots:[{...candidate.artifactSnapshots[0]!,content:JSON.stringify({kind:"codebase",files:[
      {path:"src/settings.tsx",content:"header\n".repeat(6000)},
    ]})}]} as Candidate;
    const [partial]=normalizeLocallyVerifiableCandidateRuns(project,longFile,[testCase],[seed]);
    expect(partial?.verificationStatus).toBe("partial");
    expect(partial?.output).toContain("retrieved context");
  });

  it("reviews the materialized DOCX text runs from the current Candidate",()=>{
    const project={
      evolutionCommand:"让 Vibe Coding SOP 配置步骤易懂",
      acceptanceRubric:[{
        id:"DOC-CONFIG",title:"配置流程可理解性",requirement:"步骤编号、示例和注意事项清晰",source:"user-command",weight:100,hardGate:true,
        judgeType:"llm",validationMethod:"user-scenario",minScore:85,evidenceExpected:["步骤编号","示例","注意事项"],protectedConstraint:false,
        artifactIds:["sop"],category:"outcome",
      }],
      sourceArtifacts:[{
        id:"sop",name:"sop.docx",extension:"docx",artifactKind:"document",role:"target",textContent:"旧版流程",
        artifactDescriptor:{adapterId:"document-docx-ooxml"},
        structuredContent:{parts:[
          {path:"word/document.xml",textRuns:[{index:0,text:"旧版配置流程。"},{index:1,text:"保留的审批规则。"}]},
          {path:"word/header1.xml",textRuns:[{index:0,text:"未修改的页眉。"}]},
        ]},
      }],
    } as unknown as EvolveProject;
    const candidate={artifactSnapshots:[{
      id:"sop-snapshot",sourceArtifactId:"sop",name:"sop.docx",
      content:JSON.stringify({kind:"document",subtype:"docx",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"1. 填写配置。示例：输入项目地址。注意事项：保存后检查连接。"}]}]}),
    }]} as Candidate;
    const testCase={id:"H-DOC-CONFIG",title:"配置流程可理解性",input:"检查 SOP 中的配置说明",expected:["步骤编号","示例","注意事项"],criterionIds:["DOC-CONFIG"],executionMode:"artifact-runtime",evidenceScope:"product-behavior"} as TestCase;
    const seed:TargetRunResult={testCaseId:testCase.id,output:"LOCAL SNAPSHOT EVIDENCE PENDING",latencyMs:0,cost:0,trace:[],verificationStatus:"unverified"};
    const [run]=normalizeLocallyVerifiableCandidateRuns(project,candidate,[testCase],[seed]);
    expect(run?.verificationStatus).toBe("verified");
    expect(run?.output).toContain("1. 填写配置");
    expect(run?.output).toContain("保留的审批规则");
    expect(run?.output).toContain("未修改的页眉");
    expect(run?.output).not.toContain("旧版配置流程");
    const legacyProject={...project,sourceArtifacts:project.sourceArtifacts.map((artifact)=>({...artifact,artifactDescriptor:undefined}))};
    expect(normalizeLocallyVerifiableCandidateRuns(legacyProject,candidate,[testCase],[seed])[0]?.verificationStatus).toBe("verified");

    const malformed={...candidate,artifactSnapshots:[{...candidate.artifactSnapshots[0]!,content:JSON.stringify({parts:[{path:"word/document.xml",textRuns:[{index:9,text:"无法物化"}]}]})}]} as Candidate;
    expect(normalizeLocallyVerifiableCandidateRuns(project,malformed,[testCase],[seed])[0]?.verificationStatus).toBe("unverified");
  });

  it("binds HTML readability evidence to the exact complete Candidate, not the uploaded source",()=>{
    const project={
      evolutionCommand:"降低 HTML 教程的理解难度",
      acceptanceRubric:[{
        id:"HTML-READ",title:"理解难度降低",requirement:"概念解释直白，示例贴近实际",source:"user-command",weight:100,hardGate:true,
        judgeType:"llm",validationMethod:"user-scenario",minScore:85,evidenceExpected:["直白解释","具体示例"],protectedConstraint:false,
        artifactIds:["tutorial"],category:"outcome",
      }],
      sourceArtifacts:[{id:"tutorial",name:"tutorial.html",extension:"html",artifactKind:"document",role:"target",textContent:"<html><body>旧版教程</body></html>"}],
    } as unknown as EvolveProject;
    const testCase={id:"H-HTML-READ",title:"理解难度降低",input:"检查概念解释和示例",expected:["直白解释","具体示例"],criterionIds:["HTML-READ"],executionMode:"artifact-runtime",evidenceScope:"product-behavior"} as TestCase;
    const seed:TargetRunResult={testCaseId:testCase.id,output:"UNVERIFIED",latencyMs:0,cost:0,trace:[],verificationStatus:"unverified"};
    const content=`<!doctype html><html><body>${"<p>背景资料</p>".repeat(3000)}<h2>概念解释</h2><p>用真实项目举例，让初学者看懂。</p></body></html>`;
    const candidate={artifactSnapshots:[{id:"html-snapshot",sourceArtifactId:"tutorial",name:"tutorial.html",content}]} as Candidate;
    const [run]=normalizeLocallyVerifiableCandidateRuns(project,candidate,[testCase],[seed]);
    expect(run?.verificationStatus).toBe("partial");
    expect(run?.output).toContain("真实项目举例");
    expect(run?.output).not.toContain("旧版教程");
    const shortCandidate={artifactSnapshots:[{...candidate.artifactSnapshots[0]!,content:"<html><body><h2>概念解释</h2><p>具体示例</p></body></html>"}]} as Candidate;
    expect(normalizeLocallyVerifiableCandidateRuns(project,shortCandidate,[testCase],[seed])[0]?.verificationStatus).toBe("verified");
    const malformed={artifactSnapshots:[{...candidate.artifactSnapshots[0]!,content:"<main>只有片段</main>"}]} as Candidate;
    expect(normalizeLocallyVerifiableCandidateRuns(project,malformed,[testCase],[seed])[0]?.verificationStatus).toBe("unverified");
  });
});
