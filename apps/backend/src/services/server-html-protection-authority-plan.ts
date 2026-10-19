import { createHash } from "node:crypto";
import { CandidateSchema, HtmlProtectionSemanticFrozenRequirementsSchema, type Candidate, type EvolveProject, type HtmlProtectionProofBinding, type TestCase } from "@evolution/contracts";
import { confirmedHtmlProtectionOperationalScope } from "@evolution/core";
import { prepareServerHtmlProtectionCollectionPlan } from "./server-html-protection-collection-plan";
import { htmlProtectionCanonicalJson } from "./server-html-protection-authority-attestation";
export function prepareServerHtmlProtectionSemanticFrozenRequirements(args: { project: EvolveProject; testCase: TestCase; binding: HtmlProtectionProofBinding }) {
  const { project, testCase, binding } = args;
  const operationalScope = confirmedHtmlProtectionOperationalScope(project, binding.original);
  const frozen = HtmlProtectionSemanticFrozenRequirementsSchema.parse({ schemaVersion: "html-protection-semantic-frozen-requirements-v1",
    missionId: project.id, sourceArtifactId: binding.original.sourceArtifactId, criterionId: binding.criterionId, paperSha256: binding.paperSha256,
    testCase, paper: testCase.hidden ? project.hiddenEvalSuite : project.evalSuite, rubric: project.acceptanceRubric,
    ...(operationalScope ? { operationalScope } : {}),
    goal: project.goal, evolutionCommand: project.evolutionCommand, protectedItems: project.protectedItems, editableItems: project.editableItems });
  const sha = (value: unknown) => createHash("sha256").update(htmlProtectionCanonicalJson(value), "utf8").digest("hex");
  if (binding.missionId !== frozen.missionId || binding.testCaseId !== frozen.testCase.id
    || frozen.paper.filter(item => item.id === testCase.id && htmlProtectionCanonicalJson(item) === htmlProtectionCanonicalJson(frozen.testCase)).length !== 1
    || sha({ version: "html-protection-paper-v1", paper: frozen.paper, rubric: frozen.rubric, protectedItems: frozen.protectedItems, ...(operationalScope ? { operationalScope } : {}) }) !== binding.paperSha256) {
    throw Error("html-protection-semantic-frozen-paper-binding-invalid");
  }
  return { semanticRequirements: frozen, semanticRequirementsSha256: sha(frozen) };
}
/** Derive the pre-promotion Current from stored domain lineage, independently of any attestation/proof. */
export function serverHtmlProtectionHistoricalCurrent(project: EvolveProject, acceptedCandidateId: string): Candidate | undefined {
  const champion = project.searchChampion;
  if (champion?.candidate?.id !== acceptedCandidateId) return undefined;
  const parent = champion.parentVersionId;
  if (!parent) throw Error("html-protection-hidden-current-lineage-unavailable");
  if (parent === project.version) return undefined;
  const matched = /^S([1-9][0-9]*)$/.exec(parent);
  if (!matched || Number(matched[1]) >= champion.round) throw Error("html-protection-hidden-current-lineage-invalid");
  const previous = project.evolutionArchive.filter(entry => entry.kind === "champion" && entry.round === Number(matched[1]));
  if (previous.length !== 1 || previous[0]!.candidate.id === acceptedCandidateId) throw Error("html-protection-hidden-current-lineage-ambiguous");
  return CandidateSchema.parse(structuredClone(previous[0]!.candidate));
}
/** Existing full physical reader is reused; a Current lineage subject is not relabeled as a Candidate comparison. */
export async function prepareServerHtmlProtectionAuthorityPlan(args: Parameters<typeof prepareServerHtmlProtectionCollectionPlan>[0] & {
  acceptedCandidateId?: string;
}) {
  if (args.candidate || !args.acceptedCandidateId || args.project.searchChampion?.candidate?.id !== args.acceptedCandidateId) {
    const prepared = await prepareServerHtmlProtectionCollectionPlan(args);
    return { ...prepared, ...prepareServerHtmlProtectionSemanticFrozenRequirements({ project: args.project, testCase: args.testCase, binding: prepared.binding }), execution: { ...args.execution } };
  }
  const historical = serverHtmlProtectionHistoricalCurrent(args.project, args.acceptedCandidateId);
  if (historical && args.project.candidates.filter(item => item.id === historical.id).length > 1) throw Error("html-protection-hidden-current-candidate-ambiguous");
  const project: EvolveProject = { ...args.project, searchChampion: undefined,
    candidates: historical ? args.project.candidates.some(item => item.id === historical.id)
      ? args.project.candidates.map(item => item.id === historical.id ? historical : item)
      : [...args.project.candidates, historical] : args.project.candidates };
  const prepared = await prepareServerHtmlProtectionCollectionPlan({ ...args, project, candidate: historical });
  const binding = { ...prepared.binding, subject: { kind: "current" as const, versionId: historical?.id ?? project.version } };
  return { ...prepared, binding, ...prepareServerHtmlProtectionSemanticFrozenRequirements({ project: args.project, testCase: args.testCase, binding }), execution: { ...args.execution },
    bootRequests: prepared.bootRequests.map(request => ({ ...request, binding })),
    searchRequests: prepared.searchRequests.map(request => ({ ...request, binding })),
  };
}
