import {describe,expect,it} from "vitest";
import {LessonSchema,type EvolveProject,type Lesson,type LessonProvenance} from "@evolution/contracts";
import {syntheticLearningProject,withMeasuredProductionGoal} from "@evolution/testkit";
import {attachLessonGovernance,governProductionLessons,integrateDistilledLesson} from "./learning-governance";
import {buildLessonProvenance,productionLessonProvenanceBlocker,lessonDistillationSource} from "./lesson-provenance";
import {selectPlanningLessons,selectProjectPlanningLessons} from "./planning-lessons";

const at="2026-09-20T15:00:00.000Z",now=Date.parse(at);
const raw=():Lesson=>LessonSchema.parse({id:"L1",title:"Synthetic method",summary:"synthetic source binding only",reusable:true,
  effect:"not causal evidence",limit:"synthetic",status:"verified-skill"});
const skill=(p:EvolveProject)=>attachLessonGovernance(p,raw(),{at});
const mutations:Array<[string,(provenance:LessonProvenance)=>void]>=[
  ["foreign Mission",p=>p.missionId="other"],
  ["foreign Candidate",p=>p.candidateId="C2"],
  ["foreign Deployment",p=>p.deploymentId="other"],
  ["foreign Validation",p=>p.validationRunId="other"],
  ["wrong hash",p=>p.artifactHashes[0]="wrong"],
  ["missing snapshot",p=>p.artifactSnapshotIds=[]],
  ["extra snapshot",p=>p.artifactSnapshotIds.push("extra")],
  ["missing hash",p=>p.artifactHashes=[]],
  ["simulation source",p=>p.releaseEvidenceMode="simulation"],
  ["missing live observation",p=>delete p.releaseObservedAt],
  ["unparseable derived time",p=>p.derivedAt="invalid"],
  ["future derived time",p=>p.derivedAt="2026-09-20T16:00:00.000Z"],
  ["observation after derivation",p=>p.releaseObservedAt="2026-09-20T15:03:00.000Z"],
];

describe("production lesson source qualification",()=>{
  it("retains an identity-bound skill and its source at use time without changing stored records",()=>{
    const p=syntheticLearningProject();p.lessons=[skill(p)];const saved=JSON.stringify(p);
    expect(productionLessonProvenanceBlocker(p,p.lessons[0]!,now)).toBeUndefined();
    expect(selectProjectPlanningLessons(p,6,now).map(l=>l.id)).toEqual(["L1"]);
    expect(JSON.stringify(p)).toBe(saved);
  });
  it.each(mutations)("does not mint or retain a verified skill with %s",(_,mutate)=>{
    const p=syntheticLearningProject(),forged=skill(p);mutate(forged.provenance!);
    const originalProvenance=structuredClone(forged.provenance);
    const attached=attachLessonGovernance(p,forged,{at});
    expect(attached).toMatchObject({status:"lesson",reusable:false,governance:{status:"degraded"}});
    expect(attached.provenance).toEqual(originalProvenance);
    p.lessons=[forged];
    const governed=governProductionLessons(p,{now,at});
    expect(governed.lessons[0]).toMatchObject({status:"lesson",reusable:false,governance:{status:"degraded"}});
    expect(governed.lessons[0]?.governance?.history?.at(-1)?.status).toBe("degraded");
    expect(selectProjectPlanningLessons(p,6,now)).toEqual([]);
    expect(p.lessons[0]?.status).toBe("verified-skill");
    p.lessons=governed.lessons;
    expect(governProductionLessons(p,{now,at}).lessons[0]?.governance?.status).toBe("degraded");
  });
  it("cannot supersede old negative evidence using a wrong-source distilled skill",()=>{
    const p=syntheticLearningProject(),old=skill(p);
    p.lessons=[{...old,reusable:false,status:"lesson",governance:{...old.governance!,status:"degraded"}}];
    const forged={...skill(p),id:"L2"};forged.provenance!.missionId="foreign";
    const integrated=integrateDistilledLesson(p,forged,{at});
    expect(integrated.lesson).toMatchObject({status:"lesson",reusable:false,governance:{status:"degraded"}});
    expect(integrated.lessons.find(l=>l.id==="L1")?.governance?.status).toBe("degraded");
    expect(integrated.lesson.provenance?.supersedesLessonIds).toEqual([]);
  });
  it.each(["missing-snapshots","missing-hash","duplicate-id","duplicate-source","duplicate-candidate","contradictory-champion","unbound-validation"])("blocks incomplete or ambiguous source %s",kind=>{
    const p=syntheticLearningProject(),candidate=p.candidates[0]!;
    if(kind==="missing-snapshots")candidate.artifactSnapshots=[];
    if(kind==="missing-hash")delete candidate.artifactSnapshots[0]!.contentHash;
    if(kind==="duplicate-id")candidate.artifactSnapshots.push({...candidate.artifactSnapshots[0]!});
    if(kind==="duplicate-source")candidate.artifactSnapshots.push({...candidate.artifactSnapshots[0]!,id:"other-snapshot"});
    if(kind==="duplicate-candidate")p.candidates.push(structuredClone(candidate));
    if(kind==="contradictory-champion")p.searchChampion!.candidate={...candidate,artifactSnapshots:[{...candidate.artifactSnapshots[0]!,contentHash:"other"}]};
    if(kind==="unbound-validation")delete p.validationRun.candidateId;
    expect(skill(p)).toMatchObject({status:"lesson",reusable:false,governance:{status:"degraded"}});
  });
  it("binds each snapshot ID to its own hash, allowing equivalent pair ordering and equal file contents",()=>{
    const p=syntheticLearningProject(),snap=p.candidates[0]!.artifactSnapshots[0]!;
    p.candidates[0]!.artifactSnapshots.push({...snap,id:"snap-two",sourceArtifactId:"source-two",contentHash:"hash-two"});
    const l=skill(p);expect(l.status).toBe("verified-skill");
    l.provenance!.artifactHashes.reverse();
    expect(productionLessonProvenanceBlocker(p,l,now)).toContain("配对");
    l.provenance!.artifactSnapshotIds.reverse();
    expect(productionLessonProvenanceBlocker(p,l,now)).toBeUndefined();
    l.provenance!.artifactSnapshotIds=["snap-c1","snap-c1"];
    expect(productionLessonProvenanceBlocker(p,l,now)).toContain("配对");
    p.candidates[0]!.artifactSnapshots[1]!.contentHash="hash-c1";
    expect(skill(p).status).toBe("verified-skill");
  });
  it("checks release hash pairs when supplied, retaining the existing array-over-scalar receipt precedence",()=>{
    let p=syntheticLearningProject();
    p.release.artifactHashes=[{sourceArtifactId:"source-c1",contentHash:"wrong"}];
    p=withMeasuredProductionGoal(p);expect(skill(p).status).toBe("lesson");
    p.release.artifactHashes=[{sourceArtifactId:"source-c1",contentHash:"hash-c1"}];
    p.release.artifactHash="legacy scalar ignored when complete pairs exist";
    p=withMeasuredProductionGoal(p);expect(skill(p).status).toBe("verified-skill");
    delete p.release.artifactHashes;p.release.artifactHash="wrong";
    p=withMeasuredProductionGoal(p);expect(skill(p).status).toBe("lesson");
  });
  it("keeps source Champion validation when a later search replaces the current Candidate and validationRun",()=>{
    const p=syntheticLearningProject(),old=p.candidates[0]!;
    p.lessons=[skill(p)];
    p.searchChampion!.candidate=structuredClone(old);p.searchChampion!.validation=structuredClone(p.validationRun);
    p.candidates=[{...old,id:"C2"}];p.experimentRun.winnerId="C2";
    p.validationRun={...p.validationRun,id:"validation-c2",candidateId:"C2"};
    expect(buildLessonProvenance(p,at).validationRunId).toBe("validation-c1");
    expect(lessonDistillationSource(p)).toMatchObject({candidate:{id:"C1"},validation:{id:"validation-c1",candidateId:"C1"}});
    expect(selectProjectPlanningLessons(p,6,now).map(l=>l.id)).toEqual(["L1"]);
    p.searchChampion!.validation=undefined;
    expect(lessonDistillationSource(p)).toBeUndefined();
    expect(selectProjectPlanningLessons(p,6,now)).toEqual([]);
  });
  it("uses the exact accepted offline Candidate in both model context and provenance",()=>{
    const p=syntheticLearningProject(),old=p.candidates[0]!;
    p.releaseTarget={provider:"none",mode:"progressive",status:"not-configured",label:"offline",healthPath:"/"};
    p.candidates.push({...old,id:"C2",artifactSnapshots:[{...old.artifactSnapshots[0]!,id:"snap-c2",contentHash:"hash-c2"}]});
    p.artifactAcceptance={...p.artifactAcceptance,status:"passed",candidateId:"C2"};
    p.validationRun={...p.validationRun,id:"validation-c2",candidateId:"C2"};
    expect(lessonDistillationSource(p)).toMatchObject({candidate:{id:"C2"},validation:{candidateId:"C2"}});
    expect(buildLessonProvenance(p,at)).toMatchObject({candidateId:"C2",validationRunId:"validation-c2",artifactSnapshotIds:["snap-c2"],artifactHashes:["hash-c2"]});
  });
  it("does not require the original observation timestamp to equal a later healthy refresh",()=>{
    let p=syntheticLearningProject();p.lessons=[skill(p)];
    const refreshedAt="2026-09-20T15:01:00.000Z";
    p.release.observedAt=refreshedAt;p=withMeasuredProductionGoal(p);
    expect(selectProjectPlanningLessons(p,6,Date.parse(refreshedAt))).toHaveLength(1);
  });
  it("filters stale or unbound verified methods at actual use while keeping raw lessons and warnings",()=>{
    const p=syntheticLearningProject(),valid=skill(p);p.lessons=[valid];
    expect(selectProjectPlanningLessons(p,6,now+60*60_000)).toEqual([]);
    for(const broken of [{...valid,governance:undefined},{...valid,provenance:undefined},
      {...valid,governance:{...valid.governance!,status:"pending" as const}},
      {...valid,governance:{...valid.governance!,candidateId:undefined}}])expect(selectPlanningLessons([broken])).toEqual([]);
    const ordinary={...raw(),id:"raw",status:"lesson" as const};
    const warning={...raw(),id:"warning",status:"anti-pattern" as const,reusable:false};
    expect(selectPlanningLessons([ordinary,warning]).map(l=>l.id)).toEqual(["raw","warning"]);
  });
  it("does not retain a legacy production certificate on an offline Mission",()=>{
    const p=syntheticLearningProject();p.lessons=[skill(p)];
    p.releaseTarget={provider:"none",mode:"progressive",status:"not-configured",label:"offline",healthPath:"/"};
    const governed=governProductionLessons(p,{now,at});
    expect(governed.lessons[0]).toMatchObject({status:"lesson",reusable:false,governance:{status:"degraded"}});
    expect(selectProjectPlanningLessons(p,6,now)).toEqual([]);
    expect(governed.lessons[0]?.provenance).toEqual(p.lessons[0]?.provenance);
  });
});
