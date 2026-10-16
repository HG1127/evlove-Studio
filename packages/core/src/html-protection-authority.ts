import {
  AcceptanceCriterionSchema, CandidateSchema, HtmlProtectionProofBindingSchema, TargetRunResultSchema, TestCaseSchema,
  type AcceptanceCriterion, type Candidate, type EvolveProject, type HtmlProtectionEvidence,
  type HtmlProtectionObligation, type HtmlProtectionProofBinding, type TargetRunResult, type TestCase,
} from "@evolution/contracts";
import { assessHtmlProtectionOperationalAcceptance, confirmedHtmlProtectionOperationalScope } from "./html-protection-operational-scope";
import { baselineDeferredComparisonCriterionIds } from "./baseline-comparison-phase";
import { validateHtmlProtectionProof, type HtmlProtectionProofValidation } from "./html-protection-proof";

export const HTML_PROTECTION_AUTHORITY_POLICY = "html-protection-independent-authority-v3-frozen-semantic-scope";
/** Internal capability. JSON, public proof DTOs and copied objects never carry it. */
export type HtmlProtectionAuthority = Readonly<{ readonly capability: "html-protection-authority-v1" }>;
type Record = {
  binding: HtmlProtectionProofBinding; hidden: boolean; paper: string; criterion: string; subjectIdentity: string; run: string; contract: string;
  operationalAcceptance?: ReturnType<typeof assessHtmlProtectionOperationalAcceptance>;
  validation: HtmlProtectionProofValidation; observedAt: number; expiresAt: number;
};
const records = new WeakMap<HtmlProtectionAuthority, Record>();
const projects = new WeakMap<object, readonly HtmlProtectionAuthority[]>();
type BuiltSubject = { candidate: Candidate; priorPhysicalDomain: string };
const builtSubjects = new WeakMap<object, Map<string, BuiltSubject>>();
const candidatePhysicalDomain = (candidate: Candidate) => canonical({ id: candidate.id, name: candidate.name, title: candidate.title,
  change: candidate.change, hypothesis: candidate.hypothesis, patches: candidate.patches, expectedImpact: candidate.expectedImpact,
  risks: candidate.risks, riskLevel: candidate.riskLevel, designRationale: candidate.designRationale, addressesAdvice: candidate.addressesAdvice,
  artifactSnapshots: candidate.artifactSnapshots, connectorBinding: candidate.connectorBinding });
const draftIdentity = (candidate: Candidate) => canonical(CandidateSchema.parse(candidate));
function candidateParent(project: EvolveProject, candidateId: string): string | undefined {
  const champion = project.searchChampion;
  if (!champion) return canonical({ version: project.version });
  if (champion.candidate?.id !== candidateId) return canonical({ round: champion.round, candidate: champion.candidate ? candidatePhysicalDomain(champion.candidate) : undefined });
  const validation = project.validationRun;
  if (validation?.status !== "completed" || validation.validationMode !== "full" || validation.candidateId !== candidateId || !champion.parentVersionId) return undefined;
  if (champion.parentVersionId === project.version) return canonical({ version: project.version });
  const match = /^S([1-9][0-9]*)$/.exec(champion.parentVersionId);
  const prior = (project.evolutionArchive ?? []).filter(entry => entry.kind === "champion" && entry.round === Number(match?.[1]));
  if (!match || Number(match[1]) >= champion.round || prior.length !== 1) return undefined;
  return canonical({ round: prior[0]!.round, candidate: candidatePhysicalDomain(prior[0]!.candidate) });
}
function expectedSubjectIdentity(project: EvolveProject, record: Record): string | undefined {
  const direct = htmlProtectionAuthoritySubjectContract(project, record.binding);
  if (direct === record.subjectIdentity) return direct;
  if (record.binding.subject.kind !== "candidate") return direct;
  const id = record.binding.subject.candidateId, carried = builtSubjects.get(project)?.get(id), stored = project.candidates.filter(item => item.id === id);
  if (!carried || stored.length !== 1 || draftIdentity(stored[0]!) !== carried.priorPhysicalDomain) return direct;
  return htmlProtectionAuthoritySubjectContract({ ...project, candidates: project.candidates.map(item => item.id === id ? carried.candidate : item) }, record.binding);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value);
}
/** Entire domain input/papers remain bound; mutable execution bookkeeping is separate. */
export function htmlProtectionAuthorityContract(project: EvolveProject): string {
  return canonical({ policy: HTML_PROTECTION_AUTHORITY_POLICY, id: project.id, version: project.version,
    currentVersionId: project.currentVersionId, sourceArtifacts: project.sourceArtifacts,
    ...(project.htmlProtectionOperationalScope ? { operationalScope: project.htmlProtectionOperationalScope } : {}),
    goal: project.goal, command: project.evolutionCommand, protectedItems: project.protectedItems,
    editableItems: project.editableItems, rubric: project.acceptanceRubric,
    visible: project.evalSuite, hidden: project.hiddenEvalSuite, target: project.targetConnection,
    experimentPolicy: project.experimentPolicy, aiProfile: project.aiProfile,
    baselineEpoch: project.baselineRun ? { id: project.baselineRun.id, startedAt: project.baselineRun.startedAt,
      measurementFingerprint: project.baselineRun.measurementFingerprint, suiteName: project.baselineRun.suiteName, totalCases: project.baselineRun.totalCases } : undefined,
    campaignContext: { round: project.campaign?.checkpoint?.round ?? project.campaign?.currentRound, owner: project.campaign?.serverControlOwner,
      scoringInput: project.campaign?.scoringInputFingerprint, scoringRoute: project.campaign?.scoringRouteFingerprint } });
}
/** Locator metadata is outside the signed run; every execution/proof/status/trace field stays bound. */
export function htmlProtectionAuthorityCanonicalRun(run: TargetRunResult): TargetRunResult {
  const { htmlProtectionAuthorityRefs, ...material } = TargetRunResultSchema.strict().parse(run);
  void htmlProtectionAuthorityRefs;
  return material;
}
const runWire = (run: TargetRunResult) => canonical(htmlProtectionAuthorityCanonicalRun(run));
/** Re-derive the expected physical subject from current domain lineage, never from locator references. */
export function htmlProtectionAuthoritySubjectContract(project: EvolveProject, binding: HtmlProtectionProofBinding): string | undefined {
  const source = project.sourceArtifacts.filter(item => item.id === binding.original.sourceArtifactId && item.role === "target");
  if (source.length !== 1) return undefined;
  let candidate;
  if (binding.subject.kind === "candidate") {
    const candidateId = binding.subject.candidateId;
    const matches = project.candidates.filter(item => item.id === candidateId);
    if (matches.length !== 1) return undefined;
    candidate = matches[0];
  } else {
    const currentId = binding.subject.versionId, champion = project.searchChampion;
    if (!champion) {
      if (currentId !== project.version) return undefined;
    } else if (champion.candidate?.id === currentId) candidate = champion.candidate;
    else {
      // An accepted new Champion may retain its independently paired pre-promotion Current.
      const accepted = project.validationRun;
      if (!champion.candidate || accepted?.status !== "completed" || accepted.validationMode !== "full"
        || accepted.candidateId !== champion.candidate.id || !champion.parentVersionId) return undefined;
      if (champion.parentVersionId === project.version) {
        if (currentId !== project.version) return undefined;
      } else {
        const priorRound = /^S([1-9][0-9]*)$/.exec(champion.parentVersionId);
        const prior = (project.evolutionArchive ?? []).filter(entry => entry.kind === "champion" && entry.round === Number(priorRound?.[1]));
        if (!priorRound || Number(priorRound[1]) >= champion.round || prior.length !== 1 || prior[0]!.candidate.id !== currentId) return undefined;
        candidate = prior[0]!.candidate;
      }
    }
  }
  if (!candidate) {
    if (canonical(binding.original) !== canonical(binding.executed)) return undefined;
    return canonical({ source: source[0], subject: binding.subject, identity: binding.executed });
  }
  const snapshots = candidate.artifactSnapshots.filter(item => item.sourceArtifactId === source[0]!.id);
  const frozen = snapshots.length === 1 ? snapshots[0]!.frozenArtifact : undefined;
  if (!frozen || frozen.sha256 !== binding.executed.sha256 || frozen.size !== binding.executed.byteLength) return undefined;
  const parent = binding.subject.kind === "candidate" ? candidateParent(project, candidate.id) : undefined;
  if (binding.subject.kind === "candidate" && parent === undefined) return undefined;
  return canonical({ source: source[0], subject: binding.subject, candidate: candidatePhysicalDomain(candidate), parent });
}
/**
 * Pure final validation after the App has independently obtained physical inputs,
 * authoritative owner/route and all trusted port observations. This is not a
 * public request parser or provenance issuer. The App must never invoke it with
 * trustedEvidence taken from the proof, a Mission DTO or a model's PASS claim.
 */
export function createHtmlProtectionAuthority(args: {
  project: EvolveProject; testCase: TestCase; proof: unknown;
  expectedBinding: HtmlProtectionProofBinding; requiredObligations: readonly HtmlProtectionObligation[];
  trustedEvidence: readonly HtmlProtectionEvidence[]; canonicalRun: TargetRunResult;
  policyVersion: string; observedAt: string; expiresAt: string; now: number;
}): HtmlProtectionAuthority | undefined {
  const binding = HtmlProtectionProofBindingSchema.safeParse(args.expectedBinding);
  const test = TestCaseSchema.safeParse(args.testCase);
  const run = TargetRunResultSchema.strict().safeParse(args.canonicalRun);
  const observedAt = Date.parse(args.observedAt), expiresAt = Date.parse(args.expiresAt);
  if (!binding.success || !test.success || !run.success || args.policyVersion !== HTML_PROTECTION_AUTHORITY_POLICY
    || !Number.isFinite(args.now) || !Number.isFinite(observedAt) || !Number.isFinite(expiresAt)
    || observedAt > args.now || args.now >= expiresAt || expiresAt <= observedAt
    || binding.data.missionId !== args.project.id || binding.data.testCaseId !== test.data.id
    || run.data.testCaseId !== test.data.id || run.data.artifactHash !== binding.data.executed.sha256
    || !test.data.criterionIds.includes(binding.data.criterionId)) return undefined;
  const paper = test.data.hidden ? args.project.hiddenEvalSuite : args.project.evalSuite;
  const matches = paper.filter(item => item.id === test.data.id);
  const criterion = args.project.acceptanceRubric.filter(item => item.id === binding.data.criterionId);
  const source = args.project.sourceArtifacts.filter(item => item.id === binding.data.original.sourceArtifactId && item.role === "target");
  if (matches.length !== 1 || canonical(TestCaseSchema.parse(matches[0])) !== canonical(test.data)
    || new Set(paper.map(item => item.id)).size !== paper.length || criterion.length !== 1 || source.length !== 1
    || criterion[0]!.artifactIds.length && !criterion[0]!.artifactIds.includes(source[0]!.id)) return undefined;
  const identity = htmlProtectionAuthoritySubjectContract(args.project, binding.data);
  if (!identity) return undefined;
  if (args.trustedEvidence.some(item => !Number.isFinite(Date.parse(item.observedAt)) || Date.parse(item.observedAt) > observedAt)) return undefined;
  const validation = validateHtmlProtectionProof({ proof: args.proof, expectedBinding: binding.data,
    requiredObligations: args.requiredObligations, trustedEvidence: args.trustedEvidence });
  // Honest partial and observed failure remain consumable rejection evidence.
  if (!validation.valid) return undefined;
  let operationalAcceptance: ReturnType<typeof assessHtmlProtectionOperationalAcceptance> | undefined;
  try { const scope = confirmedHtmlProtectionOperationalScope(args.project,binding.data.original);
    if (scope) operationalAcceptance = assessHtmlProtectionOperationalAcceptance({scope,validation,requiredObligations:args.requiredObligations});
  } catch { return undefined; }
  const capability = Object.freeze({ capability: "html-protection-authority-v1" as const });
  records.set(capability, { binding: structuredClone(binding.data), hidden: test.data.hidden, paper: canonical(test.data), criterion: canonical(AcceptanceCriterionSchema.parse(criterion[0])),
    subjectIdentity: identity, run: runWire(run.data),
    contract: htmlProtectionAuthorityContract(args.project), operationalAcceptance, validation: structuredClone(validation), observedAt, expiresAt });
  return capability;
}
/** Only registered capabilities can cross a pure composition boundary; a JSON copy fails. */
export function bindHtmlProtectionAuthorities(project: EvolveProject, authorities: readonly HtmlProtectionAuthority[], actualBuiltCandidate?: Candidate): boolean {
  const contract = htmlProtectionAuthorityContract(project);
  if (authorities.some(item => records.get(item)?.contract !== contract)) return false;
  // A trusted execution port may produce frozen bytes before normal Domain settlement writes that build into project.candidates.
  // Only already registered physical authority can carry this private view; a DTO cannot create one.
  if (actualBuiltCandidate) {
    const built = CandidateSchema.safeParse(actualBuiltCandidate), stored = project.candidates.filter(item => item.id === actualBuiltCandidate.id);
    if (!built.success || stored.length !== 1 || !authorities.length || authorities.some(authority => { const record = records.get(authority);
      return !record || record.binding.subject.kind !== "candidate" || record.binding.subject.candidateId !== built.data.id
        || htmlProtectionAuthoritySubjectContract({ ...project, candidates: project.candidates.map(item => item.id === built.data.id ? built.data : item) }, record.binding) !== record.subjectIdentity; })) return false;
    const subjects = new Map(builtSubjects.get(project));
    subjects.set(built.data.id, { candidate: structuredClone(built.data), priorPhysicalDomain: draftIdentity(stored[0]!) });
    builtSubjects.set(project, subjects);
  }
  if (authorities.some(item => { const record = records.get(item); return !record || record.contract !== contract
    || expectedSubjectIdentity(project, record) !== record.subjectIdentity; })) return false;
  const key = (item: HtmlProtectionAuthority) => {
    const record = records.get(item)!;
    return canonical([record.binding.criterionId, record.binding.testCaseId, record.binding.subject]);
  };
  const incoming = new Map(authorities.map(item => [key(item), item]));
  if (incoming.size !== authorities.length) return false;
  for (const prior of projects.get(project) ?? []) if (records.get(prior)?.contract === contract && !incoming.has(key(prior))) incoming.set(key(prior), prior);
  projects.set(project, Object.freeze([...incoming.values()]));
  return true;
}
/** Positive authority is withdrawn before an async restoration; failed revalidation cannot reuse a previous PASS. */
export function invalidateHtmlProtectionAuthorities(project: EvolveProject, scope: { testCaseIds: readonly string[];
  criterionIds?: readonly string[]; subject: "current" | { candidateId: string } }): void {
  const tests = new Set(scope.testCaseIds), criteria = scope.criterionIds ? new Set(scope.criterionIds) : undefined;
  projects.set(project, Object.freeze((projects.get(project) ?? []).filter(authority => {
    const item = records.get(authority);
    if (!item) return false;
    const matches = tests.has(item.binding.testCaseId) && (!criteria || criteria.has(item.binding.criterionId))
      && (scope.subject === "current" ? item.binding.subject.kind === "current"
        : item.binding.subject.kind === "candidate" && item.binding.subject.candidateId === scope.subject.candidateId);
    // Immutable known losses remain refusal evidence only; all positive/partial capabilities require fresh verification.
    return !matches || item.validation.failedObligationIds.length > 0;
  })));
}
/** Carry authority through owned immutable domain settlement without granting it to arbitrary serialized projects. */
export function inheritHtmlProtectionAuthorities(from: EvolveProject, to: EvolveProject): void {
  const contract=htmlProtectionAuthorityContract(from),now=Date.now();
  const authorities=(projects.get(from)??[]).filter(authority=>{const record=records.get(authority);
    return record&&record.contract===contract&&expectedSubjectIdentity(from,record)===record.subjectIdentity
      &&Number.isFinite(now)&&now>=record.observedAt&&now<record.expiresAt;});
  const subjects=builtSubjects.get(from),carried=new Map<string,BuiltSubject>();
  if(subjects)for(const [id,subject]of subjects)if(authorities.some(authority=>{const record=records.get(authority)!;return record.binding.subject.kind==="candidate"&&record.binding.subject.candidateId===id;}))carried.set(id,subject);
  // A destination projection can never revive a token that stopped matching its actual source.
  projects.delete(to);builtSubjects.delete(to);
  if(carried.size)builtSubjects.set(to,carried);
  if(authorities.length)bindHtmlProtectionAuthorities(to,authorities);
}
function scopedRecords(project: EvolveProject, criterion: AcceptanceCriterion, runs: readonly TargetRunResult[], now: number) {
  const parsedCriterion = AcceptanceCriterionSchema.safeParse(criterion);
  const storedCriterion = project.acceptanceRubric.filter(item => item.id === criterion.id);
  if (!parsedCriterion.success || storedCriterion.length !== 1 || canonical(AcceptanceCriterionSchema.parse(storedCriterion[0])) !== canonical(parsedCriterion.data)) return [];
  const contract = htmlProtectionAuthorityContract(project);
  const result: Record[] = [];
  for (const authority of projects.get(project) ?? []) {
    const item = records.get(authority);
    if (!item || item.contract !== contract || item.binding.criterionId !== criterion.id
      || item.criterion !== canonical(parsedCriterion.data) || expectedSubjectIdentity(project, item) !== item.subjectIdentity
      || !Number.isFinite(now) || now < item.observedAt || now >= item.expiresAt) continue;
    const matches = runs.filter(run => run.testCaseId === item.binding.testCaseId);
    if (matches.length === 1 && runWire(matches[0]!) === item.run) result.push(item);
  }
  return result;
}
/** A criterion needs every actual mapped case for exactly one arm, never a subset. */
export function htmlProtectionCriterionAuthority(args: {
  project: EvolveProject; criterion: AcceptanceCriterion; testCases: readonly TestCase[];
  runs: readonly TargetRunResult[]; now?: number; measurementPhase?: "current-baseline";
}) {
  const invalid = { complete: false, passed: false, observedFailure: false, failedObligationIds: [] as string[] };
  if (!projects.get(args.project)?.length) return invalid;
  const parsedCases = args.testCases.map(test => TestCaseSchema.safeParse(test));
  if (parsedCases.some(test => !test.success)) return invalid;
  const requested = parsedCases.flatMap(test => test.success && test.data.criterionIds.includes(args.criterion.id) ? [test.data] : []);
  if (args.measurementPhase === "current-baseline" && requested.some(test => test.hidden)) return invalid;
  const mapped: TestCase[] = [];
  for (const test of requested) {
    const paper = test.hidden ? args.project.hiddenEvalSuite : args.project.evalSuite, sameId = paper.filter(item => item.id === test.id);
    if (sameId.length !== 1) return invalid;
    const stored = TestCaseSchema.parse(sameId[0]);
    if (canonical(stored) !== canonical(test)) {
      // Only the explicit normal Current Baseline phase can project out compiler-deferred comparisons.
      const deferred = baselineDeferredComparisonCriterionIds(args.project);
      const projected = { ...stored, criterionIds: stored.criterionIds.filter(id => !deferred.has(id)) };
      if (args.measurementPhase !== "current-baseline" || stored.hidden || test.hidden || deferred.has(args.criterion.id)
        || canonical(projected) !== canonical(test)) return invalid;
    }
    mapped.push(stored);
  }
  const applicable = scopedRecords(args.project, args.criterion, args.runs, args.now ?? Date.now());
  const failures = applicable.filter(item => item.validation.failedObligationIds.length > 0);
  if (failures.length) return { complete: false, passed: false, observedFailure: true,
    failedObligationIds: [...new Set(failures.flatMap(item => item.validation.failedObligationIds))] };
  if (!mapped.length || new Set(mapped.map(item => item.id)).size !== mapped.length) return { complete: false, passed: false, observedFailure: false, failedObligationIds: [] };
  let subject: string | undefined;
  const complete = mapped.every(test => {
    const matches = applicable.filter(item => item.binding.testCaseId === test.id && item.hidden === test.hidden && item.paper === canonical(test)
      && (args.measurementPhase !== "current-baseline" || item.binding.subject.kind === "current"));
    if (matches.length !== 1 || !(matches[0]!.validation.complete && matches[0]!.validation.passed || matches[0]!.operationalAcceptance?.passed)) return false;
    const arm = canonical(matches[0]!.binding.subject);
    if (subject !== undefined && subject !== arm) return false;
    subject = arm;
    return true;
  });
  return { complete, passed: complete, observedFailure: false, failedObligationIds: [] };
}
/** Gate F and delivery independently require BOTH arms on the complete same Hidden paper. */
export function hasHtmlProtectionAcceptanceAuthority(project: EvolveProject, criteria: readonly AcceptanceCriterion[]): boolean {
  const validation = project.validationRun;
  if (!criteria.length || new Set(criteria.map(criterion => criterion.id)).size !== criteria.length
    || !validation?.candidateId || validation.status !== "completed" || validation.validationMode !== "full") return false;
  const now=Date.now();
  return criteria.every(criterion => {
    const candidate = htmlProtectionCriterionAuthority({ project, criterion, testCases: project.hiddenEvalSuite, runs: validation.runs, now });
    const current = htmlProtectionCriterionAuthority({ project, criterion, testCases: project.hiddenEvalSuite, runs: validation.baselineRuns, now });
    if (!candidate.passed || !current.passed) return false;
    const candidateRecords = scopedRecords(project, criterion, validation.runs, now);
    const currentRecords = scopedRecords(project, criterion, validation.baselineRuns, now);
    const mapped=project.hiddenEvalSuite.filter(test=>test.criterionIds.includes(criterion.id));
    if(!mapped.length||candidateRecords.length!==mapped.length||currentRecords.length!==mapped.length
      ||new Set(candidateRecords.map(item=>item.binding.testCaseId)).size!==mapped.length||new Set(currentRecords.map(item=>item.binding.testCaseId)).size!==mapped.length
      ||mapped.some(test=>!candidateRecords.some(item=>item.binding.testCaseId===test.id&&item.hidden&&item.paper===canonical(test))
        ||!currentRecords.some(item=>item.binding.testCaseId===test.id&&item.hidden&&item.paper===canonical(test))))return false;
    return candidateRecords.every(item => item.binding.subject.kind === "candidate" && item.binding.subject.candidateId === validation.candidateId)
      && currentRecords.every(item => item.binding.subject.kind === "current")
      && candidateRecords.every(item => currentRecords.some(other => other.binding.testCaseId === item.binding.testCaseId
        && other.binding.paperSha256 === item.binding.paperSha256
        && canonical(other.binding.original) === canonical(item.binding.original)));
  });
}
