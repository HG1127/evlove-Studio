// @vitest-environment node
import {describe,it,expect} from "vitest";
import {PAIRED_JSONL_PROTOCOL,PairedEvaluationAiResultSchema} from "@evolution/contracts";
import {parsePairedJsonl} from "./paired-jsonl";
const scope={requestFingerprint:"fixed:0",bindings:[{criterionId:"GOAL",testCaseIds:["T1"]}]};
function fixture(){
 const summary={accuracy:93,evidence:94,riskCoverage:95,completeness:96,safety:"PASS",notes:['untrusted "quote"\nsecond line'],failures:[],cases:[]};
 const row={criterionId:"GOAL",score:97,pass:true,evidence:["original source quote"],gaps:[],testCaseIds:["T1"]};
 const records=[{kind:"header",protocol:PAIRED_JSONL_PROTOCOL,requestFingerprint:scope.requestFingerprint},
  ...["A","B","C"].flatMap(slot=>[{kind:"summary",slot,value:structuredClone(summary)},{kind:"criterion",slot,value:structuredClone(row)}]),
  {kind:"end",requestFingerprint:scope.requestFingerprint,criterionRecords:3}];
 const expected=PairedEvaluationAiResultSchema.parse({schemaVersion:"paired-evaluation-v1",requestFingerprint:scope.requestFingerprint,
  versions:["A","B","C"].map(slot=>({slot,result:{...summary,criteria:[row]}}))});
 return {records,expected};
}
const wire=(records:unknown[])=>records.map(r=>JSON.stringify(r)).join("\n");
describe("explicit paired JSONL transport",()=>{
 it("preserves every canonical score and explanation, including escaped newlines",()=>{
  const x=fixture();expect(parsePairedJsonl(wire(x.records),scope)).toEqual(x.expected);
  expect(parsePairedJsonl(wire(x.records).replaceAll("\n","\r\n")+"\r\n",scope)).toEqual(x.expected);
 });
 for(const mode of ["truncated","missing-end","missing-row","duplicate-row","duplicate-slot","foreign-criterion","foreign-case","fingerprint","missing-evidence","extra-field","string-score","range","zero-summary","foreign-case-score","end-count","protocol"]){
  it("rejects "+mode+" without changing its input",()=>{
   const {records}=fixture();const r=records as Array<Record<string,unknown>>;
   if(mode==="missing-end")r.pop();
   if(mode==="missing-row")r.splice(2,1);
   if(mode==="duplicate-row")r.splice(2,0,structuredClone(r[2]!));
   if(mode==="duplicate-slot")r[3]!.slot="A";
   const row=r[2]!.value as Record<string,unknown>,summary=r[1]!.value as Record<string,unknown>;
   if(mode==="foreign-criterion")row.criterionId="OTHER";
   if(mode==="foreign-case")row.testCaseIds=["OTHER"];
   if(mode==="fingerprint")r[0]!.requestFingerprint="OTHER";
   if(mode==="missing-evidence")delete row.evidence;
   if(mode==="extra-field")row.secret="discard me";
   if(mode==="string-score")row.score="97";
   if(mode==="range")row.score=101;
   if(mode==="zero-summary")Object.assign(summary,{accuracy:0,evidence:0,riskCoverage:0});
   if(mode==="foreign-case-score")summary.cases=[{testCaseId:"OTHER",accuracy:99,evidence:99,completeness:99,reason:"foreign"}];
   if(mode==="end-count")r.at(-1)!.criterionRecords=6;
   if(mode==="protocol")r[0]!.protocol="unknown";
   const text=mode==="truncated"?wire(r).slice(0,-1):wire(r),before=JSON.stringify(r);
   expect(()=>parsePairedJsonl(text,scope)).toThrow();expect(JSON.stringify(r)).toBe(before);
  });
 }
 it("rejects object-response fallback, code fences, blank records, BOM and oversized output",()=>{
  const {records,expected}=fixture(),text=wire(records);
  for(const invalid of [JSON.stringify(expected),'```json\n'+text+'\n```',text+'\n\n','\uFEFF'+text,' '.repeat(4_000_001)])
   expect(()=>parsePairedJsonl(invalid,scope)).toThrow();
 });
 it("rejects duplicate issued criteria before decoding a response",()=>{
  expect(()=>parsePairedJsonl(wire(fixture().records),{...scope,bindings:[...scope.bindings,...scope.bindings]})).toThrow();
 });
});
