import {createError,defineEventHandler,readBody} from "nitro/h3";
import {EvolveProjectSchema} from "@evolution/contracts";
import {rubricTargetBindingIssues} from "@evolution/core";
import {createServerMissionEnvelope} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireServerDataPlaneAvailable} from "../../../src/services/data-plane-guard";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.write");
  requireServerDataPlaneAvailable();
  const parsed=EvolveProjectSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Mission request",data:parsed.error.flatten()});
  // Reject ambiguous or dangling Artifact scopes before a Mission is persisted.
  // Otherwise static evidence would fail much later at Hidden Holdout/Gate F.
  const bindingIssues=rubricTargetBindingIssues(parsed.data.acceptanceRubric,parsed.data.sourceArtifacts);
  if(bindingIssues.length)throw createError({statusCode:422,statusMessage:"Mission 验收标准引用了无效的目标文件",data:{code:"MISSION_RUBRIC_TARGET_BINDING",issues:bindingIssues}});
  return createServerMissionEnvelope(parsed.data);
});
