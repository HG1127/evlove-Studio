import { createHash } from "node:crypto";
import { EvolutionJobSchema, EvolveProjectSchema, type EvolveProject, type EvolutionJob } from "@evolution/contracts";
import { htmlProtectionAuthorityContract, htmlProtectionAuthoritySubjectContract, campaignScoringInputFingerprint } from "@evolution/core";
import type { HtmlProtectionProofBinding } from "@evolution/contracts";
import { serverControlJobRunId, serverBaselineFingerprint } from "@evolution/harness";
import { getServerMissionEnvelope, getServerProductionRuntime } from "./production-runtime";
import { readWorkflowRunMetadata } from "./workflow-run-metadata";
import { readCurrentServerAiScoringSelection, serverAiPublicScoringRouteFingerprint, serverAiScoringRouteFingerprint } from "./ai-gateway";
import { readCurrentStoredServerAiPublicSelection } from "./server-ai-connection";
import { ServerAiPublicSelectionSchema, serverAiPublicSelectionIdentity, serverAiPublicSelectionRoute, type ServerAiPublicSelectionResult } from "./server-ai-public-selection";
import { htmlProtectionCanonicalJson, readAuthenticatedServerHtmlProtectionSelection, type AuthenticatedServerHtmlProtectionSelection } from "./server-html-protection-authority-attestation";
export type ServerHtmlProtectionExecutionIdentity = { executionId: string; jobId: string; generation: number };
export type ServerHtmlProtectionOwnerPorts = {
  readMission(id: string): Promise<EvolveProject | undefined>;
  readJob(id: string): Promise<EvolutionJob | undefined>;
  readRun(id: string): Promise<{ exists: boolean; status?: string }>;
  readRoute(): Promise<string | undefined>;
  readSelection?: () => Promise<ServerAiPublicSelectionResult>;
  readStoredSelection?: typeof readCurrentStoredServerAiPublicSelection;
};
const defaultPorts = (): ServerHtmlProtectionOwnerPorts => ({
  readMission: async id => (await getServerMissionEnvelope(id))?.payload,
  readJob: id => getServerProductionRuntime().jobs.get(id),
  readRun: readWorkflowRunMetadata, readRoute: serverAiScoringRouteFingerprint,
  readSelection: readCurrentServerAiScoringSelection, readStoredSelection: readCurrentStoredServerAiPublicSelection,
});
async function readOwnerRoute(ports:ServerHtmlProtectionOwnerPorts,provenance:AuthenticatedServerHtmlProtectionSelection|undefined,contextOnly:boolean){
  if(contextOnly)return {route:"context-only",selection:undefined,selectionIdentitySha256:undefined};
  const expected=provenance?readAuthenticatedServerHtmlProtectionSelection(provenance):undefined;
  const result=expected?await (ports.readStoredSelection??readCurrentStoredServerAiPublicSelection)(expected):await ports.readSelection?.();
  // Legacy injected route-only ports can exercise owner guards, but collectors cannot issue whole authority without a complete selection.
  if(!result){if(expected)throw Error("html-protection-signed-selection-current-read-unavailable");return {route:await ports.readRoute(),selection:undefined,selectionIdentitySha256:undefined};}
  if(result.availability!=="available")throw Error("html-protection-current-selection-unavailable:"+result.reason);
  const selection=ServerAiPublicSelectionSchema.parse(result.selection),identity=serverAiPublicSelectionIdentity(selection);
  if(result.selectionIdentitySha256!==identity||expected&&htmlProtectionCanonicalJson(expected)!==htmlProtectionCanonicalJson(selection))throw Error("html-protection-current-selection-identity-drift");
  return {route:serverAiPublicScoringRouteFingerprint(serverAiPublicSelectionRoute(selection)),selection,selectionIdentitySha256:identity};
}
export const serverHtmlProtectionInputSha256 = (project: EvolveProject) =>
  createHash("sha256").update(htmlProtectionAuthorityContract(project), "utf8").digest("hex");
export function serverHtmlProtectionBoundInputSha256(project: EvolveProject, binding: HtmlProtectionProofBinding) {
  const subject = htmlProtectionAuthoritySubjectContract(project, binding);
  if (!subject) throw Error("html-protection-physical-subject-unavailable");
  return createHash("sha256").update(htmlProtectionCanonicalJson({ input: htmlProtectionAuthorityContract(project), subject })).digest("hex");
}
type NormalBaselineView = { allocatedInput: string; storedInput: string; allocatedContext: string; storedContext: string };
const normalBaselineViews = new WeakMap<object, NormalBaselineView>();
function matchesIndependentInput(current: EvolveProject, caller: EvolveProject, input: string) {
  const view = normalBaselineViews.get(caller), actual = serverHtmlProtectionInputSha256(current);
  if (!view) return actual === input;
  if (input !== view.allocatedInput || serverHtmlProtectionOwnerContext(caller) !== view.allocatedContext) return false;
  return actual === view.storedInput && serverHtmlProtectionOwnerContext(current) === view.storedContext
    || actual === view.allocatedInput && serverHtmlProtectionOwnerContext(current) === view.allocatedContext;
}
/** Only the normal internal Baseline allocation may bridge stored previous epoch to its new immutable execution view. */
export async function prepareServerHtmlProtectionNormalBaselineView(args: { inputProject: EvolveProject; allocatedProject: EvolveProject }, supplied?: ServerHtmlProtectionOwnerPorts) {
  const inputProject=EvolveProjectSchema.parse(structuredClone(args.inputProject)),allocated=EvolveProjectSchema.parse(structuredClone(args.allocatedProject)),ports=supplied??defaultPorts();
  const execution=await readServerHtmlProtectionCollectionOwner(inputProject,ports),before=await assertServerHtmlProtectionOwner({project:inputProject,execution,active:true},ports);
  if(before.subjectContextSha256!==before.missionContextSha256)throw Error("html-protection-baseline-actual-subject-context-drift");
  const startedAt=allocated.baselineRun.startedAt, timestamp=Date.parse(startedAt??"");
  if(!Number.isFinite(timestamp)||timestamp<=0||timestamp>Date.now()||timestamp<Date.parse(inputProject.campaign.serverControlOwner!.requestedAt)||allocated.baselineRun.id!==`baseline-server-${timestamp}`)throw Error("html-protection-baseline-normal-allocation-invalid");
  const expected={...inputProject,baselineRun:{...inputProject.baselineRun,id:`baseline-server-${timestamp}`,status:"running" as const,startedAt,completedAt:undefined,totalCases:inputProject.evalSuite.length,runs:[],result:undefined,
    measurementFingerprint:serverBaselineFingerprint(inputProject,before.scoringRouteFingerprint)},stage:"baseline" as const,updatedAt:startedAt!};
  if(htmlProtectionCanonicalJson(expected)!==htmlProtectionCanonicalJson(allocated))throw Error("html-protection-baseline-allocation-input-drift");
  if(inputProject.campaign.currentRound>0&&inputProject.campaign.scoringRouteFingerprint!==before.scoringRouteFingerprint)throw Error("html-protection-baseline-existing-selected-route-drift");
  const view:EvolveProject={...allocated,campaign:{...allocated.campaign,...(allocated.campaign.currentRound===0?{scoringInputFingerprint:campaignScoringInputFingerprint(inputProject),scoringRouteFingerprint:before.scoringRouteFingerprint}:{})}};
  const stored=await ports.readMission(inputProject.id);
  if(!stored||serverHtmlProtectionInputSha256(stored)!==serverHtmlProtectionInputSha256(inputProject)||createHash("sha256").update(serverHtmlProtectionOwnerContext(stored)).digest("hex")!==before.missionContextSha256)throw Error("html-protection-baseline-actual-stored-epoch-drift");
  const after=await assertServerHtmlProtectionOwner({project:inputProject,execution,active:true,scoringRouteFingerprint:before.scoringRouteFingerprint,selectionIdentitySha256:before.selectionIdentitySha256},ports);
  if(after.subjectContextSha256!==before.subjectContextSha256||after.missionContextSha256!==before.missionContextSha256)throw Error("html-protection-baseline-owner-changed-during-allocation");
  normalBaselineViews.set(view,{allocatedInput:serverHtmlProtectionInputSha256(view),storedInput:serverHtmlProtectionInputSha256(stored),allocatedContext:serverHtmlProtectionOwnerContext(view),storedContext:serverHtmlProtectionOwnerContext(stored)});
  return view;
}
function matchingJob(project: EvolveProject, job: EvolutionJob | undefined, execution: ServerHtmlProtectionExecutionIdentity, active: boolean) {
  const parsed = EvolutionJobSchema.safeParse(job);
  return parsed.success && parsed.data.id === execution.jobId && parsed.data.missionId === project.id
    && parsed.data.type === "campaign" && parsed.data.generation === execution.generation
    && parsed.data.idempotencyKey.startsWith(`workflow-control:${project.id}:`)
    && parsed.data.idempotencyKey === project.campaign.serverControlOwner?.operationKey
    && serverControlJobRunId(parsed.data, project) === execution.executionId
    && (active ? parsed.data.status === "running" : ["running", "waiting", "completed"].includes(parsed.data.status));
}
/** Capture all mutable subjects and the active stop/authorization boundary separately from reusable input. */
export function serverHtmlProtectionOwnerContext(project: EvolveProject): string {
  return htmlProtectionCanonicalJson({ round: project.campaign.currentRound, status: project.campaign.status,
    owner: project.campaign.serverControlOwner, scoringInput: project.campaign.scoringInputFingerprint,
    scoringRoute: project.campaign.scoringRouteFingerprint, stopCriteria: project.campaign.stopCriteria,
    autoApprove: project.campaign.autoApproveOfflineExperiment, stopReason: project.campaign.stopReason,
    attention: project.attentionRequests?.filter(item => item.blocking && item.status === "pending"),
    baselineEpoch: { id: project.baselineRun.id, startedAt: project.baselineRun.startedAt, measurementFingerprint: project.baselineRun.measurementFingerprint, suiteName: project.baselineRun.suiteName, totalCases: project.baselineRun.totalCases },
    validation: project.validationRun, acceptance: project.artifactAcceptance,
    candidates: project.candidates, champion: project.searchChampion,
    archive: project.evolutionArchive.map(item => ({ kind: item.kind, round: item.round, candidate: item.candidate })) });
}
/** Derive from independent authoritative Job/SDK Run; caller labels cannot select an owner. */
export async function readServerHtmlProtectionCollectionOwner(project: EvolveProject, supplied?: ServerHtmlProtectionOwnerPorts) {
  const owner = project.campaign.serverControlOwner;
  if (owner?.phase !== "bound" || !owner.runId || project.campaign.status !== "running") throw Error("html-protection-active-owner-unavailable");
  const ports = supplied ?? defaultPorts();
  const job = await ports.readJob(owner.controlJobId);
  const parsed = EvolutionJobSchema.safeParse(job);
  if (!parsed.success) throw Error("html-protection-active-owner-unavailable");
  const execution = { executionId: owner.runId, jobId: owner.controlJobId, generation: parsed.data.generation };
  await assertServerHtmlProtectionOwner({ project, execution, active: true }, ports);
  return execution;
}
/** Used before/after every actual collection, and independently for persisted restoration. */
type OwnerCheck = { project: EvolveProject;
  execution: ServerHtmlProtectionExecutionIdentity; active: boolean; scoringRouteFingerprint?: string;
  selectionIdentitySha256?:string; selectionProvenance?:AuthenticatedServerHtmlProtectionSelection;
};
async function checkServerHtmlProtectionOwner(args: OwnerCheck, supplied: ServerHtmlProtectionOwnerPorts|undefined,contextOnly:boolean) {
  const ports = supplied ?? defaultPorts(), input = serverHtmlProtectionInputSha256(args.project),
    callerContext = serverHtmlProtectionOwnerContext(args.project);
  const current = await ports.readMission(args.project.id);
  if (!current || !matchesIndependentInput(current,args.project,input)
    || args.active && htmlProtectionCanonicalJson(current.searchChampion??null) !== htmlProtectionCanonicalJson(args.project.searchChampion??null)) throw Error("html-protection-input-generation-changed");
  if (args.active) {
    const owner = current.campaign.serverControlOwner, expected = args.project.campaign.serverControlOwner;
    if (!owner || owner.phase !== "bound" || owner.controlJobId !== args.execution.jobId || owner.runId !== args.execution.executionId
      || owner.operationKey !== expected?.operationKey || current.campaign.status !== "running"
      || current.attentionRequests?.some(item => item.blocking && item.status === "pending" && item.type === "authorization")) throw Error("html-protection-active-owner-changed");
  }
  const missionContext = serverHtmlProtectionOwnerContext(current);
  const first = await ports.readJob(args.execution.jobId);
  if (!matchingJob(current, first, args.execution, args.active)) throw Error("html-protection-job-generation-changed");
  const run = await ports.readRun(args.execution.executionId);
  if (!run.exists || ![...(args.active ? ["running"] : ["running", "completed"])].includes(run.status ?? "")) throw Error("html-protection-sdk-run-unavailable");
  const selected=await readOwnerRoute(ports,args.selectionProvenance,contextOnly),route=selected.route;
  if (!route || !contextOnly&&args.scoringRouteFingerprint&&route!==args.scoringRouteFingerprint)throw Error("html-protection-scoring-route-changed");
  if(args.selectionIdentitySha256&&selected.selectionIdentitySha256!==args.selectionIdentitySha256)throw Error("html-protection-selection-identity-changed");
  // Final independent reads follow all SDK/model-route awaits. No CAS writer context is refreshed.
  const finalJob = await ports.readJob(args.execution.jobId);
  const finalRun = await ports.readRun(args.execution.executionId);
  const finalSelected=await readOwnerRoute(ports,args.selectionProvenance,contextOnly),finalRoute=finalSelected.route;
  const finalMission = await ports.readMission(args.project.id);
  // The final Mission I/O can itself overlap a Key-only or same-revision sealed-row replacement.
  // Re-read the original complete selection after that await; never refresh its identity or expiry.
  const terminalSelected=await readOwnerRoute(ports,args.selectionProvenance,contextOnly);
  if (!matchingJob(current, finalJob, args.execution, args.active) || !finalRun.exists
    || ![...(args.active ? ["running"] : ["running", "completed"])].includes(finalRun.status ?? "") || finalRoute !== route || !finalMission
    || finalSelected.selectionIdentitySha256!==selected.selectionIdentitySha256
    || htmlProtectionCanonicalJson(finalSelected.selection??null)!==htmlProtectionCanonicalJson(selected.selection??null)
    || terminalSelected.route!==route||terminalSelected.selectionIdentitySha256!==selected.selectionIdentitySha256
    || htmlProtectionCanonicalJson(terminalSelected.selection??null)!==htmlProtectionCanonicalJson(selected.selection??null)
    || serverHtmlProtectionOwnerContext(args.project) !== callerContext
    || serverHtmlProtectionOwnerContext(finalMission) !== missionContext
    || args.active && finalMission.campaign.status !== "running"
    || !matchesIndependentInput(finalMission,args.project,input) || serverHtmlProtectionInputSha256(args.project) !== input
    || args.active && (htmlProtectionCanonicalJson(finalMission.campaign.serverControlOwner??null) !== htmlProtectionCanonicalJson(current.campaign.serverControlOwner??null)
      || htmlProtectionCanonicalJson(finalMission.searchChampion??null) !== htmlProtectionCanonicalJson(current.searchChampion??null))) {
    throw Error("html-protection-owner-or-input-changed-after-await");
  }
  return { execution: { ...args.execution }, inputSha256: input, scoringRouteFingerprint: route,
    selection:selected.selection,selectionIdentitySha256:selected.selectionIdentitySha256,
    subjectContextSha256: createHash("sha256").update(callerContext).digest("hex"),
    missionContextSha256: createHash("sha256").update(missionContext).digest("hex") };
}
/** Actual fresh saved-selection checks accompany every normal owner guard. A route hash alone is insufficient for whole evidence. */
export function assertServerHtmlProtectionOwner(args:OwnerCheck,supplied?:ServerHtmlProtectionOwnerPorts){return checkServerHtmlProtectionOwner(args,supplied,false);}
/** Restoration precheck authenticates actual Job/SDK/input context; it deliberately grants no route, selection or Core authority. */
export function assertServerHtmlProtectionOwnerContext(args:Omit<OwnerCheck,"scoringRouteFingerprint"|"selectionIdentitySha256"|"selectionProvenance">,supplied?:ServerHtmlProtectionOwnerPorts){return checkServerHtmlProtectionOwner(args,supplied,true);}
