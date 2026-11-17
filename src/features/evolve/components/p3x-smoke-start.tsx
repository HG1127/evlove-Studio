import {useState} from "react";
import {productionRuntimeMode} from "../runtime/production-runtime";
import {P3X_MISSION_ID} from "../runtime/p3x-source-binding";
import {startAuthorizedP3XSmoke} from "../runtime/p3x-smoke-start";

/** Explicit P3-X test request; not connected to ordinary AutoPilot. */
export function P3XSmokeStart({missionId}:{missionId:string}){
  const [busy,setBusy]=useState(false);
  const [started,setStarted]=useState(false);
  const [message,setMessage]=useState<string>();
  if(missionId!==P3X_MISSION_ID||productionRuntimeMode()!=="http")return null;
  return <section className="rounded-xl border border-indigo-200 bg-white p-4 text-sm" aria-label="P3-X 一代真实进化许可启动">
    <div className="font-semibold text-slate-900">P3-X · 已授权单代真实进化烟测</div>
    <p className="mt-1 text-xs leading-5 text-slate-600">
      仅限已登记的唯一 Lab Mission。点击后先检查 Lab 完整性、冻结原版、独立许可及 MiniMax 最新双窗口额度；
      后端再检查云端 HTML Browser，并持久化 Control Job 与预算。
      硬上限为 6 次物理模型调用、300,000 Token、20 分钟，额度窗口均需至少剩余 50%。
    </p>
    <button type="button" disabled={busy||started}
      className="mt-3 rounded-lg bg-indigo-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
      onClick={()=>{
        if(busy||started)return;
        setBusy(true);setMessage(undefined);
        void startAuthorizedP3XSmoke().then(receipt=>{
          setStarted(true);
          setMessage("后端受控启动已受理。Control Job："+receipt.controlJobId+"；Run："+receipt.runId+"。请进入技术运行记录追踪；此处不自动重试。");
        }).catch(error=>{
          setMessage(error instanceof Error?error.message:"服务端启动回执不可确认；请只读检查 Job，不要重复点击。");
        }).finally(()=>setBusy(false));
      }}>{started?"已取得启动回执":busy?"正在核验门禁与服务端执行环境…":"核验门禁并尝试启动真实一代进化"}</button>
    {message&&<p role="status" className="mt-2 break-words text-xs leading-5">{message}</p>}
  </section>;
}
