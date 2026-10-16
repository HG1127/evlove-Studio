import {createError,defineEventHandler,getQuery,setHeader} from "nitro/h3";
import {z} from "zod";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {readServerHtmlProtectionAcceptedFile,readServerHtmlProtectionAcceptedPackage} from "../../../src/services/server-html-protection-accepted-authority";
const Request=z.object({missionId:z.string().min(1).max(512),candidateId:z.string().min(1).max(512),sourceArtifactId:z.string().min(1).max(512).optional()}).strict();
export default defineEventHandler(async event=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const input=Request.safeParse(getQuery(event));if(!input.success)throw createError({statusCode:400,statusMessage:"Invalid accepted file identity"});
  const project=await getServerProductionRuntime().missions.get(input.data.missionId);if(!project)throw createError({statusCode:404,statusMessage:"Mission not found"});
  if(!input.data.sourceArtifactId){setHeader(event,"Cache-Control","private, no-store");try{return await readServerHtmlProtectionAcceptedPackage({project,candidateId:input.data.candidateId});}catch{throw createError({statusCode:409,statusMessage:"Current accepted package could not be independently revalidated"});}}
  let result;try{result=await readServerHtmlProtectionAcceptedFile({project,candidateId:input.data.candidateId,sourceArtifactId:input.data.sourceArtifactId});}
  catch{throw createError({statusCode:409,statusMessage:"Current acceptance or exact frozen file cannot be independently revalidated"});}
  setHeader(event,"Content-Type",result.identity.mimeType);setHeader(event,"Content-Length",String(result.identity.size));setHeader(event,"Cache-Control","private, no-store");
  setHeader(event,"Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(result.identity.name)}`);
  setHeader(event,"X-Evolution-File-SHA256",result.identity.sha256);setHeader(event,"X-Evolution-Acceptance-Id",encodeURIComponent(result.identity.acceptanceId));
  setHeader(event,"X-Evolution-Validation-Id",encodeURIComponent(result.identity.validationId));
  setHeader(event,"X-Evolution-Accepted-Identity",encodeURIComponent(JSON.stringify(result.identity)));
  // Expose receipt facts if the existing deployment CORS policy already permits this origin; this grants no new origin or credential policy.
  setHeader(event,"Access-Control-Expose-Headers","X-Evolution-Accepted-Identity, X-Evolution-File-SHA256, X-Evolution-Acceptance-Id, X-Evolution-Validation-Id");
  // The private helper completed every byte await and its final actor/TTL/metadata guards.
  return result.bytes;
});
