// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import type {EvolutionEvent} from "@evolution/contracts";
import {pairedJudgeFixture} from "@evolution/testkit";
import {serverPairedJudgeRequest} from "@evolution/harness";
import {claimPairedJudgeAttempt} from "./server-paired-judge-claim";

function fixture(){
  const x=pairedJudgeFixture(),request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
  const events=new Map<string,EvolutionEvent>();
  const ports={scope:{missionId:x.project.id,jobId:"trusted-job",phase:"experiment"},nonce:()=>"one-owner",now:()=>x.at,
    list:vi.fn(async()=>[...events.values()]),append:vi.fn(async(event:EvolutionEvent)=>{if(!events.has(event.id))events.set(event.id,event);})};
  return {...x,request,events,ports};
}
describe("durable paired judge claim",()=>{
  it("writes and confirms ownership before allowing a comparison, without storing document bodies or questions",async()=>{
    const x=fixture();await claimPairedJudgeAttempt(x.request,x.ports);
    expect(x.events.size).toBe(1);expect(x.ports.append).toHaveBeenCalledTimes(1);
    const wire=JSON.stringify([...x.events.values()]);expect(wire).not.toContain("Original measured body");expect(wire).not.toContain("PRIVATE");
    expect(wire).toContain(x.request.context.inputFingerprint);
  });
  it("retains the claim on a completed, failed or unknown invocation instead of granting another budget",async()=>{
    const x=fixture();await claimPairedJudgeAttempt(x.request,x.ports);
    await expect(claimPairedJudgeAttempt(x.request,x.ports)).rejects.toMatchObject({code:"PAIRED_JUDGE_ATTEMPT_NOT_OWNED"});
    expect(x.ports.append).toHaveBeenCalledTimes(1);
  });
  it("accepts JSONB key reordering without weakening owner identity checks",async()=>{
    const x=fixture();
    await claimPairedJudgeAttempt(x.request,{...x.ports,list:async()=>[...x.events.values()].map(event=>({...event,payload:Object.fromEntries(Object.entries(event.payload).reverse())}))});
    expect(x.events.size).toBe(1);
  });
  it("does not treat a new Job or new observation timestamps as permission to reroll the same file and paper",async()=>{
    const x=fixture();await claimPairedJudgeAttempt(x.request,x.ports);
    const changed=structuredClone(x.request);changed.context.inputFingerprint="a-new-observation";
    await expect(claimPairedJudgeAttempt(changed,{...x.ports,scope:{...x.ports.scope,jobId:"another-job"}})).rejects.toThrow("already started");
    expect(x.events.size).toBe(1);
  });
  it("does not grant a fresh scoring budget by renaming an identical Candidate",async()=>{
    const x=fixture();await claimPairedJudgeAttempt(x.request,x.ports);
    const changed=structuredClone(x.request);changed.context.candidateId="renamed-identical-file";
    await expect(claimPairedJudgeAttempt(changed,x.ports)).rejects.toThrow("already started");expect(x.events.size).toBe(1);
  });
  it("has one owner under concurrent calls even when the store merely ignores duplicate IDs",async()=>{
    const x=fixture(),results=await Promise.allSettled([
      claimPairedJudgeAttempt(x.request,{...x.ports,nonce:()=>"first"}),
      claimPairedJudgeAttempt(x.request,{...x.ports,nonce:()=>"second"}),
    ]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(x.events.size).toBe(1);
  });
  it("fails closed on incomplete listing or unknown append/readback instead of allowing model calls",async()=>{
    const x=fixture(),event={id:"unrelated"} as EvolutionEvent;
    await expect(claimPairedJudgeAttempt(x.request,{...x.ports,list:async()=>Array(1000).fill(event)})).rejects.toThrow("incomplete");
    expect(x.ports.append).not.toHaveBeenCalled();
    await expect(claimPairedJudgeAttempt(x.request,{...x.ports,append:async()=>{throw Error("unknown write");}})).rejects.toThrow("unknown write");
    await expect(claimPairedJudgeAttempt(x.request,{...x.ports,list:async()=>[]})).rejects.toThrow("ownership was not confirmed");
  });
  it("requires a trusted matching Mission/Job scope and rejects foreign ownership",async()=>{
    const x=fixture();
    for(const scope of [undefined,{phase:"test"},{missionId:"foreign",jobId:"job",phase:"test"},{...x.ports.scope,candidateId:"foreign"}])
      await expect(claimPairedJudgeAttempt(x.request,{...x.ports,scope})).rejects.toThrow("trusted Mission/Job");
    expect(x.ports.append).not.toHaveBeenCalled();
  });
});
