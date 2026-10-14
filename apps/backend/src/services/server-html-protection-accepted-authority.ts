import { createHash } from "node:crypto";
import { CandidateSchema, EvolveProjectSchema, FrozenArtifactSchema, type EvolveProject, type Candidate } from "@evolution/contracts";
import { bindHtmlProtectionAuthorities, deliveryReadiness, evidenceFingerprint, hasExactFrozenArtifactSet, hasAuthoritativeHiddenRelease,
  hasHtmlProtectionTarget, htmlProtectionAcceptanceBlocker, invalidateHtmlProtectionAuthorities, isWholeProtectionCriterion } from "@evolution/core";
import { getServerMissionEnvelope } from "./production-runtime";
import { htmlProtectionCanonicalJson as canonical } from "./server-html-protection-authority-attestation";
import { restoreServerHtmlProtectionAuthority, assertServerHtmlProtectionRestoredOwner, type ServerHtmlProtectionAuthorityPorts } from "./server-html-protection-authority";
import { assertServerHtmlProtectionOwnerContext } from "./server-html-protection-authority-owner";
import { serverHtmlProtectionHistoricalCurrent } from "./server-html-protection-authority-plan";
import { createServerHtmlProtectionPhysicalReader } from "./server-html-protection-authority-artifact-reader";
export type ServerHtmlProtectionAcceptedPorts = ServerHtmlProtectionAuthorityPorts & {
  readMission?: (id: string) => Promise<EvolveProject | undefined>;
  restore?: typeof restoreServerHtmlProtectionAuthority;
  assertRestoredOwner?:typeof assertServerHtmlProtectionRestoredOwner;
};
/** Exact current acceptance context. Historical rows are readable but cannot replace a current accepted relationship. */
export function serverHtmlProtectionAcceptedContext(project: EvolveProject) {
  const { updatedAt, ...material } = project; void updatedAt;
  return canonical(material);
}
function validationCandidate(project:EvolveProject,candidateId:string):Candidate {
  const matches=project.candidates.filter(item=>item.id===candidateId);
  if(matches.length!==1)throw Error("html-protection-accepted-candidate-ambiguous");
  const candidate=CandidateSchema.parse(matches[0]),validation=project.validationRun;
  if(project.experimentRun.winnerId!==candidateId||!hasAuthoritativeHiddenRelease(validation,candidateId,project.hiddenEvalSuite)
    ||validation.evidenceFingerprint!==evidenceFingerprint(project,candidate))throw Error("html-protection-current-hidden-unaccepted");
  return candidate;
}
function acceptedCandidate(project: EvolveProject, candidateId: string): Candidate {
  const candidate=validationCandidate(project,candidateId),validation=project.validationRun,acceptance=project.artifactAcceptance,champion=project.searchChampion;
  if (champion?.candidate?.id === candidateId && (canonical(champion.candidate) !== canonical(candidate)
    || canonical(champion.validation) !== canonical(validation) || canonical(champion.artifactAcceptance) !== canonical(acceptance))) throw Error("html-protection-accepted-champion-current-relation-drift");
  if (acceptance.status !== "passed" || !acceptance.hardGatePass || acceptance.candidateId !== candidateId
    || !hasExactFrozenArtifactSet(project,candidate,acceptance) || acceptance.evidenceFingerprint !== validation.evidenceFingerprint) throw Error("html-protection-current-hidden-or-gate-f-unaccepted");
  return candidate;
}
/** Restore both same-Hidden arms from all actual stored material before any delivery decision. Never trust a public ready flag. */
export async function restoreServerHtmlProtectionValidationProject(args: { project: EvolveProject; candidateId: string }, ports: ServerHtmlProtectionAcceptedPorts = {}) {
  const project = EvolveProjectSchema.parse(structuredClone(args.project)), candidate = validationCandidate(project,args.candidateId), context = serverHtmlProtectionAcceptedContext(project);
  const readMission = ports.readMission ?? ports.owner?.readMission ?? (async id => (await getServerMissionEnvelope(id))?.payload);
  const criteria=project.acceptanceRubric.filter(isWholeProtectionCriterion),refs=[...project.validationRun.baselineRuns,...project.validationRun.runs]
    .flatMap(run=>run.htmlProtectionAuthorityRefs??[]).filter(ref=>criteria.some(criterion=>criterion.id===ref.criterionId));
  const physical=createServerHtmlProtectionPhysicalReader({project,store:ports.store,getArtifact:ports.getArtifact});
  const current=project.searchChampion?.candidate?.id===candidate.id?serverHtmlProtectionHistoricalCurrent(project,candidate.id):project.searchChampion?.candidate;
  for(const source of project.sourceArtifacts.filter(item=>item.role==="target")){
    if(source.inputMode!=="paste"||source.storageRef?.trim())await physical.getArtifact(source.storageRef?.trim()||source.id);
    for(const subject of [candidate,current].filter((item):item is Candidate=>Boolean(item))){
      const snapshots=subject.artifactSnapshots.filter(item=>item.sourceArtifactId===source.id),frozen=snapshots.length===1?snapshots[0]!.frozenArtifact:undefined;
      if(!frozen)throw Error("html-protection-accepted-full-physical-subject-unavailable");await physical.getArtifact(frozen.blobId);
    }
  }
  let restoredAuthority=false;
  const checkOwners=async()=>{
    const seen=new Set<string>();
    for(const reference of refs){const identity=canonical(reference);
      if(seen.has(identity))continue;seen.add(identity);
      if(restoredAuthority)await (ports.assertRestoredOwner??assertServerHtmlProtectionRestoredOwner)({project,reference},ports);
      else await assertServerHtmlProtectionOwnerContext({project,execution:{jobId:reference.jobId,executionId:reference.executionId,generation:reference.generation},active:false},ports.owner);
    }
  };
  const stable = async () => {
    const readContext=async()=>{const stored=await readMission(project.id);
      if(!stored||serverHtmlProtectionAcceptedContext(EvolveProjectSchema.parse(stored))!==context||serverHtmlProtectionAcceptedContext(project)!==context)throw Error("html-protection-accepted-context-changed");
      validationCandidate(stored,candidate.id);
    };
    await readContext();await checkOwners();await physical.assertStable();await checkOwners();await readContext();
    if(restoredAuthority){const blocker=htmlProtectionAcceptanceBlocker(project);if(blocker)throw Error(blocker);}
  };
  await stable();
  if (hasHtmlProtectionTarget(project)) {
    const criteria = project.acceptanceRubric.filter(isWholeProtectionCriterion), tests = project.hiddenEvalSuite;
    invalidateHtmlProtectionAuthorities(project,{testCaseIds:tests.map(item=>item.id),subject:"current"});
    invalidateHtmlProtectionAuthorities(project,{testCaseIds:tests.map(item=>item.id),subject:{candidateId:candidate.id}});
    const authorities = [];
    for (const arm of ["current","candidate"] as const) for (const testCase of tests) {
      const runs = arm === "current" ? project.validationRun.baselineRuns : project.validationRun.runs;
      const matched = runs.filter(item=>item.testCaseId===testCase.id);
      if(matched.length!==1)throw Error("html-protection-accepted-hidden-run-ambiguous");
      const run=matched[0]!;
      for (const criterion of criteria.filter(item=>testCase.criterionIds.includes(item.id))) {
        const refs=run.htmlProtectionAuthorityRefs?.filter(item=>item.criterionId===criterion.id)??[];
        if(refs.length!==1)throw Error("html-protection-accepted-hidden-reference-missing");
        await stable();
        const token=await (ports.restore??restoreServerHtmlProtectionAuthority)({project,candidate:arm==="candidate"?candidate:undefined,testCase,run,reference:refs[0]!,criterionId:criterion.id,acceptedCandidateId:candidate.id},ports);
        await stable();
        if(!token)throw Error("html-protection-accepted-independent-restoration-failed");
        authorities.push(token);
      }
    }
    if(!bindHtmlProtectionAuthorities(project,authorities))throw Error("html-protection-accepted-capability-subject-drift");
  }
  restoredAuthority=true;
  await stable();
  const blocker=htmlProtectionAcceptanceBlocker(project);
  if(blocker)throw Error(blocker);
  return {project,candidate,assertStable:stable};
}
/** Gate F remains an independent requirement after same-Hidden restoration. */
export async function restoreServerHtmlProtectionAcceptedProject(args:{project:EvolveProject;candidateId:string},ports:ServerHtmlProtectionAcceptedPorts={}) {
  const restored=await restoreServerHtmlProtectionValidationProject(args,ports);
  acceptedCandidate(restored.project,args.candidateId);
  if(!deliveryReadiness(restored.project).ready)throw Error("html-protection-accepted-delivery-not-ready");
  const assertStable=async()=>{await restored.assertStable();acceptedCandidate(restored.project,args.candidateId);if(!deliveryReadiness(restored.project).ready)throw Error("html-protection-accepted-delivery-not-ready");};
  await assertStable();
  return {...restored,assertStable};
}
/** Return the already accepted immutable byte sequence. All targets are re-read; no rendering or copying creates a new primary file. */
export async function readServerHtmlProtectionAcceptedFile(args: { project:EvolveProject;candidateId:string;sourceArtifactId:string },ports:ServerHtmlProtectionAcceptedPorts={}) {
  const restored=await restoreServerHtmlProtectionAcceptedProject(args,ports),{project,candidate}=restored;
  const receiptMatches=project.artifactAcceptance.frozenArtifacts?.filter(item=>item.sourceArtifactId===args.sourceArtifactId)??[];
  if(receiptMatches.length!==1)throw Error("html-protection-accepted-target-ambiguous");
  const requested=FrozenArtifactSchema.parse(receiptMatches[0]), reader=createServerHtmlProtectionPhysicalReader({project,store:ports.store,getArtifact:ports.getArtifact});
  let requestedBlob:Blob|undefined;
  for (const source of project.sourceArtifacts.filter(item=>item.role==="target")) {
    const originals=source.inputMode==="paste"&&!source.storageRef?.trim()?undefined:await reader.getArtifact(source.storageRef?.trim()||source.id); void originals;
    const matches=candidate.artifactSnapshots.filter(item=>item.sourceArtifactId===source.id), receipt=matches.length===1?matches[0]!.frozenArtifact:undefined;
    if(!receipt)throw Error("html-protection-accepted-full-target-set-unavailable");
    const blob=await reader.getArtifact(receipt.blobId);
    if(source.id===args.sourceArtifactId)requestedBlob=blob;
  }
  await reader.assertStable();await restored.assertStable();
  if(!requestedBlob)throw Error("html-protection-accepted-exact-file-missing");
  const bytes=Buffer.from(await requestedBlob.arrayBuffer());
  await reader.assertStable();await restored.assertStable();
  if(bytes.length!==requested.size||createHash("sha256").update(bytes).digest("hex")!==requested.sha256)throw Error("html-protection-accepted-download-byte-drift");
  return Object.freeze({get bytes(){return new Uint8Array(bytes);},identity:Object.freeze({missionId:project.id,candidateId:candidate.id,sourceArtifactId:requested.sourceArtifactId,
    acceptanceId:project.artifactAcceptance.id,validationId:project.validationRun.id,blobId:requested.blobId,sha256:requested.sha256,size:requested.size,name:requested.name,mimeType:requested.mimeType})});
}
