import JSZip from "jszip";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {ArtifactWriteGovernanceSchema,CandidateSchema,SourceArtifactSchema,type ArtifactMetadata,type Candidate,type EvolveProject} from "@evolution/contracts";
import {materializeServerCandidateArtifacts,serverArtifactSha256,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
import {TestCaseSchema,EvolveProjectSchema,type EvaluateAiResult} from "@evolution/contracts";
import {finalHoldoutContractFingerprint,finalHoldoutPaperHash} from "@evolution/core";
import {runServerExperiment,runServerVisibleRepair} from "@evolution/harness";
import {experimentRecoveryFixture} from "@evolution/testkit";
const {blobs,metadata,put}=vi.hoisted(()=>({blobs:new Map<string,Blob>(),metadata:new Map<string,unknown>(),put:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id),getMetadata:async(id:string)=>metadata.get(id),put})}));
beforeEach(()=>{
  blobs.clear();metadata.clear();put.mockReset().mockImplementation(async(id:string,blob:Blob,binding?:{missionId?:string;kind?:string})=>{
    blobs.set(id,blob);const at=new Date().toISOString();metadata.set(id,{id,schemaVersion:"artifact-v1",missionId:binding?.missionId,kind:binding?.kind,
      bucket:"test",objectPath:id,mimeType:blob.type,sizeBytes:blob.size,sha256:await serverArtifactSha256(await blob.arrayBuffer()),createdAt:at,updatedAt:at});
  });
});
const overlay=(generation:number)=>JSON.stringify({kind:"codebase",overlay:true,files:[{path:"rules.json",content:JSON.stringify({generation,priorCapabilities:["account","billing"],newCapabilities:Array.from({length:generation},(_,i)=>"capability-"+(i+1))})}]});
async function fixture(zip=false,textFormat?:{name:string;extension:string;mimeType:string;content:string;artifactKind?:string}){
  const archive=new JSZip();archive.file("rules.json",'{"generation":0}');archive.file("SKILL.md","Do not weaken this skill");archive.file("tests/cases.json",'["hidden fixture - not sent to model"]');archive.file("assets/icon.bin",new Uint8Array([0,255,12]));
  const base=zip?new Blob([await archive.generateAsync({type:"arraybuffer"})],{type:"application/zip"}):new Blob([textFormat?.content??"seed"],{type:textFormat?.mimeType??"text/plain"});
  blobs.set("source",base);const name=zip?"agent.zip":textFormat?.name??"notes.txt";
  const extension=zip?"zip":textFormat?.extension??"txt";
  const approval=ArtifactWriteGovernanceSchema.parse({version:"artifact-write-governance-v1",parentSha256:await serverArtifactSha256(await base.arrayBuffer()),
    policy:{allowedPaths:[zip?"rules.json":name],protectedPaths:zip?["SKILL.md","tests","assets"]:[]}});
  const source=SourceArtifactSchema.parse({id:"source",name,role:"target",extension,artifactKind:zip?"codebase":textFormat?.artifactKind??"generic",mimeType:base.type,size:base.size,
    inputMode:"upload",storageRef:"source",mutationGovernance:approval,createdAt:new Date().toISOString()});  const project={id:"multigeneration",name:"Evolution",version:"V1",sourceArtifacts:[source],candidates:[],protectedItems:[],editableItems:[]} as unknown as EvolveProject;
  const evolve=async(id:string,content:string,parent?:Candidate)=>{
    const child=await materializeServerCandidateArtifacts(project,CandidateSchema.parse({id,name:id,change:"Test-controlled proposal, not a live model"}),
      [{sourceArtifactId:source.id,name:source.name,mimeType:source.mimeType,content}],"test-controlled multi-generation",parent);
    project.candidates.push(child);return child;
  };
  return {project,source,approval,evolve};
}
// Scripted proposals/judgments, but the real repair state machine, real byte materializer and real hash checks.
async function repairLoopFixture(maxRepairAttempts=3){
  const x=experimentRecoveryFixture(),p=x.project,source=p.sourceArtifacts[0];
  const sourceBlob=new Blob([source.textContent!],{type:source.mimeType});blobs.set(source.id,sourceBlob);
  source.mutationGovernance=ArtifactWriteGovernanceSchema.parse({version:"artifact-write-governance-v1",parentSha256:await serverArtifactSha256(await sourceBlob.arrayBuffer()),policy:{allowedPaths:[source.name]}});
  p.evalSuite[0].executionMode="artifact-runtime";
  p.acceptanceRubric[0]={...p.acceptanceRubric[0],hardGate:false,validationMethod:"semantic-judge"};
  p.hiddenEvalSuite=[TestCaseSchema.parse({...p.evalSuite[0],id:"H1",hidden:true,input:"hidden scenario"})];
  p.experimentPolicy.visibleFailureRepair="experiment-visible-repair-v1";
  p.artifactAcceptance={...p.artifactAcceptance,attempts:0,maxRepairAttempts,hardGatePass:false};
  p.campaign.stopCriteria={...p.campaign.stopCriteria,maxRounds:1,patienceRounds:1,maxEstimatedCost:100,maxWallMinutes:30,stopOnSafetyFailure:true};
  p.campaign.startedAt=new Date().toISOString();
  const suite=[TestCaseSchema.parse({...p.evalSuite[0],id:"FINAL",hidden:true,input:"PRIVATE-FINAL-DO-NOT-LEAK",expected:["independent expectation"]})];
  p.finalHoldout={round:1,suite,paperHash:finalHoldoutPaperHash(suite),contractFingerprint:finalHoldoutContractFingerprint(p),createdAt:new Date(Date.now()-1000).toISOString()};
  const html=(stage:number)=>"<html><body><p>retained baseline capability; stage "+stage+"</p></body></html>";
  const initial=await materializeServerCandidateArtifacts(p,{...x.current,finalHoldoutPaperHash:p.finalHoldout.paperHash,artifactSnapshots:[]},
    [{sourceArtifactId:source.id,name:source.name,mimeType:source.mimeType,content:html(0)}],"scripted seed");
  let score=50,cycle=false;
  const fingerprint=async(text:string)=>serverArtifactSha256(new TextEncoder().encode(text));
  const archives:string[]=[];
  const ports={fingerprint,verifyFrozenArtifact:verifyServerCandidateFrozenArtifact,
    buildCandidate:vi.fn(async()=>initial),executeSemanticBatch:async()=>({results:[]}),
    judge:vi.fn(async():Promise<EvaluateAiResult>=>({accuracy:score,evidence:score,riskCoverage:90,completeness:score,safety:"PASS",notes:[],failures:score<80?["scripted observed failure"]:[],
      cases:[{testCaseId:"V1",accuracy:score,evidence:score,completeness:score,reason:"scripted measurement"}],
      criteria:[{criterionId:"CONTENT",score,pass:score>=80,evidence:["test-controlled measurement"],gaps:score<80?["needs improvement"]:[],testCaseIds:["V1"]}]})),
    archiveRepairEvidence:vi.fn(async(input:{content:string;sha256:string;size:number;missionId:string;candidateId:string})=>{
      archives.push(input.content);return {version:"repair-evidence-reference-v1" as const,artifactId:"evidence-"+input.sha256,missionId:input.missionId,candidateId:input.candidateId,sha256:input.sha256,size:input.size,mimeType:"application/json" as const};
    }),
    persistProject:vi.fn(async(project:EvolveProject)=>{void project;}),
    repairCandidate:vi.fn(async(args:{project:EvolveProject;candidate:Candidate;attempt:number})=>{      const child={...args.candidate,id:"repair-"+args.attempt,artifactSnapshots:[]};
      return materializeServerCandidateArtifacts(args.project,child,[{sourceArtifactId:source.id,name:source.name,mimeType:source.mimeType,content:html(cycle?0:args.attempt)}],"scripted repair",args.candidate);
    }),
  };
  return {p,ports,initial,archives,setScore:(n:number)=>{score=n;},setCycle:()=>{cycle=true;}};
}

describe("existing repair loop with real governed artifact bytes",()=>{
  it("performs two automatic repairs over three measured generations, retaining the original blind final",async()=>{
    const x=await repairLoopFixture(),paper=structuredClone(x.p.finalHoldout),approval=structuredClone(x.p.sourceArtifacts[0].mutationGovernance);
    let measured=await runServerExperiment(x.p,x.ports);
    expect(measured.readyForVisibleRepair,measured.reason).toBe(true);
    for(const [attempt,score] of [[1,40],[2,95]]){      const repaired=await runServerVisibleRepair(measured.project,x.ports);
      expect(repaired.repaired,repaired.reason).toBe(true);expect(repaired.project.artifactAcceptance.attempts).toBe(attempt);
      x.setScore(score);measured=await runServerExperiment(EvolveProjectSchema.parse(repaired.project),x.ports);
      expect(measured.project.finalHoldout).toEqual(paper);expect(measured.project.sourceArtifacts[0].mutationGovernance).toEqual(approval);
      expect(measured.project.outputArtifacts).toHaveLength(0);
      if(attempt===1)expect(measured.readyForVisibleRepair,measured.reason).toBe(true);
    }
    expect(measured.readyForHoldout,measured.reason).toBe(true);expect(x.ports.repairCandidate).toHaveBeenCalledTimes(2);
    expect(x.ports.buildCandidate).toHaveBeenCalledOnce();expect(x.ports.persistProject).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(x.archives)).not.toContain("PRIVATE-FINAL-DO-NOT-LEAK");
    const claimed=x.ports.persistProject.mock.calls[0][0];x.ports.repairCandidate.mockClear();
    const replay=await runServerVisibleRepair(claimed,x.ports);
    expect(replay.repaired).toBe(false);expect(x.ports.repairCandidate).not.toHaveBeenCalled();
  });
  it("stops A-to-B-to-A exact-byte cycles and keeps the shared attempt already spent",async()=>{
    const x=await repairLoopFixture();let measured=await runServerExperiment(x.p,x.ports);
    const first=await runServerVisibleRepair(measured.project,x.ports);expect(first.repaired,first.reason).toBe(true);
    x.setScore(40);measured=await runServerExperiment(first.project,x.ports);expect(measured.readyForVisibleRepair,measured.reason).toBe(true);    x.setCycle();const stopped=await runServerVisibleRepair(measured.project,x.ports);
    expect(stopped.repaired).toBe(false);expect(stopped.reason).toContain("REPEATED_FROZEN_OUTPUT");
    expect(stopped.project.artifactAcceptance.attempts).toBe(2);expect(stopped.project.campaign.status).toBe("paused");
    expect(stopped.project.candidates.some(c=>c.id==="repair-2")).toBe(false);expect(stopped.project.outputArtifacts).toHaveLength(0);
  });
  it("stops when the original shared repair budget is spent",async()=>{
    const x=await repairLoopFixture(1),first=await runServerExperiment(x.p,x.ports);
    const repaired=await runServerVisibleRepair(first.project,x.ports);expect(repaired.repaired,repaired.reason).toBe(true);
    x.setScore(40);const measured=await runServerExperiment(repaired.project,x.ports);
    expect(measured.readyForVisibleRepair).not.toBe(true);expect(x.ports.repairCandidate).toHaveBeenCalledOnce();    expect(measured.project.artifactAcceptance.attempts).toBe(1);expect(measured.project.outputArtifacts).toHaveLength(0);
  });
});

describe("multi-generation materialization under one approval",()=>{
  it("materializes three ZIP generations from frozen predecessors without weakening permissions",async()=>{
    const x=await fixture(true),before=JSON.stringify(x.source.mutationGovernance);let parent:Candidate|undefined;
    for(let i=1;i<=3;i++){
      const previous=parent?.artifactSnapshots[0].frozenArtifact?.sha256??x.approval.parentSha256;
      parent=await x.evolve("generation-"+i,overlay(i),parent);
      const snapshot=parent.artifactSnapshots[0],frozen=snapshot.frozenArtifact!;
      expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
      const zip=await JSZip.loadAsync(await blobs.get(frozen.blobId)!.arrayBuffer());
      expect(JSON.parse(await zip.file("rules.json")!.async("string")).generation).toBe(i);
      expect(await zip.file("SKILL.md")!.async("string")).toBe("Do not weaken this skill");
      expect(await zip.file("assets/icon.bin")!.async("uint8array")).toEqual(new Uint8Array([0,255,12]));
      expect(await zip.file("tests/cases.json")!.async("string")).toBe('["hidden fixture - not sent to model"]');
      const receipts=await Promise.all([...blobs.entries()].filter(([id])=>id.startsWith("artifact-write-lineage-")).map(async([,blob])=>JSON.parse(await blob.text())));
      expect(receipts.find(r=>r.candidateId===parent!.id)).toMatchObject({inputSha256:previous,outputSha256:frozen.sha256});
    }
    expect(x.project.candidates).toHaveLength(3);expect(JSON.stringify(x.source.mutationGovernance)).toBe(before);
    expect([...metadata.values()].filter(m=>(m as ArtifactMetadata).kind==="candidate-write-lineage")).toHaveLength(3);
  });
  it.each([
    {name:"guide.html",extension:"html",mimeType:"text/html",artifactKind:"document",seed:"<html><body><p>generation 0</p></body></html>",first:"<html><body><p>generation 1</p></body></html>",second:"<html><body><p>generation 2</p></body></html>"},
    {name:"guide.md",extension:"md",mimeType:"text/markdown",artifactKind:"document",seed:"# Generation 0\n",first:"# Generation 1\n",second:"# Generation 2\n"},
    {name:"rules.json",extension:"json",mimeType:"application/json",artifactKind:"generic",seed:'{"generation":0}',first:'{"generation":1}',second:'{"generation":2}'},
  ])("evolves $extension text artifacts for three generations under one immutable approval",async format=>{
    const x=await fixture(false,{...format,content:format.seed}),approval=JSON.stringify(x.source.mutationGovernance);    const first=await x.evolve("first",format.first);
    const persisted=CandidateSchema.parse(JSON.parse(JSON.stringify(first)));
    const second=await x.evolve("second",format.second,persisted);
    expect(await blobs.get(second.artifactSnapshots[0]!.frozenArtifact!.blobId)!.text()).toBe(format.second);
    expect(await verifyServerCandidateFrozenArtifact(second.artifactSnapshots[0]!)).toBe(true);
    expect(JSON.stringify(x.source.mutationGovernance)).toBe(approval);
    expect([...metadata.values()].filter(m=>(m as ArtifactMetadata).kind==="candidate-write-lineage")).toHaveLength(2);
  });
  it("resumes text evolution from serialized candidate state and stored evidence",async()=>{
    const x=await fixture(),first=await x.evolve("first","first improvement");
    const persisted=CandidateSchema.parse(JSON.parse(JSON.stringify(first)));
    const second=await x.evolve("second","second improvement",persisted);
    expect(await blobs.get(second.artifactSnapshots[0].frozenArtifact!.blobId)!.text()).toBe("second improvement");
    expect(x.source.mutationGovernance?.parentSha256).toBe(x.approval.parentSha256);
  });
  it("archives a retained target under the new candidate identity before a later generation changes it",async()=>{
    const x=await fixture(true);const textBase=new Blob(["seed"],{type:"text/plain"});blobs.set("text",textBase);
    const text=SourceArtifactSchema.parse({id:"text",name:"notes.txt",role:"target",extension:"txt",mimeType:"text/plain",size:4,storageRef:"text",createdAt:new Date().toISOString(),
      mutationGovernance:ArtifactWriteGovernanceSchema.parse({version:"artifact-write-governance-v1",parentSha256:await serverArtifactSha256(await textBase.arrayBuffer()),policy:{allowedPaths:["notes.txt"]}})});
    x.project.sourceArtifacts.push(text);
    const make=async(id:string,zc:string,tc:string,parent?:Candidate)=>materializeServerCandidateArtifacts(x.project,CandidateSchema.parse({id,name:id,change:"test"}),[
      {sourceArtifactId:"source",name:"agent.zip",mimeType:"application/zip",content:zc},{sourceArtifactId:"text",name:"notes.txt",mimeType:"text/plain",content:tc}],"test",parent);
    const first=await make("one",overlay(1),"text one");
    const second=await make("two",JSON.stringify({kind:"keep-parent",sourceArtifactId:"source"}),"text two",first);
    const third=await make("three",overlay(2),"text three",second);
    expect(await verifyServerCandidateFrozenArtifact(third.artifactSnapshots[0])).toBe(true);
  });
  it.each(["receipt-bytes","receipt-metadata","missing-receipt","forged-candidate","expanded-policy","wrong-mission"])("rejects %s before next-generation writes",async mode=>{
    const x=await fixture(),first=await x.evolve("first","first improvement");
    const id=[...metadata.keys()].find(id=>id.startsWith("artifact-write-lineage-"))!;
    if(mode==="receipt-bytes")blobs.set(id,new Blob(["tampered"]));
    if(mode==="receipt-metadata")metadata.set(id,{...(metadata.get(id) as ArtifactMetadata),kind:"source"});
    if(mode==="missing-receipt")metadata.delete(id);
    if(mode==="forged-candidate")first.id="forged";
    if(mode==="expanded-policy")x.source.mutationGovernance!.policy.allowedPaths.push("extra.txt");
    if(mode==="wrong-mission")x.project.id="other-mission";
    put.mockClear();await expect(x.evolve("next","new content",first)).rejects.toThrow("UNVERIFIED");expect(put).not.toHaveBeenCalled();
  });
  it("still rejects a protected ZIP file in the second generation",async()=>{
    const x=await fixture(true),first=await x.evolve("first",overlay(1));put.mockClear();
    await expect(x.evolve("second",JSON.stringify({files:[{path:"SKILL.md",content:"override"}]}),first)).rejects.toThrow("protected-path");expect(put).not.toHaveBeenCalled();
  });
  it("does not return a candidate if lineage storage fails after its output is frozen",async()=>{
    const x=await fixture();const normal=put.getMockImplementation()!;
    put.mockImplementation(async(id:string,blob:Blob,binding?:{missionId?:string;kind?:string})=>{
      if(binding?.kind==="candidate-write-lineage")throw new Error("receipt storage unavailable");return normal(id,blob,binding);
    });
    await expect(x.evolve("first","improvement")).rejects.toThrow("receipt storage unavailable");
    expect(x.project.candidates).toHaveLength(0); // orphan output is not accepted/promoted
  });
});
