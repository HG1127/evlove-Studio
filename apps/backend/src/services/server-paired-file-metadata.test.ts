// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {ExperimentPolicySchema,PairedJudgeRequestSchema,PairedJudgeReceiptSchema,type PairedEvaluationAiResult} from "@evolution/contracts";
import {candidateWinnerDecision,evidenceFingerprint,finalHoldoutContractFingerprint,campaignScoringInputFingerprint} from "@evolution/core";
import {serverPairedJudgeRequest,settleServerPairedJudgment} from "@evolution/harness";
import {pairedJudgeFixture,pairedJudgeRawEvaluation} from "@evolution/testkit";
import {runServerPairedEvidenceJudge} from "./server-paired-evidence-judge";

function fixture(){
  const x=pairedJudgeFixture();
  const request=()=>serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
  return {...x,request};
}
async function assess(x=fixture()){
  const request=x.request(),calls:unknown[]=[];
  const invoke=vi.fn(async(raw:unknown):Promise<PairedEvaluationAiResult>=>{
    calls.push(raw);const input=raw as {requestFingerprint:string},original=pairedJudgeRawEvaluation(90),candidate=pairedJudgeRawEvaluation(97);
    return {schemaVersion:"paired-evaluation-v1",requestFingerprint:input.requestFingerprint,versions:[
      {slot:"A",result:calls.length===1?original:candidate},{slot:"B",result:calls.length===1?candidate:original},{slot:"C",result:structuredClone(original)},
    ]};
  });
  const result=await runServerPairedEvidenceJudge(request,{invoke,routeFingerprint:async()=>"fixed-synthetic-route"});
  const evaluation=settleServerPairedJudgment(x.project,x.project.evalSuite,x.candidateRuns,x.originalRuns,request,result);
  return {...x,issued:request,calls,evaluation};
}

describe("paired file reference metadata",()=>{
  it("uses Original reference byte counts and frozen Candidate metadata, not mutable proposal labels or estimates",()=>{
    const x=fixture(),source=x.project.sourceArtifacts[0]!,snapshot=x.candidate.artifactSnapshots[0]!;
    source.size=1;snapshot.name="unfrozen-proposal.txt";snapshot.mimeType="text/plain";
    const request=x.request(),binding=request.context.bindings[0]!;
    expect(binding.fileMetadata).toMatchObject({schemaVersion:"paired-file-metadata-v1",
      original:{name:"original.md",mimeType:"text/markdown",sizeBytes:x.project.baselineRun.originalReferences![0]!.sizeBytes,provenance:"mission-source-declaration-with-original-byte-reference"},
      candidate:{name:"updated.md",mimeType:"text/markdown",sizeBytes:snapshot.frozenArtifact!.size,provenance:"frozen-artifact-reference"},
    });
    expect(request.versions.original.files![0]!.sha256).toBe(binding.originalSha256);
    expect(request.versions.candidate.files![0]!.sha256).toBe(binding.candidateSha256);
  });
  it("delivers metadata with the same swapped slots and exact duplicate Original control, in only two calls",async()=>{
    const x=await assess(),calls=x.calls as Array<{versions:Array<{slot:string;observations:{files:unknown}}>}>,original=x.issued.versions.original.files,candidate=x.issued.versions.candidate.files;
    expect(calls).toHaveLength(2);
    expect(calls[0]!.versions.map(v=>v.observations.files)).toEqual([original,candidate,original]);
    expect(calls[1]!.versions.map(v=>v.observations.files)).toEqual([candidate,original,original]);
    expect(x.evaluation.judgeComparison!.receipt.bindings[0]!.fileMetadata).toEqual(x.issued.context.bindings[0]!.fileMetadata);
    expect(candidateWinnerDecision(x.project,x.evaluation,x.project.baselineRun.result!,x.candidate).eligible).toBe(true);
  });
  it("keeps unknown fields null without inferring extensions or MIME from the body",()=>{
    const x=fixture();x.project.sourceArtifacts[0]!.name=" ";x.project.sourceArtifacts[0]!.mimeType="";
    x.candidate.artifactSnapshots[0]!.frozenArtifact!.name="";x.candidate.artifactSnapshots[0]!.frozenArtifact!.mimeType=" ";
    const request=x.request();for(const arm of ["original","candidate"] as const)expect(request.versions[arm].files![0]).toMatchObject({name:null,mimeType:null});
  });
  it("rejects unbound, duplicated, missing, foreign and altered metadata before model calls",async()=>{
    const request=fixture().request(),mutations:Array<(r:typeof request)=>void>=[
      r=>{r.versions.original.files![0]!.sha256="a".repeat(64);},r=>{r.versions.candidate.files![0]!.name="another.md";},
      r=>{r.versions.candidate.files![0]!.mimeType="application/pdf";},r=>{r.versions.candidate.files![0]!.sizeBytes++;},
      r=>{r.versions.original.files!.push(r.versions.original.files![0]!);},r=>{delete r.versions.original.files;},
      r=>{r.versions.candidate.files![0]!.sourceArtifactId="foreign";},r=>{delete r.context.bindings[0]!.fileMetadata;},
      r=>{delete r.context.fileMetadataPolicy;},
    ];
    for(const mutate of mutations){
      const changed=structuredClone(request);mutate(changed);expect(PairedJudgeRequestSchema.safeParse(changed).success).toBe(false);
      const invoke=vi.fn(),claim=vi.fn();await expect(runServerPairedEvidenceJudge(changed,{invoke,claim,routeFingerprint:async()=>"fixed"})).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();expect(claim).not.toHaveBeenCalled();
    }
  });
  it("requires all bindings to carry metadata and preserves multi-file identities independently",()=>{
    const x=fixture(),source=structuredClone(x.project.sourceArtifacts[0]!),ref=structuredClone(x.project.baselineRun.originalReferences![0]!),snapshot=structuredClone(x.candidate.artifactSnapshots[0]!);
    source.id="second";source.name="第二份.md";ref.sourceArtifactId=source.id;snapshot.sourceArtifactId=source.id;snapshot.frozenArtifact!.sourceArtifactId=source.id;
    x.project.sourceArtifacts.push(source);x.project.baselineRun.originalReferences!.push(ref);x.candidate.artifactSnapshots.push(snapshot);
    const request=x.request();expect(request.versions.original.files!.map(f=>f.name)).toEqual(["original.md","第二份.md"]);
    delete request.context.bindings[1]!.fileMetadata;expect(PairedJudgeRequestSchema.safeParse(request).success).toBe(false);
  });
  it("does not truncate invalid names or byte counts into a valid observation",()=>{
    const x=fixture(),frozen=x.candidate.artifactSnapshots[0]!.frozenArtifact!;
    frozen.name="x".repeat(1025);expect(()=>x.request()).toThrow();frozen.name="updated.md";frozen.size=-1;expect(()=>x.request()).toThrow();
  });
  it("invalidates later metadata edits and keeps a changed filename or MIME visible rather than assuming preservation",async()=>{
    const x=await assess();
    for(const mutate of [
      ()=>{x.project.sourceArtifacts[0]!.name="renamed-original.md";},
      ()=>{x.candidate.artifactSnapshots[0]!.frozenArtifact!.name="renamed-frozen.md";},
      ()=>{x.candidate.artifactSnapshots[0]!.frozenArtifact!.mimeType="application/pdf";},
      ()=>{x.candidate.artifactSnapshots[0]!.frozenArtifact!.size++;},
      ()=>{x.project.baselineRun.originalReferences![0]!.sizeBytes++;},
    ]){
      const before=structuredClone({project:x.project,candidate:x.candidate});mutate();
      expect(candidateWinnerDecision(x.project,x.evaluation,x.project.baselineRun.result!,x.candidate).blockers.join()).toContain("file metadata binding differs");
      Object.assign(x.project,before.project);Object.assign(x.candidate,before.candidate);
    }
    const changed=x.request();expect(changed.versions.original.files![0]!.name).toBe("original.md");
    expect(changed.versions.candidate.files![0]!.name).toBe("updated.md");
  });
  it("cannot strip new receipt metadata and downgrade a pinned Mission to the older interpretation",async()=>{
    const x=await assess(),changed=structuredClone(x.evaluation);
    delete changed.judgeComparison!.receipt.fileMetadataPolicy;for(const b of changed.judgeComparison!.receipt.bindings)delete b.fileMetadata;
    expect(PairedJudgeReceiptSchema.safeParse(changed.judgeComparison!.receipt).success).toBe(true);
    expect(candidateWinnerDecision(x.project,changed,x.project.baselineRun.result!,x.candidate).blockers.join()).toContain("file metadata policy differs");
  });
  it("preserves legacy packets and receipts without adding a default or inventing historical metadata",async()=>{
    const x=fixture();delete x.project.experimentPolicy.judgeFileMetadata;
    const r=await assess(x);expect(r.issued.context).not.toHaveProperty("fileMetadataPolicy");
    expect(JSON.stringify(r.calls)).not.toContain("The files table");
    for(const b of r.issued.context.bindings)expect(b).not.toHaveProperty("fileMetadata");
    for(const arm of ["original","candidate"] as const)expect(r.issued.versions[arm]).not.toHaveProperty("files");
    expect(PairedJudgeReceiptSchema.parse(r.evaluation.judgeComparison!.receipt)).toEqual(r.evaluation.judgeComparison!.receipt);
    expect(candidateWinnerDecision(r.project,r.evaluation,r.project.baselineRun.result!,r.candidate).eligible).toBe(true);
    expect(ExperimentPolicySchema.parse({})).not.toHaveProperty("judgeFileMetadata");
    expect(ExperimentPolicySchema.safeParse({judgeFileMetadata:"bound-file-reference-v1"}).success).toBe(false);
  });
  it("pins the new policy and Original metadata in final, acceptance and scoring fingerprints",()=>{
    const x=fixture(),fingerprints=()=>[finalHoldoutContractFingerprint(x.project),evidenceFingerprint(x.project,x.candidate),campaignScoringInputFingerprint(x.project)];
    const initial=fingerprints();x.project.sourceArtifacts[0]!.name="different.md";const renamed=fingerprints();
    expect(renamed.every((v,i)=>v!==initial[i])).toBe(true);
    delete x.project.experimentPolicy.judgeFileMetadata;const legacy=fingerprints();expect(legacy.every((v,i)=>v!==renamed[i])).toBe(true);
    const legacyFinal=finalHoldoutContractFingerprint(x.project);x.project.sourceArtifacts[0]!.name="third.md";
    expect(finalHoldoutContractFingerprint(x.project)).toBe(legacyFinal);
  });
});
