import {z} from "zod";
import {OutputArtifactSchema} from "./evolve-schemas";
/** Complete download facts only. DTOs never mint Core evidence or acceptance authority. */
const identity=z.string().min(1).max(512);
export const AcceptedPackageDownloadRequestSchema=z.object({missionId:identity,candidateId:identity}).strict();
export const AcceptedPackageDownloadIdentitySchema=AcceptedPackageDownloadRequestSchema.extend({acceptanceId:identity,validationId:identity}).strict();
export const AcceptedFileDownloadRequestSchema=AcceptedPackageDownloadRequestSchema.extend({sourceArtifactId:identity}).strict();
export const AcceptedFileDownloadIdentitySchema=AcceptedFileDownloadRequestSchema.extend({acceptanceId:identity,validationId:identity,blobId:identity,sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().nonnegative(),name:z.string().min(1),mimeType:z.string().min(1)}).strict();
export const AcceptedPackageDownloadArtifactSchema=OutputArtifactSchema.extend({packageIdentity:AcceptedPackageDownloadIdentitySchema}).strict();
const samePackage=(a:z.infer<typeof AcceptedPackageDownloadIdentitySchema>,b:z.infer<typeof AcceptedPackageDownloadIdentitySchema>)=>a.missionId===b.missionId&&a.candidateId===b.candidateId&&a.acceptanceId===b.acceptanceId&&a.validationId===b.validationId;
export const AcceptedPackageDownloadSchema=AcceptedPackageDownloadIdentitySchema.extend({schemaVersion:z.literal("accepted-package-download-v2"),targetSourceArtifactIds:z.array(identity).min(1).max(1000),artifacts:z.array(AcceptedPackageDownloadArtifactSchema).min(1).max(1000)}).strict().superRefine((value,ctx)=>{
  const targets=new Set(value.targetSourceArtifactIds),primary=value.artifacts.filter(item=>item.kind==="primary"),first=primary[0];
  if(targets.size!==value.targetSourceArtifactIds.length||primary.length!==targets.size||new Set(primary.map(item=>item.sourceArtifactIds[0])).size!==targets.size
    ||primary.some(item=>item.sourceArtifactIds.length!==1||!targets.has(item.sourceArtifactIds[0]!)||!item.frozenArtifact||item.frozenArtifact.sourceArtifactId!==item.sourceArtifactIds[0]||item.mimeType!==item.frozenArtifact.mimeType))
    ctx.addIssue({code:"custom",message:"Accepted package primary Target coverage is incomplete or duplicated"});
  if(new Set(value.artifacts.map(item=>item.id)).size!==value.artifacts.length||value.artifacts.some(item=>item.projectId!==value.missionId||item.candidateId!==value.candidateId||!item.accepted||!samePackage(item.packageIdentity,value)
    ||!first||item.round!==first.round||item.versionLabel!==first.versionLabel||item.isChampion!==first.isChampion||new Set(item.sourceArtifactIds).size!==item.sourceArtifactIds.length||item.kind!=="primary"&&item.frozenArtifact!==undefined))
    ctx.addIssue({code:"custom",message:"Accepted package artifact identity drift"});
});
/** Compare against independently supplied current project facts; the port cannot select its own expected Target set. */
export function assertAcceptedPackageDownloadContext(raw:unknown,expected:z.infer<typeof AcceptedPackageDownloadIdentitySchema>&{targetSourceArtifactIds:readonly string[];sourceArtifactIds:readonly string[]}){
  const value=AcceptedPackageDownloadSchema.parse(raw),targets=new Set(expected.targetSourceArtifactIds),sources=new Set(expected.sourceArtifactIds);
  if(!samePackage(value,AcceptedPackageDownloadIdentitySchema.parse({missionId:expected.missionId,candidateId:expected.candidateId,acceptanceId:expected.acceptanceId,validationId:expected.validationId})))throw Error("Accepted package current acceptance identity drift");
  if(!targets.size||targets.size!==expected.targetSourceArtifactIds.length||sources.size!==expected.sourceArtifactIds.length||[...targets].some(id=>!sources.has(id)))throw Error("Accepted package current Target identity is incomplete or duplicated");
  if(value.targetSourceArtifactIds.length!==targets.size||value.targetSourceArtifactIds.some(id=>!targets.has(id)))throw Error("Accepted package current Target set drift");
  if(value.artifacts.some(item=>item.sourceArtifactIds.some(id=>!sources.has(id))))throw Error("Accepted package artifact references foreign Source");
  return value;
}
export type AcceptedPackageDownload=z.infer<typeof AcceptedPackageDownloadSchema>;
export type AcceptedFileDownloadIdentity=z.infer<typeof AcceptedFileDownloadIdentitySchema>;
export interface AcceptedPackageDownloadPort {
  package(input:z.infer<typeof AcceptedPackageDownloadRequestSchema>):Promise<AcceptedPackageDownload>;
  file(input:z.infer<typeof AcceptedFileDownloadRequestSchema>):Promise<Readonly<{identity:Readonly<AcceptedFileDownloadIdentity>;bytes:Uint8Array}>>;
}
