import type {EvolveProject} from "@evolution/contracts";
import {runServerReleaseOrchestration} from "@evolution/harness";
import {getActiveReleaseApprovalGrant} from "./release-approval-store";
import {executeVercelReleaseAction} from "./vercel-release";

export async function runServerMissionRelease(project:EvolveProject){
  return runServerReleaseOrchestration(project,{
    authorize:async({candidateId})=>{
      const grant=await getActiveReleaseApprovalGrant({missionId:project.id,candidateId});
      return grant
        ?{ok:true}
        :{ok:false,reason:"当前 Candidate 没有未过期且未撤销的 durable Release Approval grant。"};
    },
    execute:async(args)=>executeVercelReleaseAction({
      ...args,
      expectedGitCommitSha:project.release.sourceGitCommitSha,
    }),
  });
}
