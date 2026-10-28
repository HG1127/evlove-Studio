import {describe,expect,it} from "vitest";
import {RepairBaselineDocumentsSchema} from "./repair-baseline-document-contract";
const document={sourceArtifactId:"source",artifactSha256:"a".repeat(64),textFingerprint:"synthetic-fingerprint",text:"Measured original wording",complete:true,
 excludes:["scripts","styles","raw-attributes"],testCaseIds:["visible-case"],observedAt:"2026-10-23T12:00:00.000Z"};
const context={schemaVersion:"repair-baseline-documents-v1",feedbackPhase:"visible",documents:[document],omittedSourceArtifactIds:[],limitations:["Read-only observation, not a verdict"]};
describe("versioned repair Baseline document boundary",()=>{
 it("keeps complete measured text without introducing editable coordinates",()=>{expect(RepairBaselineDocumentsSchema.parse(context)).toEqual(context);});
 it.each(["raw-html","anchor","incomplete","oversized","final-paper"] as const)("rejects %s payloads",kind=>{
  const raw=structuredClone(context);
  if(kind==="raw-html")Object.assign(raw.documents[0]!,{rawHtml:"<script>not allowed</script>"});
  if(kind==="anchor")Object.assign(raw.documents[0]!,{anchorId:"original-not-editable"});
  if(kind==="incomplete")Object.assign(raw.documents[0]!,{complete:false});
  if(kind==="oversized")raw.documents[0]!.text="x".repeat(64_001);
  if(kind==="final-paper")Object.assign(raw,{independentFinal:{input:"not allowed"}});
  expect(RepairBaselineDocumentsSchema.safeParse(raw).success).toBe(false);
 });
});
