import { createHash } from "node:crypto";
import { CandidateSchema, HtmlProtectionWholeRuntimeRequestSchema, TargetRunResultSchema,
  type ArtifactStorePort, type Candidate, type EvolveProject, type HtmlProtectionAuthorityReference, type TargetRunResult, type TestCase } from "@evolution/contracts";
import { createHtmlProtectionAuthority, HTML_PROTECTION_AUTHORITY_POLICY, isWholeProtectionCriterion, hasHtmlProtectionTarget,
  htmlProtectionWholeRuntimeSourcePlan, htmlProtectionWholeSubjectScriptLocations, fastHash, type HtmlProtectionAuthority } from "@evolution/core";
import { serverJudgeEvidence, type ServerHtmlProtectionAuthorityPort } from "@evolution/harness";
import { collectServerHtmlProtectionWholeObservation } from "./server-html-protection-whole-observation";
import { prepareServerHtmlProtectionAuthorityPlan } from "./server-html-protection-authority-plan";
import { assertServerHtmlProtectionOwner, assertServerHtmlProtectionOwnerContext, readServerHtmlProtectionCollectionOwner, serverHtmlProtectionBoundInputSha256, type ServerHtmlProtectionOwnerPorts } from "./server-html-protection-authority-owner";
import { readServerHtmlProtectionAuthorityRuntime } from "./server-html-protection-authority-runtime";
import { createServerHtmlProtectionNativeRecordSink } from "./server-html-protection-authority-store";
import { htmlProtectionCanonicalJson as canonical, htmlProtectionCanonicalRun, attestServerHtmlProtectionAuthority,
  verifyServerHtmlProtectionAuthorityAttestation, authenticateServerHtmlProtectionAuthoritySelection, readAuthenticatedServerHtmlProtectionSelection,
  type AuthenticatedServerHtmlProtectionSelection } from "./server-html-protection-authority-attestation";
import { serverAiPublicSelectionIdentity, type ServerAiPublicSelection } from "./server-ai-public-selection";
import { persistServerHtmlProtectionAuthorityEnvelope, readServerHtmlProtectionAuthorityEnvelope, serverHtmlProtectionObservationSha256,
  type ServerHtmlProtectionAuthorityObservations } from "./server-html-protection-authority-envelope";
import { readServerHtmlProtectionAuthorityNative, deriveServerHtmlProtectionAuthorityObservations, deriveServerHtmlProtectionAuthorityStaticObservations, readServerHtmlProtectionAuthorityStaticPrefix } from "./server-html-protection-authority-observations";
import { collectServerHtmlProtectionSemanticObservations } from "./server-html-protection-semantic-observation";
import { collectServerHtmlProtectionVisualObservations, prepareServerHtmlProtectionVisualPairs } from "./server-html-protection-visual-observation";
import { createServerHtmlProtectionPhysicalReader } from "./server-html-protection-authority-artifact-reader";
import { resolveEvidenceSigningConfig } from "./evidence-ledger";
import type { ServerHtmlProtectionSigningConfig } from "./server-html-protection-attestation";
const sha = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const TTL_MS = 60 * 60 * 1000;
const restoredSelections=new WeakMap<object,Map<string,{provenance:AuthenticatedServerHtmlProtectionSelection;observedAt:string;expiresAt:string;selectionIdentitySha256:string;inputSha256:string;subjectContextSha256:string;missionContextSha256:string}>>();
/** Only fully reconstructed restoration can install this private witness; reference/selection DTOs cannot. */
export async function assertServerHtmlProtectionRestoredOwner(args:{project:EvolveProject;reference:HtmlProtectionAuthorityReference},ports:ServerHtmlProtectionAuthorityPorts={}){
  const value=restoredSelections.get(args.project)?.get(canonical(args.reference)),now=ports.now??Date.now;
  if(!value||now()<Date.parse(value.observedAt)||now()>=Date.parse(value.expiresAt))throw Error("html-protection-restored-selection-witness-unavailable-or-expired");
  const checked=await assertServerHtmlProtectionOwner({project:args.project,execution:{executionId:args.reference.executionId,jobId:args.reference.jobId,generation:args.reference.generation},active:false,
    scoringRouteFingerprint:args.reference.scoringRouteFingerprint,selectionIdentitySha256:value.selectionIdentitySha256,selectionProvenance:value.provenance},ports.owner);
  if(now()<Date.parse(value.observedAt)||now()>=Date.parse(value.expiresAt))throw Error("html-protection-restored-selection-witness-expired-after-await");
  if(checked.inputSha256!==value.inputSha256||checked.subjectContextSha256!==value.subjectContextSha256||checked.missionContextSha256!==value.missionContextSha256)throw Error("html-protection-restored-selection-owner-context-drift");
}
export type ServerHtmlProtectionAuthorityPorts = {
  owner?: ServerHtmlProtectionOwnerPorts; store?: ArtifactStorePort;
  getArtifact?: (id: string) => Promise<Blob | undefined>;
  observeWhole?: typeof collectServerHtmlProtectionWholeObservation;
  observeSemantic?: Parameters<typeof collectServerHtmlProtectionSemanticObservations>[1];
  observeVisual?: Parameters<typeof collectServerHtmlProtectionVisualObservations>[1];
  readRuntime?: typeof readServerHtmlProtectionAuthorityRuntime;
  readSigning?: () => Promise<ServerHtmlProtectionSigningConfig | undefined>;
  now?: () => number;
};
const signing = async () => { const value = await resolveEvidenceSigningConfig();
  return value ? { keyId: value.keyId, key: value.key, verificationKeys: value.verificationKeys } : undefined; };
function subjectProject(project: EvolveProject, candidate?: Candidate) {
  if (!candidate) return project;
  const parsed = CandidateSchema.parse(candidate), matched = project.candidates.filter(item => item.id === parsed.id);
  if (matched.length !== 1) throw Error("html-protection-candidate-identity-ambiguous");
  // The actual build port can freeze a local execution subject before its normal result is settled.
  // All complete frozen bytes/receipt are independently read, and both authoritative Mission and local subject must stay stable.
  return { ...project, candidates: project.candidates.map(item => item.id === parsed.id ? parsed : item) };
}
/** Actual App composition. The public API can supply neither its native producer nor Core capability tokens. */
export function createServerHtmlProtectionAuthorityCollector(ports: ServerHtmlProtectionAuthorityPorts = {}): ServerHtmlProtectionAuthorityPort {
  const now = ports.now ?? Date.now, readSigning = ports.readSigning ?? signing, readRuntime = ports.readRuntime ?? readServerHtmlProtectionAuthorityRuntime;
  return async args => {
    const runs = args.runs.map(run => TargetRunResultSchema.strict().parse(structuredClone(run))), authorities: HtmlProtectionAuthority[] = [];
    if (hasHtmlProtectionTarget(args.project) === false) return { runs, authorities };
    const active = new Set(args.activeCriterionIds ?? args.project.acceptanceRubric.map(item => item.id)), criteria = args.project.acceptanceRubric.filter(item => active.has(item.id) && isWholeProtectionCriterion(item));
    if (!criteria.length) return { runs, authorities };
    const project = subjectProject(args.project, args.candidate), candidate = args.candidate ? CandidateSchema.parse(structuredClone(args.candidate)) : undefined;
    for (let index = 0; index < args.testCases.length; index++) {
      const testCase = args.testCases[index]!, suppliedRun = runs[index];
      const query = `${testCase.title} ${testCase.input} ${testCase.expected.join(" ")}`;
      const run = suppliedRun && !args.restoreOnly ? serverJudgeEvidence(suppliedRun, query).run : suppliedRun;
      if (!run || run.testCaseId !== testCase.id) throw Error("html-protection-canonical-suite-order-invalid");
      const applicable = criteria.filter(item => testCase.criterionIds.includes(item.id));
      if (!applicable.length) continue;
      if (args.restoreOnly) {
        for (const criterion of applicable) {
          try {
            const refs = run.htmlProtectionAuthorityRefs?.filter(item => item.criterionId === criterion.id) ?? [];
            if (refs.length !== 1) continue;
            const token = await restoreServerHtmlProtectionAuthority({ project, candidate, testCase, run, reference: refs[0]!, criterionId: criterion.id }, ports);
            if (token) authorities.push(token);
          } catch { /* Missing/failed independent restoration remains blocked. */ }
        }
        continue;
      }
      const collectionGaps:string[]=[];
      const collected: Array<{ derived: Pick<ReturnType<typeof deriveServerHtmlProtectionAuthorityObservations>, "proof" | "validation" | "requiredObligations" | "trustedEvidence" | "planSha256">; observations: ServerHtmlProtectionAuthorityObservations;
        inputSha256: string; route: string; selection:ServerAiPublicSelection; execution: Awaited<ReturnType<typeof readServerHtmlProtectionCollectionOwner>>; observedAt: string; expiresAt: string; guard: () => Promise<void> }> = [];
      for (const criterion of applicable) {
        let fallback: { prepared: Awaited<ReturnType<typeof prepareServerHtmlProtectionAuthorityPlan>>; execution: Awaited<ReturnType<typeof readServerHtmlProtectionCollectionOwner>>;
          inputSha256: string; route: string; selection:ServerAiPublicSelection; guard: () => Promise<void>; native: ServerHtmlProtectionAuthorityObservations["native"] } | undefined;
        try {
        const execution = await readServerHtmlProtectionCollectionOwner(project, ports.owner), before = await assertServerHtmlProtectionOwner({ project, execution, active: true }, ports.owner);
        if(!before.selection||!before.selectionIdentitySha256)throw Error("html-protection-complete-saved-selection-unavailable");
        const selection=before.selection,selectionIdentitySha256=before.selectionIdentitySha256;
        const physicalReader = createServerHtmlProtectionPhysicalReader({ project, store: ports.store, getArtifact: ports.getArtifact });
        const prepared = await prepareServerHtmlProtectionAuthorityPlan({ project, candidate, testCase, criterionId: criterion.id, execution,
          ports: { getArtifact: physicalReader.getArtifact } });
        const boundInput = () => sha({ domain: serverHtmlProtectionBoundInputSha256(project, prepared.binding), semanticRequirementsSha256: prepared.semanticRequirementsSha256, physicalMetadata: physicalReader.metadataIdentity(),selectionIdentitySha256 });
        const inputSha256 = boundInput();
        const originalHtml = prepared.physicalInputs.original.toString("utf8"), executedHtml = prepared.physicalInputs.executed.toString("utf8");
        if (typeof run.artifactHash!=="string" || ![prepared.binding.executed.sha256, fastHash(executedHtml)].includes(run.artifactHash)) throw Error("html-protection-existing-run-physical-subject-mismatch");
        const guard = async () => {
          const after = await assertServerHtmlProtectionOwner({ project, execution, active: true, scoringRouteFingerprint: before.scoringRouteFingerprint,selectionIdentitySha256 }, ports.owner);
          if (after.inputSha256 !== before.inputSha256 || after.subjectContextSha256 !== before.subjectContextSha256
            || after.missionContextSha256 !== before.missionContextSha256 || boundInput() !== inputSha256) throw Error("html-protection-input-or-subject-changed-during-collection");
        };
        const guardPhysical = async () => {
          await guard();
          const reread = await prepareServerHtmlProtectionAuthorityPlan({ project, candidate, testCase, criterionId: criterion.id, execution, ports: { getArtifact: physicalReader.getArtifact } });
          if (canonical(reread.binding) !== canonical(prepared.binding) || reread.planSha256 !== prepared.planSha256 || reread.semanticRequirementsSha256 !== prepared.semanticRequirementsSha256
            || !reread.physicalInputs.original.equals(prepared.physicalInputs.original) || !reread.physicalInputs.executed.equals(prepared.physicalInputs.executed)) throw Error("html-protection-final-physical-readback-drift");
          await physicalReader.assertStable();
          if (boundInput() !== inputSha256) throw Error("html-protection-final-physical-metadata-drift");
          await guard();
        };
        const unavailableRole = (sourceRole: "original" | "executed") => ({ manifest: { schemaVersion: "html-protection-native-unavailable-v1", sourceRole, binding: prepared.binding,
          execution, reason: "complete-native-producer-unavailable" }, records: [] as ServerHtmlProtectionAuthorityObservations["native"]["original"]["records"] });
        fallback = { prepared, execution, inputSha256, route: before.scoringRouteFingerprint, selection, guard: guardPhysical, native: { original: unavailableRole("original"), executed: unavailableRole("executed") } };
        const sourcePlan = htmlProtectionWholeRuntimeSourcePlan({ original: prepared.binding.original, html: originalHtml }), sourcePlanSha256 = sha(sourcePlan);
        const runtimeBinding = await readRuntime(), consume = createServerHtmlProtectionNativeRecordSink({ missionId: project.id, jobId: execution.jobId, store: ports.store });
        const observe = ports.observeWhole ?? collectServerHtmlProtectionWholeObservation;
        const originalRequest = HtmlProtectionWholeRuntimeRequestSchema.parse({ schemaVersion: "html-protection-whole-runtime-request-v1", binding: prepared.binding,
          execution, sourceRole: "original", sourcePlan, sourcePlanSha256, subjectScriptLocations: htmlProtectionWholeSubjectScriptLocations({ sourcePlan, html: originalHtml }) });
        const original = await observe({ request: originalRequest, physicalHtml: prepared.physicalInputs.original, consumeRecord: async (record, bytes) => { const saved = await consume("original", record, bytes); fallback!.native.original.records.push({ record, artifactId: saved.artifactId }); return saved; } });
        if (original.availability !== "available" || !original.manifest.registration) throw Error("html-protection-actual-original-runtime-unavailable");
        const executed = await observe({ request: HtmlProtectionWholeRuntimeRequestSchema.parse({ ...originalRequest, sourceRole: "executed", registration: original.manifest.registration,
          subjectScriptLocations: htmlProtectionWholeSubjectScriptLocations({ sourcePlan, html: executedHtml }) }),
          physicalHtml: prepared.physicalInputs.executed, consumeRecord: async (record, bytes) => { const saved = await consume("executed", record, bytes); fallback!.native.executed.records.push({ record, artifactId: saved.artifactId }); return saved; } });
        if (executed.availability !== "available") throw Error("html-protection-actual-executed-runtime-unavailable");
        const role = (value: typeof original) => ({ manifest: value.manifest, records: value.records.map(({ artifactId, ...record }) => ({ record, artifactId })) });
        await guard();
        const observations: ServerHtmlProtectionAuthorityObservations = { schemaVersion: "html-protection-authority-observations-v2", selectionIdentitySha256, collectionMode: "whole-native", native: { original: role(original), executed: role(executed) }, semanticRaw: [], visualRaw: [], gaps: [] };
        const roles = await readServerHtmlProtectionAuthorityNative({ prepared, native: observations.native, observationNotAfter: new Date(now()).toISOString(), runtimeBinding, store: ports.store });
        let derived = deriveServerHtmlProtectionAuthorityObservations({ prepared, roles, sourcePlan, semanticRaw: [], visualRaw: [], observedAt: new Date(now()).toISOString() });
        try { const result = await collectServerHtmlProtectionSemanticObservations({ components: derived.components, originalHtml, executedHtml, binding: prepared.binding,
          required: prepared.obligationPlan.requiredObligations, frozenRequirements: prepared.semanticRequirements }, async payload => { await guard(); const response = await (ports.observeSemantic ?? (async data => (await import("./ai-gateway")).runServerAi("html-protection-observe", data)))(payload); await guard(); return response; });
          observations.semanticRaw = result.raw; observations.gaps.push(...result.gaps);
        } catch { observations.gaps.push("html-protection-selected-model-semantic-observation-unavailable"); }
        try {
          const expectedDocumentStates = roles.original.manifest.expectedActions.filter(item => ["boot", "viewport"].includes(item.operation)).map(item => item.stateId);
          const pairs = prepareServerHtmlProtectionVisualPairs({ originalTiles: roles.original.records.filter(item => item.record.kind === "visual-tile").map(item => ({ stateId: item.record.stateId, material: item.material })),
            executedTiles: roles.executed.records.filter(item => item.record.kind === "visual-tile").map(item => ({ stateId: item.record.stateId, material: item.material })), expectedDocumentStates, nativeComplete: derived.runtime.completeNativeSequence });
          const result = await collectServerHtmlProtectionVisualObservations({ pairs, binding: prepared.binding, originalHtml, executedHtml, required: prepared.obligationPlan.requiredObligations,
            unresolvedRuntimeObligationIds: prepared.obligationPlan.requiredObligations.filter(item => item.evidenceKind === "browser" && !derived.runtime.supportedObligationIds.includes(item.id)).map(item => item.id) },
          async (payload, media) => { await guard(); const response = await (ports.observeVisual ?? (async (data, images) => (await import("./ai-gateway")).runServerAi("html-protection-visual-observe", data, images)))(payload, media); await guard(); return response; });
          observations.visualRaw = result.raw; observations.gaps.push(...result.gaps);
        } catch { observations.gaps.push("html-protection-selected-model-visual-observation-unavailable"); }
        await guard();
        const reread = await prepareServerHtmlProtectionAuthorityPlan({ project, candidate, testCase, criterionId: criterion.id, execution, ports: { getArtifact: physicalReader.getArtifact } });
        if (canonical(reread.binding) !== canonical(prepared.binding) || reread.planSha256 !== prepared.planSha256 || reread.semanticRequirementsSha256 !== prepared.semanticRequirementsSha256
          || !reread.physicalInputs.original.equals(prepared.physicalInputs.original) || !reread.physicalInputs.executed.equals(prepared.physicalInputs.executed)) throw Error("html-protection-physical-readback-drift");
        await guard();
        const observedAt = new Date(now()).toISOString(), expiresAt = new Date(now() + TTL_MS).toISOString();
        derived = deriveServerHtmlProtectionAuthorityObservations({ prepared: reread, roles, sourcePlan, semanticRaw: observations.semanticRaw, visualRaw: observations.visualRaw, observedAt });
        collected.push({ derived, observations, inputSha256, route: before.scoringRouteFingerprint, selection, execution, observedAt, expiresAt, guard: guardPhysical });
        } catch (error) {
          const message=error instanceof Error?error.message:"";
          collectionGaps.push(message.startsWith("html-protection-current-selection-unavailable:")||message==="html-protection-complete-saved-selection-unavailable"
            ?message:"html-protection-complete-collection-unavailable");
          if (fallback) try {
            await fallback.guard();
            const observedAt = new Date(now()).toISOString(), expiresAt = new Date(now() + TTL_MS).toISOString();
            const observations: ServerHtmlProtectionAuthorityObservations = { schemaVersion: "html-protection-authority-observations-v2", selectionIdentitySha256:serverAiPublicSelectionIdentity(fallback.selection), collectionMode: "physical-static",
              native: structuredClone(fallback.native), semanticRaw: [], visualRaw: [], gaps: ["complete-native-producer-unavailable"] };
            await readServerHtmlProtectionAuthorityStaticPrefix({ prepared: fallback.prepared, observations, execution: fallback.execution, store: ports.store });
            collected.push({ derived: deriveServerHtmlProtectionAuthorityStaticObservations({ prepared: fallback.prepared, observedAt }), observations,
              inputSha256: fallback.inputSha256, route: fallback.route, selection:fallback.selection, execution: fallback.execution, observedAt, expiresAt, guard: fallback.guard });
          } catch { /* Actual owner/physical drift prevents issuing even fallback authority. */ }
        }
      }
      if (!collected.length) {runs[index]={...run,trace:[...run.trace,{id:"html-protection-collection-capability-gap",stage:"assertion",status:"warning",summary:[...new Set(collectionGaps)].join("; ")||"html-protection-complete-collection-unavailable"}]};continue;}
      const failed = collected.some(item => item.derived.validation.failedObligationIds.length), next = { ...run,
        artifactHash: collected[0]!.derived.proof.binding.executed.sha256, htmlProtectionAuthorityRefs: undefined,
        htmlProtectionProof: collected.length === 1 ? collected[0]!.derived.proof : undefined };
      if (failed) { next.verificationStatus = "failed"; next.trace = [...run.trace, { id: "html-protection-observed-failure", stage: "assertion", status: "fail", summary: "Independent complete-file preservation observation retained a violation" }]; }
      let signed: ServerHtmlProtectionSigningConfig | undefined;
      try { signed = await readSigning(); } catch { /* Missing existing signer is a real capability gap; no new key is generated. */ }
      if (!signed) next.trace = [...next.trace, { id: "html-protection-signing-unavailable", stage: "assertion", status: "warning", summary: "Complete preservation authority cannot be restored without the existing purpose-bound server signer" }];
      const references: HtmlProtectionAuthorityReference[] = [];
      for (const item of collected) {
        await item.guard();
        if (!signed && item.derived.validation.passed) continue;
        if (signed) {
          const attestation = attestServerHtmlProtectionAuthority({ collected: { policyVersion: HTML_PROTECTION_AUTHORITY_POLICY, binding: item.derived.proof.binding,
            requiredObligations: item.derived.requiredObligations, trustedEvidence: item.derived.trustedEvidence, canonicalRun: next,
            execution: { ...item.execution, observedAt: item.observedAt, expiresAt: item.expiresAt } }, inputSha256: item.inputSha256, planSha256: item.derived.planSha256,
            observationSha256: serverHtmlProtectionObservationSha256(item.observations), scoringRouteFingerprint: item.route,selection:item.selection }, signed);
          references.push(await persistServerHtmlProtectionAuthorityEnvelope({ envelope: { schemaVersion: "html-protection-authority-envelope-v2", attestation,
            proof: item.derived.proof, canonicalRun: htmlProtectionCanonicalRun(next), observations: item.observations }, store: ports.store }));
        }
        await item.guard();
        const token = createHtmlProtectionAuthority({ project, testCase, proof: item.derived.proof, expectedBinding: item.derived.proof.binding,
          requiredObligations: item.derived.requiredObligations, trustedEvidence: item.derived.trustedEvidence, canonicalRun: next, policyVersion: HTML_PROTECTION_AUTHORITY_POLICY,
          observedAt: item.observedAt, expiresAt: item.expiresAt, now: now() });
        if (token) authorities.push(token);
      }
      runs[index] = { ...next, htmlProtectionAuthorityRefs: references.length ? references : undefined };
    }
    return { runs, authorities };
  };
}
/** Independently restore every physical input/native observation and the real original Job/SDK Run before minting a new in-memory token. */
export async function restoreServerHtmlProtectionAuthority(args: { project: EvolveProject; candidate?: Candidate; testCase: TestCase;
  run: TargetRunResult; reference: HtmlProtectionAuthorityReference; criterionId: string; acceptedCandidateId?: string }, ports: ServerHtmlProtectionAuthorityPorts = {}) {
  const now = ports.now ?? Date.now, reference = args.reference, execution = { executionId: reference.executionId, jobId: reference.jobId, generation: reference.generation };
  const context = await assertServerHtmlProtectionOwnerContext({project:args.project,execution,active:false},ports.owner);
  const envelope = await readServerHtmlProtectionAuthorityEnvelope({ reference, missionId: args.project.id, store: ports.store });
  if (canonical(htmlProtectionCanonicalRun(args.run)) !== canonical(envelope.canonicalRun)) throw Error("html-protection-current-canonical-run-drift");
  const physicalReader = createServerHtmlProtectionPhysicalReader({ project: args.project, store: ports.store, getArtifact: ports.getArtifact });
  const prepared = await prepareServerHtmlProtectionAuthorityPlan({ project: args.project, candidate: args.candidate, testCase: args.testCase,
    criterionId: args.criterionId, execution, acceptedCandidateId: args.acceptedCandidateId, ports: { getArtifact: physicalReader.getArtifact } });
  // This DTO is not trusted by the stored reader. Both purpose-separated signatures are authenticated below before any fresh selection check.
  const selectionIdentitySha256=serverAiPublicSelectionIdentity(envelope.attestation.selection);
  const boundInput = () => sha({ domain: serverHtmlProtectionBoundInputSha256(args.project, prepared.binding), semanticRequirementsSha256: prepared.semanticRequirementsSha256, physicalMetadata: physicalReader.metadataIdentity(),selectionIdentitySha256 });
  const inputSha256 = boundInput(), sourcePlan = htmlProtectionWholeRuntimeSourcePlan({ original: prepared.binding.original, html: prepared.physicalInputs.original.toString("utf8") });
  const provenance=authenticateServerHtmlProtectionAuthoritySelection({attestation:envelope.attestation,inputSha256,planSha256:reference.planSha256,
    observationSha256:serverHtmlProtectionObservationSha256(envelope.observations),scoringRouteFingerprint:reference.scoringRouteFingerprint,
    expectedBinding:prepared.binding,canonicalRun:args.run,policyVersion:HTML_PROTECTION_AUTHORITY_POLICY,expectedExecution:execution,now:now()},await (ports.readSigning??signing)());
  if(!provenance)throw Error("html-protection-selection-signature-context-invalid");
  const selection=readAuthenticatedServerHtmlProtectionSelection(provenance);
  const ownerCheck={project:args.project,execution,active:false,scoringRouteFingerprint:reference.scoringRouteFingerprint,selectionIdentitySha256,selectionProvenance:provenance};
  const before=await assertServerHtmlProtectionOwner(ownerCheck,ports.owner);
  if(before.inputSha256!==context.inputSha256||before.subjectContextSha256!==context.subjectContextSha256||before.missionContextSha256!==context.missionContextSha256)throw Error("html-protection-restoration-context-changed-during-authentication");
  let derived: Pick<ReturnType<typeof deriveServerHtmlProtectionAuthorityObservations>, "proof" | "validation" | "requiredObligations" | "trustedEvidence" | "planSha256">;
  if (envelope.observations.collectionMode === "physical-static") {
    await readServerHtmlProtectionAuthorityStaticPrefix({ prepared, observations: envelope.observations, execution, store: ports.store });
    derived = deriveServerHtmlProtectionAuthorityStaticObservations({ prepared, observedAt: envelope.attestation.executionAttestation.execution.observedAt });
  } else {
    const runtimeBinding = await (ports.readRuntime ?? readServerHtmlProtectionAuthorityRuntime)();
    const roles = await readServerHtmlProtectionAuthorityNative({ prepared, native: envelope.observations.native, observationNotAfter: envelope.attestation.executionAttestation.execution.observedAt, runtimeBinding, store: ports.store });
    derived = deriveServerHtmlProtectionAuthorityObservations({ prepared, roles, sourcePlan, semanticRaw: envelope.observations.semanticRaw,
      visualRaw: envelope.observations.visualRaw, observedAt: envelope.attestation.executionAttestation.execution.observedAt });
  }
  const restored = verifyServerHtmlProtectionAuthorityAttestation({ attestation: envelope.attestation, expectedBinding: prepared.binding,
    requiredObligations: derived.requiredObligations, canonicalRun: args.run, policyVersion: HTML_PROTECTION_AUTHORITY_POLICY, expectedExecution: execution, now: now(),
    inputSha256, planSha256: derived.planSha256, observationSha256: serverHtmlProtectionObservationSha256(envelope.observations), scoringRouteFingerprint: before.scoringRouteFingerprint,selection }, await (ports.readSigning ?? signing)());
  if (!restored || canonical(restored.trustedEvidence) !== canonical([...derived.trustedEvidence].sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    || canonical(envelope.proof) !== canonical(derived.proof)) throw Error("html-protection-independent-proof-reconstruction-mismatch");
  const after = await assertServerHtmlProtectionOwner(ownerCheck, ports.owner);
  if (after.inputSha256 !== before.inputSha256 || after.subjectContextSha256 !== before.subjectContextSha256 || after.missionContextSha256 !== before.missionContextSha256
    || boundInput() !== inputSha256) throw Error("html-protection-restoration-subject-or-owner-drift");
  const reread = await prepareServerHtmlProtectionAuthorityPlan({ project: args.project, candidate: args.candidate, testCase: args.testCase,
    criterionId: args.criterionId, execution, acceptedCandidateId: args.acceptedCandidateId, ports: { getArtifact: physicalReader.getArtifact } });
  if (canonical(reread.binding) !== canonical(prepared.binding) || reread.planSha256 !== prepared.planSha256 || reread.semanticRequirementsSha256 !== prepared.semanticRequirementsSha256
    || !reread.physicalInputs.original.equals(prepared.physicalInputs.original) || !reread.physicalInputs.executed.equals(prepared.physicalInputs.executed)) throw Error("html-protection-restoration-physical-input-drift");
  await physicalReader.assertStable();
  if (boundInput() !== inputSha256) throw Error("html-protection-restoration-final-physical-metadata-drift");
  const final = await assertServerHtmlProtectionOwner(ownerCheck, ports.owner);
  if (final.subjectContextSha256 !== before.subjectContextSha256 || final.missionContextSha256 !== before.missionContextSha256) throw Error("html-protection-restoration-final-owner-drift");
  const token=createHtmlProtectionAuthority({ project: args.project, testCase: args.testCase, proof: derived.proof, expectedBinding: prepared.binding,
    requiredObligations: derived.requiredObligations, trustedEvidence: derived.trustedEvidence, canonicalRun: args.run, policyVersion: HTML_PROTECTION_AUTHORITY_POLICY,
    observedAt: restored.execution.observedAt, expiresAt: restored.execution.expiresAt, now: now() });
  if(token){const entries=restoredSelections.get(args.project)??new Map();entries.set(canonical(reference),{provenance,selectionIdentitySha256,observedAt:restored.execution.observedAt,expiresAt:restored.execution.expiresAt,
    inputSha256:final.inputSha256,subjectContextSha256:final.subjectContextSha256,missionContextSha256:final.missionContextSha256});restoredSelections.set(args.project,entries);}
  return token;
}
export const collectServerHtmlProtectionAuthority = createServerHtmlProtectionAuthorityCollector();
