import {artifactTargetAdapter} from "./artifact-adapter";
import {prepareBrowserHttpReleaseArtifacts} from "./http-release-artifacts";
import {prepareBrowserHttpRunFile,prepareBrowserHttpRunHtml} from "./http-run-file";
import {runVisualCase} from "../runtime/visual-case";
import { ReleaseAdapterResultSchema, TargetRunResultSchema } from "../schemas";
import type { TargetAdapter } from "./types";

const SERVER_RUN_URL = "/api/evolution/target-run";
const SERVER_RELEASE_URL = "/api/evolution/target-release";
const SERVER_PROXY_TIMEOUT_MS = 180_000;

function headers() {
  return { "Content-Type": "application/json" };
}

async function executionError(res: Response, action: string): Promise<Error> {
  let detail = "";
  try { const body = await res.json(); detail = String(body.error ?? body.note ?? "").slice(0, 600); } catch { /* 非 JSON 代理错误 */ }
  return new Error(`${action}未完成（HTTP ${res.status}）${detail ? `：${detail}` : res.status === 502 ? "：后台执行器未启动或仍使用旧代理，请重新检测后台能力。" : res.status === 401 || res.status === 403 ? "：执行器鉴权失败，请检查高级连接设置。" : "：请在设置中重新检测后台能力。"}`);
}

export const httpTargetAdapter: TargetAdapter = {
  name: "HTTP Target Gateway",
  live: true,
  async run({ project, testCase, variant }) {
    if(!["external-runner","visual-review"].includes(testCase.executionMode))return artifactTargetAdapter.run({project,testCase,variant});
    const url = SERVER_RUN_URL;
    const targets=project.sourceArtifacts.filter((item)=>item.role==="target");
    const criteria=new Set(testCase.criterionIds);
    const scopedIds=new Set((project.acceptanceRubric??[])
      .filter((criterion)=>criteria.has(criterion.id)).flatMap((criterion)=>criterion.artifactIds));
    const selected=scopedIds.size?targets.filter((item)=>scopedIds.has(item.id)):targets;
    if(targets.length&&selected.length!==1)throw new Error(`HTTP Test Case ${testCase.id} 没有唯一的 Target Artifact 绑定。`);
    const target=selected[0];
    const source=target&&/^(html|htm)$/i.test(target.extension)?target:undefined;
    const html=source?await prepareBrowserHttpRunHtml(source,variant):undefined;
    const artifact=html?.artifact;
    const packageSource=target?.extension.toLowerCase()==="zip"?target:undefined;
    const archive=packageSource?await prepareBrowserHttpRunFile(packageSource,variant):undefined;
    const archiveBase64=archive?.contentBase64;
    const archiveHash=archive?.sha256;
    const file=target&&!source&&!packageSource?await prepareBrowserHttpRunFile(target,variant):undefined;
    const res = await fetch(url, {
      method: "POST",
      headers: headers(),
      signal: AbortSignal.timeout(archiveBase64||file?SERVER_PROXY_TIMEOUT_MS:90_000),
      body: JSON.stringify({
        projectId: project.id,
        connectionId: project.targetConnection.connectionId,
        testCase, artifact, archiveBase64, file,
        variant: variant ?? null,
      }),
    });
    if (!res.ok) throw await executionError(res, "真实验证");
    const result=TargetRunResultSchema.parse(await res.json());
    if(archiveHash&&result.verificationStatus!=="unverified"&&result.artifactHash!==archiveHash)throw new Error("构建证据与实际源码包指纹不一致");
    if(file&&result.verificationStatus!=="unverified"&&result.artifactHash!==file.sha256)throw new Error("执行结果与真实 Target 文件指纹不一致");
    if(artifact?.content && result.verificationStatus!=="unverified"
      && result.artifactHash!==html?.sha256) throw new Error("执行结果与提交文件指纹不一致");
    if(testCase.executionMode==="visual-review"&&result.screenshots?.length){const visual=await runVisualCase(project,testCase,variant,result.screenshots);return {...visual,screenshots:result.screenshots,artifactHash:result.artifactHash,trace:[...result.trace,...visual.trace],verificationStatus:result.verificationStatus==="failed"?"failed":"partial"};}
    return result;
  },
  async release({ project, candidate, action }) {
    const url = SERVER_RELEASE_URL;
    const connectionId=project.releaseTarget?.provider==="http"&&project.releaseTarget.status==="connected"
      ?project.releaseTarget.connectionId:undefined;
    if(!connectionId)throw new Error("HTTP 发布缺少独立 Release Target connectionId。");
    const prepared=action==="rollback"?{candidate,frozenArtifacts:undefined}
      :await prepareBrowserHttpReleaseArtifacts(project,candidate);
    const res = await fetch(url, {
      method: "POST",
      headers: headers(),
      signal: AbortSignal.timeout(SERVER_PROXY_TIMEOUT_MS),
      body: JSON.stringify({ projectId: project.id, connectionId, candidate:prepared.candidate, frozenArtifacts:prepared.frozenArtifacts, action }),
    });
    if (!res.ok) throw await executionError(res, "发布执行");
    return ReleaseAdapterResultSchema.parse(await res.json());
  },
};
