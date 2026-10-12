import {beforeEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {acceptedLegacyHtmlPaperFixture} from "@evolution/testkit";
import {evidenceFingerprint} from "@evolution/core";
import {acceptCandidateArtifacts} from "./artifact-quality";
const mocks=vi.hoisted(()=>({ai:vi.fn(),read:vi.fn(),build:vi.fn(),verify:vi.fn(),freeze:vi.fn()}));
vi.mock("../ai/service",()=>({runEvolveAi:mocks.ai}));
vi.mock("./artifact-output-builders",()=>({buildDownloadBlob:mocks.build,verifyGeneratedArtifact:mocks.verify}));
vi.mock("./frozen-artifact",()=>({readFrozenArtifact:mocks.read,freezeArtifact:mocks.freeze}));
function fixture(mode:"search"|"static"|"mixed"="search"){
 const f=acceptedLegacyHtmlPaperFixture(false,mode),p=f.project;
 const base=p.acceptanceRubric[0]!;
 p.acceptanceRubric.push({...base,id:"SYS-PAIRWISE",title:"Improvement",requirement:"Compare improvement",protectedConstraint:false,weight:10});
 const scores=p.acceptanceRubric.map(c=>({criterionId:c.id,score:100,pass:true,verificationStatus:"verified" as const,evidence:["synthetic high same-fingerprint score"],gaps:[],testCaseIds:["H1"]}));
 p.validationRun.evaluation={...p.validationRun.evaluation!,criterionScores:scores};
 p.validationRun.evidenceFingerprint=evidenceFingerprint(p,f.current);
 return f;
}
beforeEach(()=>{vi.resetAllMocks();mocks.read.mockResolvedValue(new Blob(["synthetic bytes"]));mocks.ai.mockImplementation((_action:string,payload:{rubric:Array<{id:string}>})=>({overallScore:100,coverageScore:100,integrityScore:100,pairwiseScore:100,hardGatePass:true,results:payload.rubric.map(c=>({criterionId:c.id,score:100,pass:true,evidence:["synthetic AI complete protection claim"],gaps:[],note:"claimed"})),summary:"all checks passed"}));});
describe("legacy Gate F cannot preResolve whole HTML protection",()=>{
 it.each(["search","static","mixed"] as const)("keeps %s high Hidden/frozen/AI claims UNVERIFIED before byte reads or judging",async mode=>{
  const f=fixture(mode);const result=await acceptCandidateArtifacts(f.project,f.current,f.project.acceptanceRubric);
  expect(result.status).toBe("unverified");expect(result.hardGatePass).toBe(false);expect(result.acceptedAt).toBeUndefined();
  expect(result.summary).toContain("html-protection-scope-pending");
  for(const call of [mocks.ai,mocks.read,mocks.build,mocks.verify,mocks.freeze])expect(call).not.toHaveBeenCalled();
 });
 it("cannot omit the original protected criterion via a caller supplied criteria subset",async()=>{
  const f=fixture();const result=await acceptCandidateArtifacts(f.project,f.current,f.project.acceptanceRubric.filter(c=>c.id!=="PROTECT-ALL"));
  expect(result.status).toBe("unverified");expect(result.summary).toContain("html-protection-scope-pending");expect(mocks.ai).not.toHaveBeenCalled();
 });
 it("retains a narrow HTML format roundtrip and bound semantic scores",async()=>{
  const f=fixture();f.project.acceptanceRubric=f.project.acceptanceRubric.map(c=>c.id==="PROTECT-ALL"?{...c,id:"FORMAT",title:"HTML file format",requirement:"HTML container format",protectedConstraint:false,source:"user-command" as const,validationMethod:"format-roundtrip" as const}:c);
  f.project.validationRun.evaluation!.criterionScores=f.project.validationRun.evaluation!.criterionScores!.map(s=>s.criterionId==="PROTECT-ALL"?{...s,criterionId:"FORMAT"}:s);
  f.project.validationRun.evidenceFingerprint=evidenceFingerprint(f.project,f.current);
  const result=await acceptCandidateArtifacts(f.project,f.current,f.project.acceptanceRubric);
  expect(result.status).toBe("passed");expect(result.results.find(r=>r.criterionId==="FORMAT")?.note).toContain("roundtrip");expect(mocks.read).toHaveBeenCalledOnce();expect(mocks.ai).not.toHaveBeenCalled();
 });
 it("retains whole protection scores for a real non-HTML target",async()=>{
  const f=fixture();const source=f.project.sourceArtifacts[0]!,snapshot=f.current.artifactSnapshots[0]!;
  Object.assign(source,{name:"original.md",extension:"md",mimeType:"text/markdown",textContent:"Original document instructions with useful text."});
  Object.assign(snapshot,{name:"evolved.md",mimeType:"text/markdown",content:"Improved original document instructions with useful text and steps."});
  const sha=createHash("sha256").update(snapshot.content).digest("hex");snapshot.contentHash=sha;
  snapshot.frozenArtifact={...snapshot.frozenArtifact!,name:snapshot.name,mimeType:snapshot.mimeType,snapshotHash:sha,sha256:sha,size:Buffer.byteLength(snapshot.content)};
  f.project.validationRun.evidenceFingerprint=evidenceFingerprint(f.project,f.current);
  const result=await acceptCandidateArtifacts(f.project,f.current,f.project.acceptanceRubric);
  expect(result.status).toBe("passed");expect(result.results.find(r=>r.criterionId==="PROTECT-ALL")?.pass).toBe(true);expect(mocks.read).toHaveBeenCalledOnce();expect(mocks.ai).not.toHaveBeenCalled();
 });
});
it("cannot preResolve canonical SYS-INTEGRITY from static/frozen-file heuristics",async()=>{
 const f=fixture("static");f.project.acceptanceRubric=f.project.acceptanceRubric.map(c=>c.id==="PROTECT-ALL"?{...c,id:"SYS-INTEGRITY",protectedConstraint:false,hardGate:false}:c);
 f.project.validationRun.evaluation!.criterionScores=f.project.validationRun.evaluation!.criterionScores!.map(s=>s.criterionId==="PROTECT-ALL"?{...s,criterionId:"SYS-INTEGRITY"}:s);
 f.project.validationRun.evidenceFingerprint=evidenceFingerprint(f.project,f.current);
 const result=await acceptCandidateArtifacts(f.project,f.current,f.project.acceptanceRubric);
 expect(result.status).toBe("unverified");expect(result.summary).toContain("html-protection-scope-pending");expect(result.hardGatePass).toBe(false);
 expect(mocks.read).not.toHaveBeenCalled();expect(mocks.ai).not.toHaveBeenCalled();
});