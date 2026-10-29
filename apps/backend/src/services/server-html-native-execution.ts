import {HTML_NATIVE_PAYMENT_REQUIRED,HTML_NATIVE_LOCAL_UNAVAILABLE,HtmlNativeBrowserAssertionsSchema,OriginalArtifactReferenceProofSchema,SandboxHtmlNativeResponseSchema,TargetRunResultSchema,
  type ArtifactStorePort,type Candidate,type CandidateArtifactSnapshot,type EvolveProject,
  type SandboxHtmlNativeRequest,type SandboxHtmlNativeResponse,type SourceArtifact,type TargetRunResult,type TestCase} from "@evolution/contracts";
import {fastHash,htmlNativeBrowserPlanKey,htmlNativeCaseSource,isSourceGroundedHtmlSearchPlan} from "@evolution/core";
import {getServerArtifactStore} from "./artifact-runtime";
import {serverArtifactSha256,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
import {serverNativeHtmlRuntime} from "./server-html-native-runtime";
import {assertServerControlExecutionActive,ServerControlExecutionStoppedError} from "./server-control-execution";

type Request={project:EvolveProject;testCases:TestCase[];candidate?:Candidate};
type Ports={artifacts:ArtifactStorePort;authorized:(missionId:string)=>boolean;unavailableCode?:typeof HTML_NATIVE_LOCAL_UNAVAILABLE;
  verifyFrozen:(snapshot:CandidateArtifactSnapshot)=>Promise<boolean>;
  execute:(request:SandboxHtmlNativeRequest)=>Promise<SandboxHtmlNativeResponse>};
const limit=12_000_000;

async function originalBytes(project:EvolveProject,source:SourceArtifact,ports:Ports){
  const id=source.storageRef?.trim()||(source.inputMode==="upload"?source.id:undefined);
  if(!id||!ports.artifacts.getMetadata)throw Error("Physical Original metadata is unavailable");
  const [blob,metadata]=await Promise.all([ports.artifacts.get(id),ports.artifacts.getMetadata(id)]);
  if(!blob||!metadata||metadata.id!==id||metadata.missionId!==project.id||metadata.kind!=="source"
    ||blob.size!==source.size||metadata.sizeBytes!==blob.size||!blob.size||blob.size>limit)throw Error("Physical Original scope or size differs");
  const bytes=new Uint8Array(await blob.arrayBuffer()),sha256=await serverArtifactSha256(bytes);
  if(sha256!==metadata.sha256||bytes.byteLength!==blob.size)throw Error("Physical Original SHA differs");
  const refs=project.baselineRun.originalReferences?.filter(ref=>ref.sourceArtifactId===source.id)??[];
  if(refs.length){
    const ref=OriginalArtifactReferenceProofSchema.safeParse(refs[0]);
    if(refs.length!==1||!ref.success||ref.data.missionId!==project.id||ref.data.blobId!==id
      ||ref.data.sha256!==sha256||ref.data.sizeBytes!==bytes.byteLength)throw Error("Locked Original reference differs");
  }
  return {bytes,sha256};
}

/** Server composition only. Local capability failures stop dependent execution. */
export function createServerHtmlNativeExecutor(ports:Ports){
  return async({project,testCases,candidate}:Request):Promise<TargetRunResult[]>=>{
    if(!ports.authorized(project.id)||!candidate&&project.searchChampion)return [];
    const groups=new Map<string,{source:SourceArtifact;tests:TestCase[]}>();
    for(const test of testCases){
      const source=htmlNativeCaseSource(project,test);
      if(!source||!candidate&&test.criterionIds.includes("SYS-PAIRWISE"))continue;
      const group=groups.get(source.id)??{source,tests:[]};group.tests.push(test);groups.set(source.id,group);
    }
    const runs:TargetRunResult[]=[];
    for(const {source,tests} of groups.values()){
      try{
        const original=await originalBytes(project,source,ports);
        let subject=original.bytes,subjectSha=original.sha256;
        if(candidate){
          const refs=project.baselineRun.originalReferences?.filter(ref=>ref.sourceArtifactId===source.id)??[];
          const snapshots=candidate.artifactSnapshots.filter(snapshot=>snapshot.sourceArtifactId===source.id);
          const snapshot=snapshots.length===1?snapshots[0]:undefined,receipt=snapshot?.frozenArtifact;
          if(refs.length!==1||!snapshot||!receipt||receipt.sourceArtifactId!==source.id||!await ports.verifyFrozen(snapshot))throw Error("Candidate frozen identity is unavailable");
          const blob=await ports.artifacts.get(receipt.blobId);
          if(!blob||!blob.size||blob.size>limit||blob.size!==receipt.size)throw Error("Candidate physical size differs");
          subject=new Uint8Array(await blob.arrayBuffer());subjectSha=await serverArtifactSha256(subject);
          if(subjectSha!==receipt.sha256||subject.byteLength!==receipt.size)throw Error("Candidate physical SHA differs");
        }
        const plans=new Map<string,NonNullable<TestCase["browserSteps"]>>();
        for(const test of tests){
          if(!test.browserSteps?.length)continue;
          // Recheck against the fetched, SHA-verified Original rather than a possibly stale text projection.
          if(!isSourceGroundedHtmlSearchPlan(new TextDecoder("utf-8",{fatal:true}).decode(original.bytes),test.browserSteps))throw Error("Declared browser predicates differ from physical Original");
          plans.set(htmlNativeBrowserPlanKey(test.browserSteps)!,test.browserSteps);
        }
        const browserAssertions=plans.size?HtmlNativeBrowserAssertionsSchema.parse({schemaVersion:"source-grounded-browser-assertions-v1",plans:[...plans.values()]}):undefined;
        await assertServerControlExecutionActive(project.id);
        const result=SandboxHtmlNativeResponseSchema.parse(await ports.execute({original:original.bytes,subject,
          expectedOriginalSha256:original.sha256,expectedSubjectSha256:subjectSha,...(browserAssertions?{browserAssertions}:{})}));
        if(result.status!=="observed"){
          if(result.reasonCode==="payment-required"){
            for(const test of tests)runs.push(TargetRunResultSchema.parse({
              testCaseId:test.id,artifactHash:subjectSha,verificationStatus:"unverified",error:HTML_NATIVE_PAYMENT_REQUIRED,
              output:"UNVERIFIED: 隔离执行需要付费或恢复免费额度；保留冻结文件，停止依赖执行与评分，不自动升级。",latencyMs:0,cost:0,trace:[],
            }));
            break;
          }
          continue;
        }
        const observation=result.observation;
        if(observation.original.sha256!==original.sha256||observation.subject.sha256!==subjectSha
          ||observation.subject.bodyTextFingerprint!==fastHash(result.subjectText)
          ||JSON.stringify(observation.browserAssertions)!==JSON.stringify(browserAssertions))throw Error("Native observation physical subjects or declared predicates differ");
        for(const test of tests)runs.push(TargetRunResultSchema.parse({testCaseId:test.id,artifactHash:subjectSha,
          output:observation.schemaVersion==="html-native-observation-v2-local-browser"
            ?"NATIVE HTML OBSERVATIONS: exact physical subjects observed in fresh local sandboxed headless browser processes with network denied. Tool assertions do not establish semantic quality or final acceptance."
            :"NATIVE HTML OBSERVATIONS: exact physical subjects observed in a network-denied ephemeral Sandbox. Tool assertions do not establish semantic quality or final acceptance.",
          verificationStatus:"verified",latencyMs:observation.subject.elapsedMs,cost:0,trace:[],
          nativeHtmlProof:{sourceArtifactId:source.id,testCaseId:test.id,subjectSha256:subjectSha,producer:"native-html-observer-v1",observation},
          renderedDocumentEvidence:{schemaVersion:"rendered-html-document-v1",sourceArtifactId:source.id,artifactSha256:subjectSha,
            textFingerprint:fastHash(result.subjectText),text:result.subjectText,paragraphs:observation.subject.renderedParagraphs,
            complete:true,excludes:["scripts","styles","raw-attributes"]}}));
      }catch(error){
        if(error instanceof ServerControlExecutionStoppedError)throw error;
        for(const test of tests)runs.push({testCaseId:test.id,output:"UNVERIFIED: 原生 HTML 执行未取得同一 Mission、Baseline 原版及冻结文件的完整证据。",
          verificationStatus:"unverified",error:ports.unavailableCode??"NATIVE_HTML_EXECUTION_UNAVAILABLE",latencyMs:0,cost:0,trace:[]});
        if(ports.unavailableCode)break;
      }
    }
    return runs;
  };
}

export async function executeServerHtmlNativeBatch(args:Request){
  const runtime=serverNativeHtmlRuntime(args.project);
  const localUnavailable=()=>args.testCases.map(test=>({testCaseId:test.id,verificationStatus:"unverified" as const,error:HTML_NATIVE_LOCAL_UNAVAILABLE,output:"UNVERIFIED: 本地浏览器执行缺少授权、运行能力或当前文件绑定；停止依赖步骤，未改用云端。",latencyMs:0,cost:0,trace:[]}));
  if(runtime.local&&(!runtime.authorized||!runtime.kernelSha256||!args.candidate&&args.project.searchChampion))return localUnavailable();
  if(!runtime.authorized)return [];
  const execute=async(request:SandboxHtmlNativeRequest)=>{
    const result=await runtime.execute(request);
    if(runtime.local&&result.status!=="observed")throw Object.assign(Error("Local native execution unavailable"),{code:HTML_NATIVE_LOCAL_UNAVAILABLE});
    return result;
  };
  try{
    return await createServerHtmlNativeExecutor({artifacts:getServerArtifactStore(),authorized:()=>runtime.authorized,...(runtime.local?{unavailableCode:HTML_NATIVE_LOCAL_UNAVAILABLE}:{}),
      verifyFrozen:verifyServerCandidateFrozenArtifact,execute})(args);
  }catch(error){
    if(error instanceof ServerControlExecutionStoppedError||!runtime.local)throw error;
    return localUnavailable();
  }
}
