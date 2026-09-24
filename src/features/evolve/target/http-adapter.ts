import {getArtifactBlob} from "../runtime/artifact-blob-store";
import {readFrozenArtifact,sha256} from "../runtime/frozen-artifact";
import {artifactTargetAdapter} from "./artifact-adapter";
import {runVisualCase} from "../runtime/visual-case";
import {textDigest} from "../runtime/frozen-artifact";
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
    const source=project.sourceArtifacts.find(a=>a.role==="target" && /^(html|htm)$/.test(a.extension));
    const snapshot=variant?.artifactSnapshots.find(a=>a.sourceArtifactId===source?.id);
    const artifact=source?{name:source.name,content:variant?snapshot?.content:source.textContent}:undefined;
    if(source && !artifact?.content) throw new Error("候选实际 HTML 尚未生成，不能运行修改说明。");
    if(artifact?.content?.includes("[...truncated by Evolve Studio...]") || (!variant && source?.warnings?.some(w=>/Studio 已截断进入|进入 AI 上下文的部分已截断/.test(w))))throw new Error("检测到旧版截断内容，请先重新深度解析原文件，不能把截断网页当作真实完整成果验证。");
    const packageSource=project.sourceArtifacts.find(a=>a.role==="target"&&a.extension==="zip");
    let archiveBase64:string|undefined;let archiveHash:string|undefined;
    if(!source&&packageSource){const snap=variant?.artifactSnapshots.find(a=>a.sourceArtifactId===packageSource.id);const blob=variant?await readFrozenArtifact(snap?.frozenArtifact,snap?.content??""):await getArtifactBlob(packageSource.id);if(!blob)throw new Error("源码 ZIP 不在当前浏览器，请重新上传");const buffer=await blob.arrayBuffer();archiveHash=await sha256(buffer);const bytes=new Uint8Array(buffer);let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));archiveBase64=btoa(binary);}
    const res = await fetch(url, {
      method: "POST",
      headers: headers(),
      signal: AbortSignal.timeout(archiveBase64?SERVER_PROXY_TIMEOUT_MS:90_000),
      body: JSON.stringify({
        projectId: project.id,
        connectionId: project.targetConnection.connectionId,
        testCase, artifact, archiveBase64,
        variant: variant ?? null,
      }),
    });
    if (!res.ok) throw await executionError(res, "真实验证");
    const result=TargetRunResultSchema.parse(await res.json());
    if(archiveHash&&result.verificationStatus!=="unverified"&&result.artifactHash!==archiveHash)throw new Error("构建证据与实际源码包指纹不一致");
    if(artifact?.content && result.verificationStatus!=="unverified"
      && result.artifactHash!==await textDigest(artifact.content)) throw new Error("执行结果与提交文件指纹不一致");
    if(testCase.executionMode==="visual-review"&&result.screenshots?.length){const visual=await runVisualCase(project,testCase,variant,result.screenshots);return {...visual,screenshots:result.screenshots,artifactHash:result.artifactHash,trace:[...result.trace,...visual.trace],verificationStatus:result.verificationStatus==="failed"?"failed":"partial"};}
    return result;
  },
  async release({ project, candidate, action }) {
    const url = SERVER_RELEASE_URL;
    const res = await fetch(url, {
      method: "POST",
      headers: headers(),
      signal: AbortSignal.timeout(SERVER_PROXY_TIMEOUT_MS),
      body: JSON.stringify({ projectId: project.id, connectionId: project.targetConnection.connectionId, candidate, action }),
    });
    if (!res.ok) throw await executionError(res, "发布执行");
    return ReleaseAdapterResultSchema.parse(await res.json());
  },
};
