import { createHash } from "node:crypto";
import { confirmHtmlProtectionOperationalScope, operationalScopeTargetContract, goalReadiness, rubricValidation, rubricSuiteCoverage } from "@evolution/core";
import type { EvolveProject, EvolutionActor } from "@evolution/contracts";
import { requireReviewedHuman } from "./reviewed-holdout-identity";
import { readServerHtmlProtectionInputs, type ServerHtmlProtectionInputPorts } from "./server-html-protection-input";
export const operationalTargetSha256 = (project: EvolveProject) => createHash("sha256").update(operationalScopeTargetContract(project)).digest("hex");
/** Preview is read-only; confirmation still requires the exact revision, physical Original and human actor. */
export async function prepareServerHtmlProtectionOperationalConfirmation(args: {
  project: EvolveProject; actor: EvolutionActor; humanReviewNote: string; ports?: ServerHtmlProtectionInputPorts;
}) {
  requireReviewedHuman(args.actor);
  const actorSource = args.actor.source;
  if (actorSource !== "browser-session" && actorSource !== "trusted-header" && actorSource !== "internal-dev") throw Error("operational-scope-human-source-required");
  const project = structuredClone(args.project), goal = goalReadiness(project), rubric = rubricValidation(project.acceptanceRubric),
    coverage = rubricSuiteCoverage(project.acceptanceRubric, project.evalSuite, project.hiddenEvalSuite);
  if (!goal.ready || !rubric.ready || !coverage.ready) throw Error("operational-scope-normal-target-ready-requirements-missing");
  const testCase = [...project.evalSuite,...project.hiddenEvalSuite].find(test=>test.criterionIds.some(id=>project.acceptanceRubric.some(c=>c.id===id&&c.protectedConstraint&&c.hardGate)));
  const criterionId = testCase?.criterionIds.find(id=>project.acceptanceRubric.some(c=>c.id===id&&c.protectedConstraint&&c.hardGate));
  if (!testCase || !criterionId) throw Error("operational-scope-protected-paper-missing");
  const physical = await readServerHtmlProtectionInputs({project,testCase,criterionId,ports:args.ports});
  const confirmedAt = project.gates.find(gate=>gate.id==="target-ready")?.approvedAt;
  if (!confirmedAt) throw Error("operational-scope-normal-human-target-ready-required");
  const next = confirmHtmlProtectionOperationalScope(project, { original: physical.binding.original, confirmedAt,
    humanReviewNote:args.humanReviewNote, confirmedBy:{actorId:args.actor.id,actorSource} });
  return { next, targetContractSha256:operationalTargetSha256(project), original:physical.binding.original };
}
