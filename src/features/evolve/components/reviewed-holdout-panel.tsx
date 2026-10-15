import {useRef,useState} from "react";
import type {EvolveProject,ReviewedHoldoutPreview,EvolutionWorkflowStartResponse} from "@evolution/contracts";
import {Button} from "@/components/ui/button";
import {productionRuntimeMode} from "../runtime/production-runtime";
import {previewReviewedHoldout,startReviewedHoldout} from "../runtime/reviewed-holdout-client";

export function ReviewedHoldoutPanel({project,busy}:{project:EvolveProject;busy:boolean}){
  const [preview,setPreview]=useState<ReviewedHoldoutPreview>();
  const [note,setNote]=useState(""),[preserve,setPreserve]=useState(false),[gates,setGates]=useState(false);
  const [submitted,setSubmitted]=useState(false);
  const [pending,setPending]=useState(false),[error,setError]=useState(""),[receipt,setReceipt]=useState<EvolutionWorkflowStartResponse>();
  const lock=useRef(false),requestKey=useRef<string|undefined>(undefined);
  if(productionRuntimeMode()!=="http"||project.baselineRun.result?.safety!=="REVIEW"||!project.experimentRun.winnerId||project.artifactAcceptance.status!=="idle")return null;
  const stale=!!preview&&(preview.binding.missionId!==project.id||!submitted&&preview.binding.sourceUpdatedAt!==project.updatedAt);
  async function inspect(){
    if(lock.current)return;lock.current=true;setPending(true);setError("");
    try{const value=await previewReviewedHoldout(project.id);setPreview(value);setPreserve(false);setGates(false);setSubmitted(false);requestKey.current=undefined;}
    catch(e){setError(e instanceof Error?e.message:"无法读取复核信息。");}
    finally{lock.current=false;setPending(false);}
  }
  async function confirm(){
    if(lock.current||!preview||stale||!preserve||!gates||note.trim().length<8||receipt)return;
    lock.current=true;setPending(true);setError("");
    setSubmitted(true);
    requestKey.current??="reviewed-holdout:"+crypto.randomUUID();
    try{setReceipt(await startReviewedHoldout({binding:preview.binding,idempotencyKey:requestKey.current,
      humanReviewNote:note,preserveReview:true,preserveAcceptanceGates:true}));}
    catch(e){setError((e instanceof Error?e.message:"无法确认启动结果。")+" 请保留此页，重试会使用相同请求键。");}
    finally{lock.current=false;setPending(false);}
  }
  return <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-labelledby="reviewed-holdout-title">
    <h3 id="reviewed-holdout-title" className="font-semibold">人工复核后继续隔离验证</h3>
    <p className="text-sm">原版 Safety REVIEW 保留。可核对原因后，只对同一冻结成果继续隐藏同卷验证。新的安全评审、验收分数、保护要求与 Gate F 仍须全部满足。</p>
    {!receipt&&<Button variant="secondary" disabled={busy||pending||submitted} onClick={()=>void inspect()}>读取当前复核信息</Button>}
    {preview&&<div className="space-y-3 text-sm">
      <ul className="list-disc pl-5">{preview.reviewNotes.map((text,i)=><li key={i}>{text}</li>)}</ul>
      <p>冻结成果：{preview.binding.candidateId}</p>
      <p className="break-all">文件 SHA-256：{preview.binding.frozenSha256}</p>
      <p>{preview.preservationNotice}</p>
      {stale&&<p role="alert">项目版本已变化，请重新读取复核信息。</p>}
      {!receipt&&<>
        <label className="block">人工复核说明<textarea aria-label="人工复核说明" maxLength={2000} value={note} disabled={pending||submitted}
          onChange={e=>setNote(e.target.value)} className="mt-1 block w-full rounded border p-2"/></label>
        <label className="flex gap-2"><input type="checkbox" checked={preserve} disabled={pending||submitted} onChange={e=>setPreserve(e.target.checked)}/>我已复核原因，确认保留原 REVIEW 和历史结果。</label>
        <label className="flex gap-2"><input type="checkbox" checked={gates} disabled={pending||submitted} onChange={e=>setGates(e.target.checked)}/>仅继续同一冻结文件的隔离验证，不豁免验收门槛。</label>
        <Button disabled={busy||pending||stale||!preserve||!gates||note.trim().length<8} onClick={()=>void confirm()}>确认并继续同一冻结文件</Button>
      </>}
    </div>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {pending&&<p role="status" className="text-sm">正在核验后台记录…</p>}
    {receipt&&<p role="status" className="break-all text-sm">已交给后台进行隔离验证，请在运行记录查看结果。Run：{receipt.runId}。完整验收尚未完成。</p>}
  </section>;
}
