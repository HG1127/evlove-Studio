import type {Candidate,EvolveProject,SourceArtifact,TargetRunResult,TestCase} from "@evolution/contracts";
import {isZipArtifact,resolveTestTargetArtifact,fastHash} from "@evolution/core";
import {trustedServerBaselineChampion} from "@evolution/harness";
import {runVercelSandboxCodebaseValidation} from "@evolution/adapters/sandbox";
import {getServerArtifactStore} from "./artifact-runtime";
import {serverArtifactSha256} from "./server-experiment-artifacts";
import {runServerHtmlArtifactBatch} from "./server-html-artifact-execution";
import {attachServerVisualEvidence} from "./server-visual-evidence";

type Phase="baseline"|"experiment"|"holdout-baseline"|"holdout";
export function resolveServerZipTargetBinding(project:EvolveProject,source:SourceArtifact,candidate?:Candidate){
  const current=candidate??trustedServerBaselineChampion(project);
  const snapshots=current?.artifactSnapshots.filter(snapshot=>snapshot.sourceArtifactId===source.id)??[];
  if((candidate||project.searchChampion)&&snapshots.length!==1)return{source,blobId:undefined,candidateId:current?.id,
    reason:"当前 Search Champion 或 Candidate 缺少唯一 Artifact Snapshot；必须保留唯一可信的 Target 绑定，不能回退原 Source ZIP。"};
  const snapshot=snapshots[0];
  if(snapshot&&!snapshot.frozenArtifact)return{source,blobId:undefined,candidateId:current?.id,
    reason:"当前 Candidate 尚未冻结实际 ZIP，不能回退原 Source ZIP。"};
  const receipt=snapshot?.frozenArtifact;
  if(receipt?.sourceArtifactId!==undefined&&receipt.sourceArtifactId!==source.id)return{source,blobId:undefined,
    candidateId:current?.id,reason:"冻结 ZIP receipt 与 Target 身份不一致。"};
  return{source,blobId:receipt?.blobId??(source.storageRef?.trim()||source.id),candidateId:snapshot?current?.id:undefined,
    sha256:receipt?.sha256,size:receipt?.size,reason:undefined};
}
function unavailable(test:TestCase,message:string):TargetRunResult{
  return{testCaseId:test.id,output:"UNVERIFIED："+message,latencyMs:0,cost:0,verificationStatus:"unverified",
    trace:[{id:"artifact-external-"+test.id,stage:test.executionMode,summary:"目标文件执行证据未完成",status:"warning",detail:message}]};
}
/** Shared by Baseline, Experiment and paired Hidden. Each batch executes one exact target. */
export async function executeServerArtifactExternal(project:EvolveProject,testCases:TestCase[],phase:Phase,candidate?:Candidate):Promise<TargetRunResult[]>{
  const groups=new Map<string,{source:SourceArtifact;cases:TestCase[]}>();
  const ordered=new Map<string,TargetRunResult>();
  for(const test of testCases){
    try{
      const source=resolveTestTargetArtifact(project,test);
      if(!source)throw Error("没有可执行的 Target Artifact。");
      const group=groups.get(source.id)??{source,cases:[]};
      group.cases.push(test);groups.set(source.id,group);
    }catch(error){ordered.set(test.id,unavailable(test,error instanceof Error?error.message:String(error)));}
  }
  for(const {source,cases} of groups.values()){
    try{
      let runs:TargetRunResult[];
      if(/^(html|htm)$/i.test(source.extension)){
        runs=candidate?await runServerHtmlArtifactBatch(project,cases,candidate):await runServerHtmlArtifactBatch(project,cases);
      }else if(isZipArtifact(source)){
        const binding=resolveServerZipTargetBinding(project,source,candidate);
        if(!binding.blobId)throw Error(binding.reason);
        const blob=await getServerArtifactStore().get(binding.blobId);
        if(!blob)throw Error("找不到当前版本 Artifact Blob "+binding.blobId);
        const archive=new Uint8Array(await blob.arrayBuffer());
        if(binding.size!==undefined&&archive.byteLength!==binding.size)throw Error("ZIP 大小与冻结凭证不一致。");
        const sha256=await serverArtifactSha256(archive);
        if(binding.sha256&&sha256!==binding.sha256)throw Error("ZIP SHA-256 与冻结凭证不一致。");
        const suffix=project.sourceArtifacts.filter(source=>source.role==="target"&&isZipArtifact(source)).length>1?"-"+source.id:"";
        const response=await runVercelSandboxCodebaseValidation({
          id:`${project.id}-${phase}-${binding.candidateId??"source"}${suffix}-${fastHash(cases)}`,
          archive,expectedSha256:binding.sha256,testCases:cases,
        });
        if(response.results.some(run=>run.artifactHash&&run.artifactHash!==sha256))throw Error("Runner 证据与执行 ZIP 的 SHA-256 不一致。");
        runs=await attachServerVisualEvidence(project,cases,response.results);
      }else throw Error(source.name+" 暂无实际运行/视觉 Runner；格式和静态证据不能代替产品行为。");
      const ids=new Set(cases.map(test=>test.id));
      if(new Set(runs.map(run=>run.testCaseId)).size!==runs.length||runs.some(run=>!ids.has(run.testCaseId)))throw Error("Runner 返回重复或未绑定的 Test Case。");
      for(const run of runs)ordered.set(run.testCaseId,run);
      for(const test of cases)if(!ordered.has(test.id))ordered.set(test.id,unavailable(test,"Runner 未返回本题结果。"));
    }catch(error){for(const test of cases)ordered.set(test.id,unavailable(test,error instanceof Error?error.message:String(error)));}
  }
  return testCases.map(test=>ordered.get(test.id)!);
}
