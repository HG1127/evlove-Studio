import {runEvolveAi} from "../ai/service";
import {VisualJudgeAiResultSchema} from "../ai/schemas";
import type {EvolveProject,TargetRunResult,TestCase} from "../schemas";
import type {TargetVariant} from "../target/types";
import {getVisualEvidence,hydrateVisualEvidence} from "./visual-evidence";
import {textDigest} from "./frozen-artifact";
export async function runVisualCase(project:EvolveProject,testCase:TestCase,variant?:TargetVariant,shots?:NonNullable<TargetRunResult["screenshots"]>):Promise<TargetRunResult>{
 const started=Date.now();
 await hydrateVisualEvidence(project.id);
 const targets=project.sourceArtifacts.filter(a=>a.role==="target");
 const hashes=await Promise.all(targets.map(a=>textDigest(variant?variant.artifactSnapshots.find(s=>s.sourceArtifactId===a.id)?.content??"":a.textContent??"")));
 const images=shots??getVisualEvidence(project.id).items.filter(i=>i.artifactHash&&hashes.includes(i.artifactHash));
 if(!images.length)return {testCaseId:testCase.id,output:"缺少与当前文件指纹一致的截图。请先验证该版本并获取截图。",latencyMs:0,cost:0,trace:[],verificationStatus:"unverified"};
 const report=VisualJudgeAiResultSchema.parse(await runEvolveAi("visual-judge",{aiProfile:project.aiProfile,goal:project.goal,testCase,protectedItems:project.protectedItems,version:variant?.id??"baseline",screenshots:images.map(i=>({name:i.name,artifactHash:i.artifactHash})),instruction:"逐项依据实际截图评审当前题目，只引用可见内容。截图不能证明点击成功、后台保存或全页无缺失；明确未验证部分。"},{imageDataUrls:images.map(i=>i.dataUrl)}));
 return {testCaseId:testCase.id,output:JSON.stringify(report),latencyMs:Date.now()-started,cost:0,verificationStatus:"partial",trace:[{id:`visual-${testCase.id}`,stage:"visual-review",summary:`已对 ${images.length} 张版本匹配截图完成真实视觉评审；交互与未截图区域仍待验证`,status:"info",detail:hashes.join(",")}]};
}
