// @vitest-environment node
import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {AcceptanceCriterionSchema,EvolveProjectSchema,InputUnderstandingSchema,TestCaseSchema} from "@evolution/contracts";
import {confirmedHtmlProtectionOperationalScope} from "@evolution/core";
import {prepareServerHtmlProtectionOperationalConfirmation} from "./server-html-protection-operational-confirmation";
const at="2026-10-16T08:00:00.000Z";
const html="\uFEFF<!doctype html>\r\n<html><body><article class='slide-card'><h2>Heading</h2><p>Method</p></article></body></html>";
function fixture(){
 const rubric=[
  AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"Protect Original",requirement:"Preserve all Original methods",weight:40,hardGate:true,protectedConstraint:true,evidenceExpected:["Independent complete protection"]}),
  AcceptanceCriterionSchema.parse({id:"REFINE",title:"Refine",requirement:"Add configuration detail in existing body",source:"user-command",weight:30,evidenceExpected:["Concrete wording"]}),
  AcceptanceCriterionSchema.parse({id:"QUALITY",title:"Quality",requirement:"Readable document",weight:30,evidenceExpected:["Full visible/hidden coverage"]})];
 const test=TestCaseSchema.parse({id:"H",title:"Complete paper",input:"Full Original",expected:["Preserved and refined"],hidden:true,criterionIds:rubric.map(item=>item.id)});
 const project=EvolveProjectSchema.parse({id:"M",name:"Fresh Original",objectType:"document",department:"test",version:"V1",stage:"target",goal:"Refine configuration",protectedItems:["Original methods"],editableItems:["Existing chapter body text"],metrics:[],
  sourceArtifacts:[{id:"source",name:"original.html",extension:"html",mimeType:"text/html",size:Buffer.byteLength(html),role:"target",parseStatus:"ready",createdAt:at,textContent:"stale parser view",storageRef:"original-blob"}],
  inputUnderstanding:InputUnderstandingSchema.parse({status:"ready",confidence:.9}),acceptanceRubric:rubric,hiddenEvalSuite:[test],
  gates:[{id:"target-ready",status:"approved",approvedAt:at}],acceptanceRubricState:{status:"ready",version:1,confirmedAt:at},
  baselineRun:{id:"B",status:"idle",suiteName:"Visible",totalCases:0,runs:[]},experimentRun:{id:"E",status:"idle",candidateResults:[]},validationRun:{id:"H",status:"idle",checks:[],runs:[],baselineRuns:[]},
  candidates:[],problems:[],lessons:[],experimentPolicy:{},release:{status:"idle",history:[]},targetConnection:{adapter:"artifact"},updatedAt:at});
 const getArtifact=vi.fn(async()=>new Blob([html],{type:"text/html"}));
 return {project,actor:{id:"human",role:"operator" as const,source:"browser-session" as const},humanReviewNote:"Explicit human review of the full finite operational policy",ports:{getArtifact}};
}
describe("physical human Target Ready operational confirmation",()=>{
 it("uses complete physical BOM/CRLF bytes and leaves the preview input and old record unchanged",async()=>{
  const f=fixture(),before=structuredClone(f.project),prepared=await prepareServerHtmlProtectionOperationalConfirmation(f);
  expect(prepared.original).toEqual({sourceArtifactId:"source",sha256:createHash("sha256").update(html).digest("hex"),byteLength:Buffer.byteLength(html)});
  expect(f.ports.getArtifact).toHaveBeenCalledWith("original-blob");expect(f.project).toEqual(before);
  expect(confirmedHtmlProtectionOperationalScope(prepared.next,prepared.original)?.outsideScope).toBe("unverified");
  expect(prepared.next.baselineRun.status).toBe("idle");expect(prepared.next.candidates).toEqual([]);
 });
 it.each(["human","target-ready","rubric","paper","size","bytes","executed"] as const)("rejects %s without reinterpreting the old Mission",async kind=>{
  const f=fixture();
  if(kind==="human")f.actor.source="service-key" as never;
  if(kind==="target-ready")f.project.gates[0]!.status="pending";
  if(kind==="rubric")f.project.acceptanceRubricState.confirmedAt="2026-10-16T08:01:00.000Z";
  if(kind==="paper")f.project.hiddenEvalSuite=[];
  if(kind==="size")f.project.sourceArtifacts[0]!.size++;
  if(kind==="bytes")f.ports.getArtifact.mockResolvedValue(new Blob([new Uint8Array([255])]));
  if(kind==="executed")f.project.baselineRun.status="completed";
  const before=structuredClone(f.project);await expect(prepareServerHtmlProtectionOperationalConfirmation(f)).rejects.toThrow();expect(f.project).toEqual(before);
 });
 it("changes the preview SHA when any actual same-size Original bytes change",async()=>{
  const f=fixture(),a=await prepareServerHtmlProtectionOperationalConfirmation(f);
  f.ports.getArtifact.mockResolvedValue(new Blob([html.replace("Method","Change")],{type:"text/html"}));
  const b=await prepareServerHtmlProtectionOperationalConfirmation(f);expect(b.original.sha256).not.toBe(a.original.sha256);
  expect(b.targetContractSha256).toBe(a.targetContractSha256); // file hash is a separate exact confirmation field
 });
});
