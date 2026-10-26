import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {CandidateSchema,PlanningDocumentContextSchema,TestCaseSchema,type EvolveProject,type PlanningDocumentContext} from "@evolution/contracts";
import {htmlPlanningDocument} from "@evolution/core";
import {experimentRecoveryFixture} from "@evolution/testkit";
import {serverCampaignArtifacts} from "./server-campaign-context";
import {advanceServerCampaignPreparation} from "./server-campaign-preparation";

const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const html='<html><head><style>PRIVATE_STYLE</style></head><body>'+Array.from({length:111},(_,i)=>`<article id="slide-${i+1}"><h3>章节${i+1}</h3><p>配置${i+1}：${"具体默认值、依赖关系与逐项验证。".repeat(6)}</p></article>`).join("")+'<script>PRIVATE_PROGRAM</script></body></html>';
function doc(p:EvolveProject,text=html,version=p.version):PlanningDocumentContext{
  const body=htmlPlanningDocument(text)!;
  return PlanningDocumentContextSchema.parse({schemaVersion:"planning-document-context-v1",sourceArtifactId:p.sourceArtifacts[0]!.id,currentVersion:version,
    parentSha256:sha(text),inputChars:text.length,text:body.text,textChars:body.text.length,complete:true,outline:body.outline,
    excludes:["scripts","styles","templates","noscript","svg","executable-attributes","runtime-verdicts"]});
}
function fixture(){
  const p=experimentRecoveryFixture().project;
  p.sourceArtifacts[0]!.textContent=html;p.sourceArtifacts[0]!.structure=["PRIVATE_RAW_STRUCTURE"];
  p.gates.push({id:"target-ready",status:"approved"});p.candidates=[];p.selectedCandidateIds=[];
  p.diagnosis={problemId:"P",rootCause:"local hypothesis only",summary:"local scope",affectedComponent:"source",confidence:.9,evidence:["configuration"],
    evidenceRefs:[{id:"ref",claim:"located claim",kind:"source",verified:true,artifactId:"source",excerpt:"PRIVATE_SOURCE_FRAGMENT"}],counterEvidence:[],falsifier:"no improvement",suggestedScopes:["prompt"],trace:[]};
  p.campaign.checkpoint={round:1,completedPhase:"diagnose",at:p.updatedAt};
  return p;
}
const never=async()=>{throw Error("completed phase");};
describe("complete current planning source context",()=>{
  it("includes every late chapter with a physical parent hash while excluding programs and raw source snippets",async()=>{
    const p=fixture(),before=structuredClone(p),loadPlanningDocuments=async()=>[doc(p)];let called=false;
    await advanceServerCampaignPreparation(p,{loadPlanningDocuments,problemAnalysis:never,diagnose:never,plan:async payload=>{
      called=true;const wire=JSON.stringify(payload),data=payload as {project:{sourceArtifacts:Array<{content:string;structure:string[];truncated:boolean;planningDocument:{parentSha256:string;complete:boolean}}>}};
      expect(data.project.sourceArtifacts[0]).toMatchObject({truncated:false,planningDocument:{parentSha256:sha(html),complete:true}});
      expect(data.project.sourceArtifacts[0]!.content).toContain("配置111");expect(data.project.sourceArtifacts[0]!.structure).toHaveLength(111);
      expect(wire).not.toMatch(/PRIVATE_STYLE|PRIVATE_PROGRAM|PRIVATE_SOURCE_FRAGMENT|PRIVATE_RAW_STRUCTURE/);
      return {candidates:[],recommendedCandidateIds:[],summary:"checked",experimentDesign:[]};
    }});
    expect(called).toBe(true);expect(p).toEqual(before);
  });
  it("keeps bounded HTML fallback body-only and exposes its full outline without claiming a physical binding",async()=>{
    const p=fixture(),context=await serverCampaignArtifacts(p);
    expect(context[0]!.content.length).toBeLessThanOrEqual(10_000);expect(context[0]!.structure).toHaveLength(111);
    expect(context[0]!.truncated).toBe(true);expect(JSON.stringify(context)).not.toMatch(/PRIVATE_STYLE|PRIVATE_PROGRAM|PRIVATE_RAW_STRUCTURE/);
  });
  it.each(["source","version","duplicate","text-size"])("rejects %s-mismatched document boundaries before AI",async kind=>{
    const p=fixture(),row=doc(p),plan=vi.fn();
    if(kind==="source")row.sourceArtifactId="foreign";
    if(kind==="version")row.currentVersion="foreign";
    if(kind==="text-size")row.textChars++;
    const out=await advanceServerCampaignPreparation(p,{problemAnalysis:never,diagnose:never,plan,loadPlanningDocuments:async()=>kind==="duplicate"?[row,row]:[row]});
    expect(out.control).toBe("stop");expect(out.reason).toContain("planning-context-pending");expect(plan).not.toHaveBeenCalled();
  });
  it("does not replace an unreadable full parent with an easier truncated index",async()=>{
    const p=fixture(),plan=vi.fn();
    const out=await advanceServerCampaignPreparation(p,{problemAnalysis:never,diagnose:never,plan,loadPlanningDocuments:async()=>{throw Error("physical readback failed");}});
    expect(out.reason).toContain("physical readback failed");expect(plan).not.toHaveBeenCalled();
  });
  it("applies the total metadata budget even without the optional complete-document reader",async()=>{
    const p=fixture();p.sourceArtifacts[0]!.textContent='<html><body>'+Array.from({length:1024},(_,i)=>`<article id="long-${i}"><h3>${"标题".repeat(110)}</h3></article>`).join("")+'</body></html>';
    await expect(serverCampaignArtifacts(p)).rejects.toThrow("exceeds capacity");
  });
  it("does not call the model after context I/O crosses the time window",async()=>{
    const p=fixture(),plan=vi.fn(),at=Date.now(),clock=vi.spyOn(Date,"now");p.campaign.startedAt=new Date(at).toISOString();p.campaign.stopCriteria.maxWallMinutes=30;
    try{
      const out=await advanceServerCampaignPreparation(p,{problemAnalysis:never,diagnose:never,plan,loadPlanningDocuments:async()=>{clock.mockReturnValue(at+31*60000);return [doc(p)];}});
      expect(out.reason).toContain("最长运行时间");expect(plan).not.toHaveBeenCalled();
    }finally{clock.mockRestore();}
  });
  it("reserves the final from Original only and never adds its questions to full current-document planning",async()=>{
    const p=fixture(),original='<html><body><article id="root"><h3>ROOT BODY</h3></article></body></html>',current='<html><body><article id="s1"><h3>CHAMPION BODY</h3></article></body></html>';
    p.sourceArtifacts[0]!.textContent=original;
    p.searchChampion={id:"champion",versionLabel:"S1"} as EvolveProject["searchChampion"];
    const loadPlanningDocuments=async(project:EvolveProject)=>[doc(project,project.searchChampion?current:original,project.searchChampion?.versionLabel??project.version)];
    const reserveFinalHoldout=vi.fn(async(payload:unknown)=>{
      expect(JSON.stringify(payload)).toContain("ROOT BODY");expect(JSON.stringify(payload)).not.toContain("CHAMPION BODY");
      return [TestCaseSchema.parse({id:"F1",title:"final",input:"FINAL-UNSEEN-QUESTION",expected:["unseen outcome"],hidden:true,criterionIds:["CONTENT"]})];
    });
    const plan=vi.fn(async(payload:unknown)=>{
      expect(JSON.stringify(payload)).toContain("CHAMPION BODY");expect(JSON.stringify(payload)).not.toContain("FINAL-UNSEEN-QUESTION");
      return {candidates:[CandidateSchema.parse({id:"new",name:"new",change:"improve",designRationale:{sourceEvidence:["configuration"],mechanism:"improve actual configuration"}})],recommendedCandidateIds:["new"],summary:"planned",experimentDesign:[]};
    });
    const ports={loadPlanningDocuments,reserveFinalHoldout,problemAnalysis:never,diagnose:never,plan};
    const reserved=await advanceServerCampaignPreparation(p,ports);expect(reserved.reason).toContain("预留并持久化");expect(plan).not.toHaveBeenCalled();
    const planned=await advanceServerCampaignPreparation(reserved.project,ports);
    expect(plan).toHaveBeenCalledOnce();expect(reserveFinalHoldout).toHaveBeenCalledOnce();
    expect(planned.project.candidates[0]?.finalHoldoutPaperHash).toBe(reserved.project.finalHoldout!.paperHash);
  });
  it("retains the real Champion, diagnosis and Baseline when the Original-only final-reservation read fails",async()=>{
    const p=fixture();p.searchChampion={id:"keep-champion",versionLabel:"S1"} as EvolveProject["searchChampion"];
    const before=structuredClone(p),reserveFinalHoldout=vi.fn(),plan=vi.fn();
    const out=await advanceServerCampaignPreparation(p,{problemAnalysis:never,diagnose:never,plan,reserveFinalHoldout,
      loadPlanningDocuments:async original=>{expect(original.searchChampion).toBeUndefined();expect(original.baselineRun.result).toBeUndefined();throw Error("Original unavailable");}});
    expect(out.reason).toContain("Original unavailable");expect(reserveFinalHoldout).not.toHaveBeenCalled();expect(plan).not.toHaveBeenCalled();
    expect(out.project.searchChampion).toEqual(before.searchChampion);expect(out.project.baselineRun).toEqual(before.baselineRun);
    expect(out.project.diagnosis).toEqual(before.diagnosis);expect(out.project.problems).toEqual(before.problems);expect(p).toEqual(before);
  });
});
