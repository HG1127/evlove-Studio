import {z} from "zod";
import type {EvolutionJob} from "@evolution/contracts";
import {getServerProductionRuntime} from "./production-runtime";
import {inspectIsolatedLabRuntime} from "../isolated-lab-runtime";

const MAX_LAB_JOB_SCAN=100;
const Active=new Set(["queued","running","waiting"]);
const Issue=z.object({
  jobId:z.string().min(1),
  missionId:z.string().min(1),
  jobStatus:z.enum(["queued","running","waiting"]),
  type:z.string().min(1),
  reason:z.enum(["mission-missing","mission-lookup-failed"]),
}).strict();
const Report=z.object({
  checkedAt:z.iso.datetime(),
  mode:z.literal("read-only"),
  status:z.enum(["clear","blocked","unknown"]),
  inspectedJobs:z.number().int().min(0),
  activeMissionBoundJobs:z.number().int().min(0),
  referencedMissions:z.number().int().min(0),
  issues:z.array(Issue).max(MAX_LAB_JOB_SCAN),
  reason:z.enum(["no-orphans","orphan-active-job","mission-lookup-unavailable","inventory-too-large"]),
}).strict();

export type LabJobIntegrityDependencies={
  listJobs:()=>Promise<EvolutionJob[]>;
  hasMission:(missionId:string)=>Promise<boolean>;
};
const defaultDependencies:LabJobIntegrityDependencies={
  listJobs:()=>getServerProductionRuntime().jobs.list(),
  hasMission:async id=>Boolean(await getServerProductionRuntime().missions.get(id)),
};
const fail=()=>Object.assign(new Error("仅隔离 Lab 的管理员可读取 Job 关联审计。"),{code:"LAB_INTEGRITY_NOT_ISOLATED"});

/** Read-only audit: never mutates or cancels orphaned jobs. A failed or partial
 * inventory is not a clean pass, and unknown parent state is not "missing".
 */
export async function inspectLabJobIntegrity(
  deps:LabJobIntegrityDependencies=defaultDependencies,now=new Date(),
){
  if(process.env.EVOLUTION_EXPERIMENT_MODE!=="isolated"
    ||!inspectIsolatedLabRuntime(process.env).ready)throw fail();
  const jobs=await deps.listJobs();
  if(jobs.length>MAX_LAB_JOB_SCAN){
    return Report.parse({
      checkedAt:now.toISOString(),mode:"read-only",status:"unknown",
      inspectedJobs:jobs.length,activeMissionBoundJobs:0,referencedMissions:0,
      issues:[],reason:"inventory-too-large",
    });
  }
  const active=jobs.filter(job=>Boolean(job.missionId)&&Active.has(job.status));
  const missionChecks=new Map<string,boolean|"unknown">();
  const issues:Array<z.infer<typeof Issue>>=[];
  for(const job of active){
    const id=job.missionId!;
    if(!missionChecks.has(id)){
      try{missionChecks.set(id,await deps.hasMission(id));}
      catch{missionChecks.set(id,"unknown");}
    }
    const result=missionChecks.get(id);
    if(result===true)continue;
    issues.push({jobId:job.id,missionId:id,jobStatus:job.status as "queued"|"running"|"waiting",
      type:job.type,reason:result==="unknown"?"mission-lookup-failed":"mission-missing"});
  }
  const unknown=issues.some(issue=>issue.reason==="mission-lookup-failed");
  return Report.parse({
    checkedAt:now.toISOString(),mode:"read-only",
    status:unknown?"unknown":issues.length?"blocked":"clear",
    inspectedJobs:jobs.length,activeMissionBoundJobs:active.length,
    referencedMissions:missionChecks.size,
    issues,reason:unknown?"mission-lookup-unavailable":issues.length?"orphan-active-job":"no-orphans",
  });
}
