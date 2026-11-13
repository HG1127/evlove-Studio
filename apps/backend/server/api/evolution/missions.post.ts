import {createError,defineEventHandler,readBody} from "nitro/h3";
import {EvolveProjectSchema} from "@evolution/contracts";
import {rubricTargetBindingIssues} from "@evolution/core";
import {createServerMissionEnvelope} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireServerDataPlaneAvailable} from "../../../src/services/data-plane-guard";
import {assertServerConfirmationAdmission} from "../../../src/services/server-confirmation-admission";
import {assertLabSyntheticInitialSource} from "../../../src/services/lab-html-original-custody";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.write");
  requireServerDataPlaneAvailable();
  const parsed=EvolveProjectSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Mission request",data:parsed.error.flatten()});
  // Reject ambiguous or dangling Artifact scopes before a Mission is persisted.
  // Otherwise static evidence would fail much later at Hidden Holdout/Gate F.
  const bindingIssues=rubricTargetBindingIssues(parsed.data.acceptanceRubric,parsed.data.sourceArtifacts);
  if(bindingIssues.length)throw createError({statusCode:422,statusMessage:"Mission 验收标准引用了无效的目标文件",data:{code:"MISSION_RUBRIC_TARGET_BINDING",issues:bindingIssues}});
  try{assertLabSyntheticInitialSource(parsed.data);}
  catch{throw createError({statusCode:422,statusMessage:"隔离合成 Mission 的源文件必须先冻结、登记后再绑定",data:{code:"LAB_SYNTHETIC_SOURCE_PREREGISTRATION_INVALID"}});}
  await assertServerConfirmationAdmission(parsed.data,"registration");
  return createServerMissionEnvelope(parsed.data);
});
