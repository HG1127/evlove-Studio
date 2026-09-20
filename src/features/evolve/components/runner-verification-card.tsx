import {useState} from "react";
import {Button} from "@/components/ui/button";
import type {EvolveProject} from "../schemas";
import {TestCaseSchema} from "../schemas";
import {httpTargetAdapter} from "../target/http-adapter";
import {addVisualEvidence,VISUAL_EVIDENCE_EVENT} from "../runtime/visual-evidence";
import {textDigest} from "../runtime/frozen-artifact";
export function RunnerVerificationCard({project}:{project:EvolveProject}){
 const [candidateId,setCandidateId]=useState("");const [steps,setSteps]=useState("[]");const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 const [report,setReport]=useState<Awaited<ReturnType<typeof httpTargetAdapter.run>>>();
 const [action,setAction]=useState("click");const [selector,setSelector]=useState("");const [value,setValue]=useState("");
 const candidates=project.candidates.filter(c=>c.artifactBuildStatus==="ready");
 async function run(){setBusy(true);setMessage("");try{
  const candidate=candidates.find(c=>c.id===candidateId);
  const testCase=TestCaseSchema.parse({id:"browser-check",title:"浏览器验证",input:project.goal,expected:[],executionMode:"external-runner",browserSteps:JSON.parse(steps)});
  const result=await httpTargetAdapter.run({project,testCase,variant:candidate});setReport(result);
  const source=project.sourceArtifacts.find(a=>a.role==="target"&&/^(html|htm)$/.test(a.extension));
  const content=candidate?.artifactSnapshots.find(a=>a.sourceArtifactId===source?.id)?.content??source?.textContent??"";
  const files=await Promise.all((result.screenshots??[]).map(async shot=>new File([await(await fetch(shot.dataUrl)).blob()],`${candidate?.title??"原版"}-${shot.name}`,{type:"image/png"})));
  await addVisualEvidence(project.id,files,{artifactHash:await textDigest(content),sourceArtifactId:source?.id,candidateId:candidate?.id});
  window.dispatchEvent(new CustomEvent(VISUAL_EVIDENCE_EVENT));
  setMessage(`已完成 ${result.trace.length} 项记录，保存 ${files.length} 张截图。${result.verificationStatus==="verified"?"所列断言通过，仍需独立效果验收。":"部分检查未通过或未覆盖；请查看下方记录。"}`);
 }catch(error){setMessage(error instanceof Error?error.message:String(error));}finally{setBusy(false);}}
 return <section className="mt-3 rounded-2xl border border-indigo-200 bg-indigo-50/30 p-4"><h3 className="text-sm font-semibold">直接验证网页成果</h3><p className="mt-1 text-xs leading-5 text-slate-600">把完整 HTML 交给独立浏览器，检查运行错误与横向溢出，保存桌面和手机截图。截图会绑定文件版本，供下方视觉评审使用。工程 Build、后端接口和线上发布需要对应执行器。</p>
  <div className="mt-3 flex flex-wrap gap-2"><select aria-label="选择要验证的文件版本" value={candidateId} onChange={e=>setCandidateId(e.target.value)} disabled={busy} className="max-w-full rounded-lg border bg-white p-2 text-sm"><option value="">当前原版</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.title||c.name}</option>)}</select><Button disabled={busy||!project.sourceArtifacts.some(a=>a.role==="target"&&/^(html|htm)$/.test(a.extension))} onClick={()=>void run()}>{busy?"正在浏览器验证…":"验证并获取双视口截图"}</Button></div>
  <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">添加真实交互检查（可选）</summary><p className="my-2 text-xs leading-5">按顺序添加“操作 → 预期”。目标可填页面文案，例如 text=保存，也可填元素标识 #save。至少添加一项检查，才会判断这些操作是否通过。</p>
   <div className="grid gap-2 sm:grid-cols-3"><select aria-label="检查操作" value={action} onChange={e=>setAction(e.target.value)} disabled={busy} className="rounded-lg border p-2"><option value="click">点击</option><option value="fill">填写</option><option value="visible">检查可见</option><option value="text">检查文案</option><option value="count">检查数量</option></select><input aria-label="操作目标" value={selector} onChange={e=>setSelector(e.target.value)} placeholder="text=保存 或 #save" disabled={busy} className="rounded-lg border p-2"/><input aria-label="输入内容或预期结果" value={value} onChange={e=>setValue(e.target.value)} placeholder="输入内容 / 预期文案 / 数量" disabled={busy||["click","visible"].includes(action)} className="rounded-lg border p-2"/></div>
   <Button size="sm" className="mt-2" variant="secondary" disabled={busy||!selector.trim()} onClick={()=>{try{const current=JSON.parse(steps);const next={action,selector:selector.trim(),...(["fill","text"].includes(action)?{value}:action==="count"?{count:Number(value)}:{})};setSteps(JSON.stringify([...current,next],null,2));setSelector("");setValue("");}catch{setMessage("请先修正高级检查配置，或清空后重新添加。");}}}>添加此步骤</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>setSteps("[]")}>清空步骤</Button>
   <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 text-xs">{(()=>{try{return JSON.parse(steps).map((s:{action:string;selector:string;value?:string;count?:number},i:number)=>`${i+1}. ${{click:"点击",fill:"填写",visible:"检查可见",text:"检查文案",count:"检查数量"}[s.action]} ${s.selector} ${s.value??s.count??""}`).join("\n")||"尚未添加交互检查";}catch{return "高级配置不是有效 JSON";}})()}</pre>
   <details className="mt-2 text-xs"><summary className="cursor-pointer">高级：直接编辑检查配置</summary><textarea aria-label="浏览器交互检查 JSON" value={steps} onChange={e=>setSteps(e.target.value)} disabled={busy} className="mt-2 min-h-24 w-full rounded-lg border p-2 font-mono"/></details></details>
  {message&&<p role="status" className="mt-3 text-sm leading-6">{message}</p>}{report&&<details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">查看执行证据 · {report.verificationStatus}</summary><ul className="mt-2 space-y-1">{report.trace.map(t=><li key={t.id}>{t.status} · {t.summary}</li>)}</ul><pre className="mt-2 whitespace-pre-wrap break-all">{report.output}</pre></details>}
 </section>;
}
