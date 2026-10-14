import { createHash } from "node:crypto";
import { z } from "zod";
import { EvolveProjectSchema, type EvolveProject, type EvolutionWorkflowRunInput } from "@evolution/contracts";
import { LIVE_TARGET_OBSERVATION_MAX_AGE_MS, ORIGINAL_HTML_BASELINE_DIAGNOSTIC_POLICY,
  OriginalHtmlBaselineDiagnosticBindingSchema, originalHtmlBaselineDiagnosticCase, campaignPreflightStopReason, goalReadiness } from "@evolution/core";
import type { ServerBaselineOutcome } from "@evolution/harness";
import { getServerMissionEnvelope } from "./production-runtime";
import { readServerOriginalHtmlBaselineDiagnosticBinding } from "./server-original-html-baseline-diagnostic";

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
/** Internal Workflow result/argument only. Schema validation alone never grants qualification. */
const ContinuationSchema = z.object({
  schemaVersion: z.literal("server-diagnostic-continuation-v1"),
  missionId: z.string().min(1), controlJobId: z.string().min(1), runId: z.string().min(1), operationKey: z.string().min(1),
  round: z.literal(1), baselineId: z.string().min(1), baselineSha256: digestSchema,
  inputSha256: digestSchema, generationSha256: digestSchema, scoringRouteFingerprint: z.string().min(1),
  policyVersion: z.literal(ORIGINAL_HTML_BASELINE_DIAGNOSTIC_POLICY),
  observedAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
  physical: OriginalHtmlBaselineDiagnosticBindingSchema,
}).strict();
export type ServerDiagnosticContinuation = z.infer<typeof ContinuationSchema>;
export type ServerControlExecution = { control: "continue" | "stop"; result?: import("@evolution/contracts").EvolutionWorkflowResult;
  sleepMs?: number; diagnosticContinuation?: ServerDiagnosticContinuation };

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
}
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(ordered(JSON.parse(JSON.stringify(value))))).digest("hex");
const generation = (project: EvolveProject) => sha(EvolveProjectSchema.parse(project));
function staticInput(project: EvolveProject) {
  return sha({ id: project.id, version: project.version, currentVersionId: project.currentVersionId, objectType: project.objectType,
    goal: project.goal, command: project.evolutionCommand, sources: project.sourceArtifacts, target: project.targetConnection,
    protected: project.protectedItems, editable: project.editableItems, clarifications: project.inputClarifications,
    understanding: project.inputUnderstanding, metrics: project.metrics, rubric: project.acceptanceRubric,
    rubricState: project.acceptanceRubricState, visible: project.evalSuite, hidden: project.hiddenEvalSuite,
    profile: project.aiProfile, executionPolicy: project.experimentPolicy, parent: project.searchChampion,
    scoringInput: project.campaign.scoringInputFingerprint, scoringRoute: project.campaign.scoringRouteFingerprint,
    rootBaseline: project.campaign.rootBaseline });
}
function ownerMatches(project: EvolveProject, input: EvolutionWorkflowRunInput, context: ServerDiagnosticContinuation) {
  const owner = project.campaign.serverControlOwner;
  return owner?.phase === "bound" && owner.controlJobId === input.controlJobId && owner.controlJobId === context.controlJobId
    && owner.runId === context.runId && owner.operationKey === context.operationKey && input.controlOwnerKey === context.operationKey
    && project.id === input.missionId && project.id === context.missionId;
}
function observationFresh(context: ServerDiagnosticContinuation, nowMs: number) {
  const observed = Date.parse(context.observedAt);
  return Number.isFinite(nowMs) && nowMs >= observed && nowMs - observed < LIVE_TARGET_OBSERVATION_MAX_AGE_MS;
}
function fixedBindingsMatch(context: ServerDiagnosticContinuation, project: EvolveProject) {
  return project.campaign.currentRound === context.round - 1 && !project.searchChampion
    && project.campaign.checkpoint?.round === context.round && project.baselineRun.status === "completed"
    && project.baselineRun.id === context.baselineId && project.baselineRun.completedAt === context.observedAt
    && sha(project.baselineRun) === context.baselineSha256 && staticInput(project) === context.inputSha256;
}

/** Called solely on THIS actual runServerMissionBaseline outcome, never on saved scores/events. */
export function createServerDiagnosticContinuation(outcome: ServerBaselineOutcome, input: EvolutionWorkflowRunInput,
  scoringRouteFingerprint: string | undefined): ServerDiagnosticContinuation | undefined {
  const { project, diagnosticEligibility } = outcome;
  const owner = project.campaign.serverControlOwner;
  if (!scoringRouteFingerprint || !outcome.ready || !diagnosticEligibility || diagnosticEligibility.policyVersion !== ORIGINAL_HTML_BASELINE_DIAGNOSTIC_POLICY
    || !originalHtmlBaselineDiagnosticCase(project) || project.campaign.status !== "running" || !project.baselineRun.completedAt
    || owner?.phase !== "bound" || !owner.runId || owner.controlJobId !== input.controlJobId
    || owner.operationKey !== input.controlOwnerKey || project.id !== input.missionId) return undefined;
  const context = ContinuationSchema.parse({ schemaVersion: "server-diagnostic-continuation-v1", missionId: project.id,
    controlJobId: owner.controlJobId, runId: owner.runId, operationKey: owner.operationKey, round: 1,
    baselineId: project.baselineRun.id, baselineSha256: sha(project.baselineRun), inputSha256: staticInput(project),
    generationSha256: generation(project), scoringRouteFingerprint, observedAt: project.baselineRun.completedAt,
    policyVersion: diagnosticEligibility.policyVersion, physical: { schemaVersion: diagnosticEligibility.schemaVersion, binding: diagnosticEligibility.binding } });
  return fixedBindingsMatch(context, project) ? context : undefined;
}

/** Rebind only after an owned phase output; the original observation deadline never moves. */
export function renewServerDiagnosticContinuation(context: ServerDiagnosticContinuation | undefined,
  project: EvolveProject): ServerDiagnosticContinuation | undefined {
  if (!context || project.campaign.status !== "running" || !fixedBindingsMatch(context, project)) return undefined;
  const owner = project.campaign.serverControlOwner;
  if (owner?.phase !== "bound" || owner.controlJobId !== context.controlJobId || owner.runId !== context.runId
    || owner.operationKey !== context.operationKey) return undefined;
  return { ...context, generationSha256: generation(project) };
}

export function serverDiagnosticContinuationGenerationMatches(project:EvolveProject,context:ServerDiagnosticContinuation){
  return generation(project)===context.generationSha256;
}

/** Synchronous recheck immediately after the last owner/route/storage await and before phase dispatch. */
export function serverDiagnosticContinuationBoundaryReason(project: EvolveProject, input: EvolutionWorkflowRunInput,
  context: ServerDiagnosticContinuation, route: string | undefined, nowMs=Date.now()): string | undefined {
  if (!ownerMatches(project,input,context)) return "control-owner-changed";
  if (!observationFresh(context,nowMs)) return "observation-expired";
  if (route!==context.scoringRouteFingerprint) return "scoring-route-changed";
  if (project.campaign.status!=="running" || campaignPreflightStopReason(project) || !goalReadiness(project).ready
    || project.gates.find(gate=>gate.id==="target-ready")?.status!=="approved"
    || project.attentionRequests?.some(request=>request.status==="pending" && request.blocking)) return "policy-boundary";
  if (!fixedBindingsMatch(context,project) || generation(project)!==context.generationSha256) return "measurement-generation-changed";
}
type ReadBinding = typeof readServerOriginalHtmlBaselineDiagnosticBinding;
/** Every SDK iteration rechecks the unchanged complete generation and physical Current/Original file. */
export async function validateServerDiagnosticContinuation(project: EvolveProject, input: EvolutionWorkflowRunInput, raw: unknown,
  scoringRouteFingerprint: string | undefined, ports?: { nowMs?: () => number; readBinding?: ReadBinding;
    readCurrent?: () => Promise<EvolveProject | undefined>; readRoute?: () => Promise<string | undefined> }):
  Promise<{ ready: true; continuation: ServerDiagnosticContinuation } | { ready: false; reason: string }> {
  const parsed = ContinuationSchema.safeParse(raw), now = ports?.nowMs ?? Date.now;
  const denied = (reason: string) => ({ ready: false as const, reason });
  if (!parsed.success) return denied("invalid-internal-context");
  const context = parsed.data;
  const initialBoundary=serverDiagnosticContinuationBoundaryReason(project,input,context,scoringRouteFingerprint,now());
  if(initialBoundary)return denied(initialBoundary);
  const testCase = originalHtmlBaselineDiagnosticCase(project);
  if (!testCase) return denied("original-scope-changed");
  try {
    const physical = OriginalHtmlBaselineDiagnosticBindingSchema.parse(await (ports?.readBinding ?? readServerOriginalHtmlBaselineDiagnosticBinding)({
      project: structuredClone(project), testCase: structuredClone(testCase),
    }));
    if (sha(physical) !== sha(context.physical)) return denied("physical-binding-changed");
    // Independent read avoids refreshing the writer's original CAS revision across physical I/O.
    const current = ports?.readCurrent ? await ports.readCurrent() : (await getServerMissionEnvelope(project.id))?.payload;
    if (!current || !ownerMatches(current, input, context) || generation(current) !== context.generationSha256
      || generation(project) !== context.generationSha256) return denied("measurement-generation-changed");
    if (ports?.readRoute && await ports.readRoute() !== context.scoringRouteFingerprint) return denied("scoring-route-changed");
    const finalBoundary=serverDiagnosticContinuationBoundaryReason(project,input,context,scoringRouteFingerprint,now());
    if(finalBoundary)return denied(finalBoundary);
    return { ready: true, continuation: context };
  } catch { return denied("physical-or-current-read-unavailable"); }
}
