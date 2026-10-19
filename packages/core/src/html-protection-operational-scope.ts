import { HtmlProtectionArtifactIdentitySchema, HtmlProtectionOperationalScopeSchema,
  type EvolveProject, type HtmlProtectionOperationalScope, type HtmlProtectionObligation,
  type HtmlProtectionProofBinding } from "@evolution/contracts";


export const HTML_PROTECTION_OPERATIONAL_RUNTIME_ID = "plan:document:confirmed-operational-runtime-v2";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value);
}
/** Full Target Ready input, excluding execution bookkeeping and the confirmation itself. */
export function operationalScopeTargetContract(project: EvolveProject): string {
  return canonical({ version: "html-protection-operational-target-v2", missionId: project.id,
    objectType: project.objectType, metrics: project.metrics, versionId: project.version, goal: project.goal, evolutionCommand: project.evolutionCommand,
    protectedItems: project.protectedItems, editableItems: project.editableItems,
    rubric: project.acceptanceRubric, rubricVersion: project.acceptanceRubricState.version,
    visible: project.evalSuite, hidden: project.hiddenEvalSuite, sourceArtifacts: project.sourceArtifacts,
    inputClarifications: project.inputClarifications, targetConnection: project.targetConnection });
}
function target(project: EvolveProject, original: HtmlProtectionProofBinding["original"]) {
  const targets = project.sourceArtifacts.filter(item => item.role === "target");
  if (targets.length !== 1 || targets[0]!.id !== original.sourceArtifactId
    || !/^(html|htm)$/i.test(targets[0]!.extension)) throw Error("operational-scope-requires-complete-single-original-html-target");
}
/** Called only after normal human Target Ready confirmation and independent physical Original readback. */
export function confirmHtmlProtectionOperationalScope(project: EvolveProject, args: {
  original: HtmlProtectionProofBinding["original"]; confirmedAt: string; humanReviewNote: string; confirmedBy: HtmlProtectionOperationalScope["confirmedBy"];
}): EvolveProject {
  if (project.htmlProtectionOperationalScope || project.stage !== "target" || project.candidates.length
    || project.baselineRun.status !== "idle" || project.baselineRun.runs.length || project.baselineRun.result
    || project.campaign.rootBaseline || project.roundHistory.length || project.artifactAcceptance.attempts
    || project.validationRun.runs.length || project.validationRun.baselineRuns.length || project.experimentRun.candidateResults.length
    || project.experimentRun.status !== "idle" || project.validationRun.status !== "idle"
    || project.campaign.serverControlOwner || project.evolutionArchive.length || project.versions.length) {
    throw Error("operational-scope-requires-fresh-unexecuted-mission");
  }
  target(project, args.original);
  const scope = HtmlProtectionOperationalScopeSchema.parse({
    schemaVersion: "html-protection-operational-scope-v2", policy: "original-finite-operational-v2",
    original: HtmlProtectionArtifactIdentitySchema.parse(args.original), content: "existing-card-body-text-only",
    runtime: "all-original-registered-controls-and-states", visual: "all-original-derived-viewports-and-tiles",
    outsideScope: "unverified", universalProtectionProved: false, confirmedAt: args.confirmedAt,
    confirmedBy: args.confirmedBy, rubricVersion: project.acceptanceRubricState.version, humanReviewNote: args.humanReviewNote,
    targetContract: operationalScopeTargetContract(project),
  });
  const confirmed = { ...project, htmlProtectionOperationalScope: scope };
  confirmedHtmlProtectionOperationalScope(confirmed, args.original);
  return confirmed;
}
/** Missing field keeps the legacy policy. Present but stale/foreign fields fail closed. */
export function confirmedHtmlProtectionOperationalScope(project: EvolveProject,
  original: HtmlProtectionProofBinding["original"]): HtmlProtectionOperationalScope | undefined {
  if (project.htmlProtectionOperationalScope === undefined) return undefined;
  const scope = HtmlProtectionOperationalScopeSchema.parse(project.htmlProtectionOperationalScope);
  target(project, original);
  const gate = project.gates.filter(item => item.id === "target-ready");
  if (canonical(scope.original) !== canonical(HtmlProtectionArtifactIdentitySchema.parse(original))
    || gate.length !== 1 || gate[0]!.status !== "approved" || gate[0]!.approvedAt !== scope.confirmedAt
    || project.acceptanceRubricState.status !== "ready" || project.acceptanceRubricState.confirmedAt !== scope.confirmedAt
    || project.acceptanceRubricState.version !== scope.rubricVersion
    || operationalScopeTargetContract(project) !== scope.targetContract) throw Error("operational-scope-target-ready-or-original-drift");
  return scope;
}
/** Separate measured-scope decision. The complete legacy proof and every unknown receipt remain unchanged. */
export function assessHtmlProtectionOperationalAcceptance(args: {
  scope: HtmlProtectionOperationalScope;
  validation: { valid: boolean; verifiedObligationIds: readonly string[]; failedObligationIds: readonly string[]; missingObligationIds: readonly string[] };
  requiredObligations: readonly Pick<HtmlProtectionObligation, "id" | "kind">[];
}) {
  const scope = HtmlProtectionOperationalScopeSchema.parse(args.scope), required = args.requiredObligations;
  const ids = required.map(item => item.id), verified = new Set(args.validation.verifiedObligationIds);
  const measured = required.filter(item => item.kind !== "unknown-runtime"), outside = required.filter(item => item.kind === "unknown-runtime");
  const passed = args.validation.valid && ids.length === new Set(ids).size && measured.length > 0
    && measured.some(item => item.id === HTML_PROTECTION_OPERATIONAL_RUNTIME_ID && item.kind === "browser-behavior")
    && !args.validation.failedObligationIds.length && !args.validation.missingObligationIds.length
    && measured.every(item => verified.has(item.id));
  return { policy: scope.policy, passed, measuredObligationIds: measured.map(item => item.id),
    unverifiedOutsideScopeIds: outside.map(item => item.id), universalProtectionProved: false as const,
    limitations: ["Acceptance is limited to complete Original source, confirmed body refinements, every registered native control/state and every registered viewport/tile.",
      "Unenumerated future event/timer sequences, continuous widths and all other behavior outside the confirmed finite scope remain UNVERIFIED."] };
}
