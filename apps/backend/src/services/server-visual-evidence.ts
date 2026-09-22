import type {EvolveProject,TargetRunResult,TestCase,VisualJudgeAiResult} from "@evolution/contracts";
import {getServerArtifactStore} from "./artifact-runtime";
import {runServerAi,type ServerAiMedia} from "./ai-gateway";

type VisualJudge=(payload:unknown,media:ServerAiMedia)=>Promise<VisualJudgeAiResult>;

function dataUrlBlob(dataUrl:string){
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if(!match)throw new Error("Sandbox 截图不是受支持的 PNG/JPEG/WebP data URL");
  return new Blob([Buffer.from(match[2]!,"base64")],{type:match[1]!});
}

function visualSummary(judge:VisualJudgeAiResult){
  return [
    "SERVER VISUAL JUDGE（真实截图，多模态）：",
    `可用性 ${judge.scores.usability}/100｜美观 ${judge.scores.aesthetics}/100｜响应式 ${judge.scores.responsiveness}/100｜交互 ${judge.scores.interaction}/100`,
    judge.summary,
    ...(judge.findings.length?judge.findings.map((finding)=>`- ${finding}`):[]),
  ].join("\n");
}

export async function attachServerVisualEvidence(
  project:EvolveProject,
  testCases:TestCase[],
  runs:TargetRunResult[],
  judge:VisualJudge=async(payload,media)=>runServerAi("visual-judge",payload,media),
){
  const byId=new Map(testCases.map((testCase)=>[testCase.id,testCase]));
  return Promise.all(runs.map(async(run):Promise<TargetRunResult>=>{
    const testCase=byId.get(run.testCaseId);
    if(testCase?.executionMode!=="visual-review")return run;
    const screenshots=run.screenshots??[];
    if(!screenshots.length){
      return{
        ...run,
        verificationStatus:run.verificationStatus==="failed"?"failed":"unverified",
        output:[run.output,"UNVERIFIED：Server Browser 未返回真实截图，禁止用文本 Judge 替代视觉证据。"].filter(Boolean).join("\n"),
        trace:[...run.trace,{id:`server-visual-missing-${run.testCaseId}`,stage:"visual-judge",summary:"缺少真实截图",status:"warning",detail:"visual-review 必须先有 Sandbox 像素证据。"}],
      };
    }

    let refs:NonNullable<TargetRunResult["visualEvidenceRefs"]>;
    try{
      refs=await Promise.all(screenshots.map(async(screenshot)=>{
        const blobId=`visual-evidence:${project.id}:server:${run.testCaseId}:${screenshot.artifactHash}`;
        await getServerArtifactStore().put(blobId,dataUrlBlob(screenshot.dataUrl));
        return{name:screenshot.name,width:screenshot.width,height:screenshot.height,artifactHash:screenshot.artifactHash,blobId};
      }));
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      return{
        ...run,
        screenshots:undefined,
        verificationStatus:run.verificationStatus==="failed"?"failed":"unverified",
        output:[run.output,`UNVERIFIED：真实截图已生成，但 Artifact Store 持久化失败：${message}`].filter(Boolean).join("\n"),
        trace:[...run.trace,{id:`server-visual-store-failed-${run.testCaseId}`,stage:"visual-evidence",summary:"截图持久化失败",status:"warning",detail:message}],
      };
    }
    try{
      const result=await judge({
        project:{id:project.id,name:project.name,goal:project.goal,objectType:project.objectType},
        testCase:{id:testCase.id,title:testCase.title,input:testCase.input,expected:testCase.expected,criterionIds:testCase.criterionIds,evidenceScope:testCase.evidenceScope},
        screenshots:refs.map(({name,width,height,artifactHash})=>({name,width,height,artifactHash})),
        evidenceInstruction:"Judge only the attached exact Sandbox screenshots. Do not infer hidden, off-screen, persistence, backend or unrendered states.",
      },{imageDataUrls:screenshots.map((screenshot)=>screenshot.dataUrl)});
      return{
        ...run,
        screenshots:undefined,
        visualEvidenceRefs:refs,
        verificationStatus:run.verificationStatus==="failed"?"failed":"partial",
        output:[run.output,visualSummary(result),`视觉截图凭证：${refs.map((ref)=>`${ref.name}=${ref.artifactHash}`).join(" | ")}`].filter(Boolean).join("\n"),
        trace:[...run.trace,{id:`server-visual-judge-${run.testCaseId}`,stage:"visual-judge",summary:"Server Visual Judge 已读取真实 Sandbox 截图",status:"pass",detail:`截图已持久化：${refs.map((ref)=>ref.blobId).join(" | ")}`}],
      };
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      return{
        ...run,
        screenshots:undefined,
        visualEvidenceRefs:refs,
        verificationStatus:run.verificationStatus==="failed"?"failed":"unverified",
        output:[run.output,`UNVERIFIED：真实截图已保存，但 Server Visual Judge 未完成：${message}`].filter(Boolean).join("\n"),
        trace:[...run.trace,{id:`server-visual-judge-failed-${run.testCaseId}`,stage:"visual-judge",summary:"真实截图已保存，但视觉 Judge 未完成",status:"warning",detail:`${message} | ${refs.map((ref)=>ref.blobId).join(" | ")}`}],
      };
    }
  }));
}
