import {useState} from "react";
import {productionRuntimeMode} from "../runtime/production-runtime";
import {P3X_MISSION_ID,registerAndBindP3XSource} from "../runtime/p3x-source-binding";

/** Isolated P3-X operator action; not an experiment start or model probe. */
export function P3XSourceBinding({missionId}:{missionId:string}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState<string>();
  if(missionId!==P3X_MISSION_ID||productionRuntimeMode()!=="http")return null;
  return <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm" aria-label="P3-X 原版物理文件绑定">
    <div className="font-semibold text-amber-950">P3-X · 原始 HTML 物理文件保管链</div>
    <p className="mt-1 text-xs leading-5 text-amber-900">此项只登记并绑定冻结的 2,067 字节 original.html。使用已有 Mission、后端 mission.write 权限和 CAS；不会触发 MiniMax、Judge、Runner 或启用实验许可。</p>
    <button type="button" className="mt-3 rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
      disabled={busy} onClick={()=>{
        if(busy)return;
        setBusy(true);setMessage(undefined);
        void registerAndBindP3XSource().then(receipt=>{
          setMessage("物理原版校验通过："+receipt.state+"，Mission revision "+receipt.revision+"。请刷新此任务以回读最新完整状态。");
        }).catch(error=>{
          setMessage(error instanceof Error?error.message:"登记失败；保留当前状态，禁止自动启动。");
        }).finally(()=>setBusy(false));
      }}>{busy?"正在按 Mission 归属登记并回读…":"登记并绑定唯一冻结 HTML（不启动模型）"}</button>
    {message&&<p role="status" className="mt-2 text-xs leading-5 text-amber-950">{message}</p>}
  </section>;
}
