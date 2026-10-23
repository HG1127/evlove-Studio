import {describe,expect,it,vi} from "vitest";
import {EvaluateAiResultSchema,type EvaluateAiResult} from "@evolution/contracts";
import {runServerEvidenceJudge} from "./server-evidence-judge";

const makeError=(code:string)=>Object.assign(new Error("Provider returned invalid output"),{code});
function fixture(){
  const criteria=Array.from({length:5},(_,i)=>({
    id:"CR-"+(i+1),weight:[55,15,12,10,8][i],
    title:"Criterion "+(i+1),requirement:"Check actual evidence "+(i+1),
    evidenceExpected:["must be observed"],hardGate:i===0,
  }));
  const testCases=[
    {id:"T1",title:"T1",criterionIds:["CR-1"],expected:["check"]},
    {id:"T2",title:"T2",criterionIds:["CR-2"],expected:["check"]},
    {id:"T3",title:"T3",criterionIds:["CR-3","CR-4"],expected:["check"]},
    {id:"T4",title:"T4",criterionIds:["CR-5"],expected:["check"]},
  ];
  const runs=testCases.map(test=>({
    testCaseId:test.id,verificationStatus:"verified",outputChunks:["exact observed result "+test.id],
    trace:[{stage:"runner",status:"pass",summary:"observed"}],
  }));
  return {mode:"server-candidate",candidate:{id:"frozen-candidate"},
    project:{goal:"verify exact artifact",metrics:[],acceptanceRubric:criteria},
    acceptanceRubric:criteria,testCases,runs,
    evaluatorInstruction:"Use actual evidence only."};
}
function response(payload:ReturnType<typeof fixture>,safety:"PASS"|"REVIEW"|"FAIL"="PASS"):EvaluateAiResult{
  return EvaluateAiResultSchema.parse({
    accuracy:91,evidence:92,riskCoverage:86,completeness:93,safety,
    notes:["independent checked"],failures:[],
    cases:payload.testCases.map(test=>({testCaseId:test.id,accuracy:91,evidence:92,completeness:93,reason:"observed "+test.id})),
    criteria:payload.acceptanceRubric.map(criterion=>({
      criterionId:criterion.id,score:91,pass:true,
      evidence:["exact evidence "+criterion.id],gaps:[],
      testCaseIds:payload.testCases.filter(test=>test.criterionIds.includes(criterion.id)).map(test=>test.id),
    })),
  });
}
function mockCall(status:(args:ReturnType<typeof fixture>,index:number)=>EvaluateAiResult|Promise<EvaluateAiResult>){
  const calls:Array<ReturnType<typeof fixture>>=[];
  const invoke=vi.fn(async(payload:unknown)=>{
    const p=payload as ReturnType<typeof fixture>;
    calls.push(p);
    return status(p,calls.length);
  });
  return {calls,invoke};
}

describe("server evidence Judge safe structured fallback",()=>{
  it("keeps the normal one-call independent Judge when JSON is complete",async()=>{
    const full=fixture(),mock=mockCall(p=>response(p));
    const result=await runServerEvidenceJudge(full,mock.invoke);
    expect(result.criteria).toHaveLength(5);
    expect(result.cases).toHaveLength(4);
    expect(mock.calls).toHaveLength(1);
  });
  it("shards an invalid large JSON Judge on the same frozen-run evidence, with exact criterion identity",async()=>{
    const full=fixture();
    const mock=mockCall((p,index)=>{
      if(index===1)throw makeError("AI_OUTPUT_INVALID_JSON");
      return response(p);
    });
    const result=await runServerEvidenceJudge(full,mock.invoke);
    expect(mock.calls.map(p=>p.acceptanceRubric.map(c=>c.id))).toEqual([
      ["CR-1","CR-2","CR-3","CR-4","CR-5"],
      ["CR-1","CR-2","CR-3"],
      ["CR-4","CR-5"],
    ]);
    expect(mock.calls.slice(1).every(p=>p.runs.every(r=>full.runs.some(original=>original.testCaseId===r.testCaseId && original.outputChunks[0]===r.outputChunks[0])))).toBe(true);
    expect(result.criteria.map(c=>c.criterionId)).toEqual(full.acceptanceRubric.map(c=>c.id));
    expect(result.criteria.every(c=>c.evidence[0]?.startsWith("exact evidence"))).toBe(true);
    // T3 is judged from both CR-3 and CR-4 perspectives, so its ambiguous
    // case score is deliberately omitted rather than double-counted.
    expect(result.cases.map(c=>c.testCaseId).sort()).toEqual(["T1","T2","T4"]);
    expect(result.safety).toBe("PASS");
    expect(result.notes.join(" ")).toContain("分片");
  });
  it("splits a malformed shard further, but never changes safety FAIL into a pass",async()=>{
    const full=fixture();
    const mock=mockCall((p,index)=>{
      if(index===1||p.acceptanceRubric.length>2)throw makeError("AI_OUTPUT_INCOMPLETE");
      return response(p,p.acceptanceRubric.some(c=>c.id==="CR-2")?"FAIL":"PASS");
    });
    const result=await runServerEvidenceJudge(full,mock.invoke);
    expect(mock.calls.length).toBeGreaterThan(3);
    expect(result.criteria).toHaveLength(5);
    expect(result.safety).toBe("FAIL");
  });
  it("fails closed for missing, extra or fabricated criterion identities",async()=>{
    for(const mutation of ["missing","extra","case"]){
      const full=fixture();
      const mock=mockCall((p,index)=>{
        if(index===1)throw makeError("AI_OUTPUT_INVALID_JSON");
        const base=response(p);
        if(mutation==="missing")return {...base,criteria:base.criteria.slice(1)};
        if(mutation==="extra")return {...base,criteria:[...base.criteria,{...base.criteria[0]!,criterionId:"EXTRA"}]};
        return {...base,cases:[...base.cases,{...base.cases[0]!,testCaseId:"UNOBSERVED"}]};
      });
      await expect(runServerEvidenceJudge(full,mock.invoke)).rejects.toThrow();
      expect(mock.calls.length).toBe(2);
    }
  });
  it("never returns partial model output when even a single-criterion retry remains invalid",async()=>{
    const mock=mockCall((p,index)=>{
      if(index===1||p.acceptanceRubric.some(c=>c.id==="CR-1"))throw makeError("AI_OUTPUT_INVALID_JSON");
      return response(p);
    });
    await expect(runServerEvidenceJudge(fixture(),mock.invoke)).rejects.toMatchObject({code:"AI_OUTPUT_INVALID_JSON"});
  });
  it("does not retry for network/auth failures, ambiguous execution receipts or one criterion",async()=>{
    const input=fixture();
    for(const code of ["SERVER_AI_PROVIDER_NETWORK_ERROR","SERVER_AI_PROVIDER_TIMEOUT","SERVER_AI_UNAVAILABLE"]){
      const mock=mockCall(()=>{throw makeError(code);});
      await expect(runServerEvidenceJudge(input,mock.invoke)).rejects.toMatchObject({code});
      expect(mock.calls).toHaveLength(1);
    }
    const corrupt={...input,runs:[...input.runs,input.runs[0]!]};
    const mock=mockCall(()=>{throw makeError("AI_OUTPUT_INVALID_JSON");});
    await expect(runServerEvidenceJudge(corrupt,mock.invoke)).rejects.toMatchObject({code:"AI_OUTPUT_INVALID_JSON"});
    expect(mock.calls).toHaveLength(1);
    const one={...input,acceptanceRubric:input.acceptanceRubric.slice(0,1)};
    await expect(runServerEvidenceJudge(one,mock.invoke)).rejects.toMatchObject({code:"AI_OUTPUT_INVALID_JSON"});
  });
});
