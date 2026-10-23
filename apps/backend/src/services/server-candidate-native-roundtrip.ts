import type {Candidate,CandidateArtifactSnapshot,EvolveProject,TestCase} from "@evolution/contracts";
import {requiresIndependentFormatValidation} from "@evolution/core";
import {getServerArtifactStore} from "./artifact-runtime";
import {serverArtifactSha256,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
import {hasServerNativeRoundtrip,inspectServerNativeFormat} from "./server-native-format-roundtrip";

export async function verifyServerCandidateNativeFormats(args:{
  project:EvolveProject;candidate:Candidate;testCase:TestCase;
  snapshots:CandidateArtifactSnapshot[];
}):Promise<{passed:boolean;detail:string}>{
  if(args.testCase.evidenceScope==="product-behavior")return{
    passed:false,detail:"原生格式可解析不能证明运行、视觉效果或公式计算；必须使用独立 Runner。",
  };
  const byId=new Map(args.project.sourceArtifacts.filter(s=>s.role==="target").map(s=>[s.id,s]));
  const found=new Set<string>();
  const messages:string[]=[];
  try{
    for(const snapshot of args.snapshots){
      if(found.has(snapshot.sourceArtifactId))throw Error("重复的 Candidate Source");
      found.add(snapshot.sourceArtifactId);
      const source=byId.get(snapshot.sourceArtifactId);
      const receipt=snapshot.frozenArtifact;
      if(!source||!receipt)throw Error("Target 或冻结凭证缺失");
      // In mixed Missions pure-text files were verified by the exact-byte port.
      // Unrecognized binary formats fail closed until a native validator exists.
      if(!requiresIndependentFormatValidation(source.extension))continue;
      if(!hasServerNativeRoundtrip(source.extension))throw Error("该格式尚未接入独立原生往返校验器");
      if(!await verifyServerCandidateFrozenArtifact(snapshot))throw Error("冻结 Blob 的身份/哈希不一致");
      const blob=await getServerArtifactStore().get(receipt.blobId);
      if(!blob||blob.size!==receipt.size||blob.size>25_000_000)throw Error("原生文件缺失或超出校验上限");
      const bytes=new Uint8Array(await blob.arrayBuffer());
      if(await serverArtifactSha256(bytes)!==receipt.sha256)throw Error("冻结文件 SHA-256 不一致");
      messages.push(source.name+": "+await inspectServerNativeFormat({source,bytes,snapshot}));
    }
    if(!found.size)return{passed:false,detail:"没有可验证的原生 Target"};
    return{passed:true,detail:messages.join("；")};
  }catch(error){
    return{passed:false,detail:error instanceof Error?error.message:String(error)};
  }
}
