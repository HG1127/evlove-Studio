import {createHash} from "node:crypto";
import {createError} from "nitro/h3";
import {ArtifactMetadataSchema,ConfirmationEvidenceCatalogSchema,ConfirmationServerTrustSchema,PAIRED_CRITERION_EVIDENCE_POLICY,
  JudgeCalibrationPlanV3Schema,JudgeCalibrationObservationSchema,type ArtifactStorePort,type EvolveProject} from "@evolution/contracts";
import {confirmationMissionScopeText,fastHash,registeredZeroReferenceCriterionIds,zeroOutcomeReferenceCriterionIds} from "@evolution/core";
import {checkFullConfirmationAdmission} from "@evolution/harness";
import {getEvolutionWorkspaceId} from "../server-env";
import {getServerArtifactStore} from "./artifact-runtime";
import {serverAiScoringRouteFingerprint} from "./ai-gateway";
import {serverAiPairedOutcomeReferenceMode} from "./server-ai-output-policy";

type Ref={artifactId:string;sha256:string};
const sha=(bytes:string|Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const decode=(bytes:Uint8Array)=>new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);

/** Read only through the configured workspace's private store; never trust metadata without the bytes. */
function checkedReader(store:ArtifactStorePort){
  const cache=new Map<string,Promise<Uint8Array>>();
  return (ref:Ref)=>{
    const key=ref.artifactId+":"+ref.sha256;
    if(!cache.has(key))cache.set(key,(async()=>{
      const metadata=ArtifactMetadataSchema.parse(await store.getMetadata?.(ref.artifactId));
      if(metadata.id!==ref.artifactId||metadata.sha256!==ref.sha256||metadata.sizeBytes>5_242_880)
        throw Error("Evidence metadata differs or exceeds the read limit");
      const blob=await store.get(ref.artifactId);
      if(!blob||blob.size!==metadata.sizeBytes)throw Error("Evidence bytes are unavailable or incomplete");
      const bytes=new Uint8Array(await blob.arrayBuffer());
      if(sha(bytes)!==ref.sha256)throw Error("Evidence content hash differs");
      return bytes;
    })());
    return cache.get(key)!;
  };
}

/**
 * New full-confirmation Missions require an out-of-band server-pinned evidence catalog.
 * A pin attests that a trusted registrar checked real provenance/independence, not just JSON shape.
 * This function rechecks content and all existing calibration/application gates; it grants no budget.
 */
export async function assertServerConfirmationAdmission(mission:EvolveProject,phase:"registration"|"execution"){
  const reference=mission.experimentPolicy?.confirmationAdmission;
  const rawTrust=process.env.EVOLUTION_CONFIRMATION_TRUST?.trim();
  if(!reference&&!rawTrust)return;
  try{
    const trust=rawTrust?ConfirmationServerTrustSchema.parse(JSON.parse(rawTrust)):undefined;
    const pin=trust?.missions.find(m=>m.missionId===mission.id);
    // The server pin prevents omission of the policy reference from bypassing a protected Mission.
    if(!pin&&!reference)return;
    if(!pin||!reference||pin.catalogSha256!==reference.catalogSha256)
      throw Error("Full confirmation has no matching trusted server catalog pin");
    if(mission.experimentPolicy.judgeComparison!=="paired-two-order-v1")throw Error("Paired judgment is required");
    const store=getServerArtifactStore(),read=checkedReader(store);
    const catalog=ConfirmationEvidenceCatalogSchema.parse(JSON.parse(decode(await read({artifactId:pin.catalogArtifactId,sha256:pin.catalogSha256}))));
    const request=catalog.request;
    const runtimeCommit=process.env.VERCEL_GIT_COMMIT_SHA?.trim()||process.env.EVOLUTION_RUNTIME_COMMIT_SHA?.trim();
    if(catalog.workspaceId!==getEvolutionWorkspaceId()||catalog.missionId!==mission.id
      ||catalog.missionScopeSha256!==sha(confirmationMissionScopeText(mission))
      ||request.sourceCommit!==runtimeCommit||request.scoringRouteFingerprint!==await serverAiScoringRouteFingerprint()
      ||request.rubricFingerprint!==fastHash(mission.acceptanceRubric)||request.suiteFingerprint!==fastHash(mission.evalSuite)
      ||request.plannedWindowMs!==(mission.campaign.stopCriteria.maxWallMinutes??0)*60_000)
      throw Error("Confirmation code/model/Mission/source policy/paper/window identity differs");
    if(catalog.sources.length!==mission.sourceArtifacts.length||new Set(mission.sourceArtifacts.map(s=>s.id)).size!==catalog.sources.length)
      throw Error("Source identities are incomplete or duplicated");
    for(const source of mission.sourceArtifacts){
      const binding=catalog.sources.find(s=>s.sourceArtifactId===source.id);
      if(!binding||source.storageRef!==binding.artifactId||source.size!==binding.sizeBytes)
        throw Error("Source metadata differs from the frozen input");
      // Mission is created before its FK-bound Artifact upload. Inline bytes must remain exact on continuation too.
      if(source.textContent===undefined||Buffer.byteLength(source.textContent)!==binding.sizeBytes||sha(source.textContent)!==binding.sha256)
        throw Error("Full confirmation requires exact approved raw source bytes; parsed text cannot certify a binary file");
      if(phase==="execution"){
        const bytes=await read(binding),metadata=ArtifactMetadataSchema.parse(await store.getMetadata?.(binding.artifactId));
        if(bytes.byteLength!==binding.sizeBytes||metadata.missionId!==mission.id)throw Error("Stored source custody differs");
      }
    }
    const plan=JudgeCalibrationPlanV3Schema.parse(JSON.parse(decode(await read(catalog.plan))));
    const outcomeReferencePolicy=serverAiPairedOutcomeReferenceMode();
    if(outcomeReferencePolicy){
      const eligible=zeroOutcomeReferenceCriterionIds(plan.criteria),registered=registeredZeroReferenceCriterionIds(plan);
      if(eligible.length!==registered.length||eligible.some(id=>!registered.includes(id)))
        throw Error("Configured outcome reference differs from the frozen calibration registration");
    }
    if(plan.id!==request.calibrationPlanId||plan.preregistrationSha256!==catalog.preregistrationSha256
      ||plan.oracleApprovalSha256!==catalog.oracleApprovalSha256
      ||JSON.stringify(plan.criteria)!==JSON.stringify(mission.acceptanceRubric)
      ||JSON.stringify(plan.testCases)!==JSON.stringify(mission.evalSuite))throw Error("Calibration approval or full rubric/paper identities differ");
    const targets=catalog.sources.filter(s=>mission.sourceArtifacts.some(a=>a.id===s.sourceArtifactId&&a.role==="target"));
    for(const control of plan.controls){
      if(!targets.length||control.context.missionId!==mission.id||control.context.bindings.length!==targets.length
        ||control.context.bindings.some(b=>!targets.some(s=>s.sourceArtifactId===b.sourceArtifactId)))
        throw Error("Calibration control scope differs from the intended Mission");
    }
    if(!plan.controls.some(c=>c.kind==="identical"&&targets.every(s=>c.context.bindings.some(b=>
      b.sourceArtifactId===s.sourceArtifactId&&b.originalSha256===s.sha256&&b.candidateSha256===s.sha256))))
      throw Error("Calibration lacks an exact identical control for the intended original files");
    const evidence=new Map(catalog.artifacts.map(a=>[a.sha256,a]));
    const evidenceBytes=async(hash:string)=>{
      const ref=evidence.get(hash);if(!ref)throw Error("Evidence is not in the trusted catalog");return read(ref);
    };
    const result=await checkFullConfirmationAdmission(request,{
      readCalibrationPlan:async()=>plan,
      readCalibrationObservations:async()=>Promise.all(catalog.observations.map(async ref=>{
        const observation=JudgeCalibrationObservationSchema.parse(JSON.parse(decode(await read(ref))));
        if(outcomeReferencePolicy&&(observation.receipt.outcomeReferencePolicy!==outcomeReferencePolicy
          ||observation.receipt.evidenceStatusPolicy!==PAIRED_CRITERION_EVIDENCE_POLICY))
          throw Error("Calibration observation omits the configured outcome reference policy");
        return observation;
      })),
      verifyPreregistration:async hash=>hash===catalog.preregistrationSha256&&Boolean(await evidenceBytes(hash)),
      verifyOracleApproval:async hash=>hash===catalog.oracleApprovalSha256&&Boolean(await evidenceBytes(hash)),
      readApplicationEvidence:async hash=>JSON.parse(decode(await evidenceBytes(hash))),
      verifyEvidenceArtifact:async hash=>Boolean(await evidenceBytes(hash)),
      readText:async hash=>decode(await evidenceBytes(hash)),sha256Utf8:async text=>sha(text),
    });
    if(!result.ready)throw Error(result.blockers.join("; "));
    return result;
  }catch{
    // Do not echo private source, catalog contents, provider settings or parser diagnostics to the caller.
    throw createError({statusCode:422,statusMessage:"完整确认试验的校准或应用证据未通过，禁止登记或启动",
      data:{code:"CONFIRMATION_ADMISSION_REQUIRED",phase,missionId:mission.id}});
  }
}
