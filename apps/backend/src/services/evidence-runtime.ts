import {getServerArtifactStore} from "./artifact-runtime";
import {appendEvidenceLedger,listEvidenceLedger,verifyEvidenceLedger} from "./evidence-ledger";

export async function registerArtifactEvidence(input:{
  missionId:string;
  artifactId:string;
  jobId?:string;
  checkpointId?:string;
  kind?:string;
  payload?:Record<string,unknown>;
}){
  const validationId=typeof input.payload?.validationId==="string"?input.payload.validationId:undefined;
  const kind=input.kind??"artifact";
  return appendEvidenceLedger({
    id:validationId?`validation-evidence:${validationId}`:undefined,
    missionId:input.missionId,
    kind,
    source:"artifact-runtime",
    actor:"backend",
    eventId:validationId?`validation-result:${validationId}`:undefined,
    jobId:input.jobId,
    checkpointId:input.checkpointId,
    decision:validationId?"validation-recorded":"artifact-registered",
    payload:{
      artifactId:input.artifactId,
      ...(input.payload??{}),
    },
    artifactRefs:[input.artifactId],
  });
}

export async function getMissionEvidence(missionId:string){
  return listEvidenceLedger(missionId);
}

export async function verifyMissionEvidence(missionId:string){
  return verifyEvidenceLedger(missionId);
}

export async function archiveArtifactReference(id:string,content:string){
  await getServerArtifactStore().put(id,new Blob([content],{type:"text/plain"}));
  return {id,size:content.length};
}
