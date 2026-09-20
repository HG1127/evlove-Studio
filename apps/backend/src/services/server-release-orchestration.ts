import type {EvolveProject} from "@evolution/contracts";
import {runServerReleaseOrchestration} from "@evolution/harness";
import {executeVercelReleaseAction} from "./vercel-release";

export async function runServerMissionRelease(project:EvolveProject){
  return runServerReleaseOrchestration(project,{
    execute:async(args)=>executeVercelReleaseAction(args),
  });
}
