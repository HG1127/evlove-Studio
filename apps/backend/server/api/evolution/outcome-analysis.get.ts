import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {analyzeMissionOutcome} from "../../../src/services/outcome-analytics";
import {resolveOutcomeAnalysisCandidate} from "../../../src/services/outcome-ingestion";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const query=getQuery(event);
  const missionId=typeof query.missionId==="string"?query.missionId.trim():"";
  const candidateId=typeof query.candidateId==="string"&&query.candidateId.trim()?query.candidateId.trim():undefined;
  if(!missionId)throw createError({statusCode:400,statusMessage:"missionId is required"});
  const mission=await getServerProductionRuntime().missions.get(missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Outcome Mission not found"});
  let resolvedCandidateId:string;
  try{resolvedCandidateId=resolveOutcomeAnalysisCandidate(mission,candidateId);}
  catch(error){throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:String(error)});}
  return analyzeMissionOutcome({missionId,candidateId:resolvedCandidateId});
});
