import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {z} from "zod";
import {analyzeMissionOutcome} from "../../../src/services/outcome-analytics";
import {resolveOutcomeAnalysisCandidate} from "../../../src/services/outcome-ingestion";
import {OutcomeSampleLimitExceededError} from "../../../src/services/outcome-sample-store";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

const OutcomeAnalysisQuerySchema=z.object({
  missionId:z.string().trim().min(1).max(200),
  candidateId:z.string().trim().min(1).max(200).optional(),
});

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const parsed=OutcomeAnalysisQuerySchema.safeParse(getQuery(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Outcome analysis query",data:parsed.error.flatten()});
  const {missionId,candidateId}=parsed.data;
  const mission=await getServerProductionRuntime().missions.get(missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Outcome Mission not found"});
  let resolvedCandidateId:string;
  try{resolvedCandidateId=resolveOutcomeAnalysisCandidate(mission,candidateId);}
  catch(error){throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:String(error)});}
  try{return await analyzeMissionOutcome({missionId,candidateId:resolvedCandidateId});}
  catch(error){
    if(error instanceof OutcomeSampleLimitExceededError){
      throw createError({statusCode:422,statusMessage:error.message});
    }
    throw error;
  }
});
