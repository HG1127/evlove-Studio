import {useEffect,useState,type FormEvent,type ReactNode} from "react";
import {configureProductionRuntime,productionRuntimeMode} from "@/features/evolve/runtime/production-runtime";
import {localProductionPorts} from "@/features/evolve/runtime/local-production-adapters";
import {initializeProductionSync,productionSyncStatus,stopProductionSync} from "@/features/evolve/runtime/production-sync";
import {getOperatorSession,loginOperator,logoutOperator} from "@/features/evolve/runtime/operator-session-client";

type GateState="checking"|"login"|"unavailable"|"ready"|"offline";
type SyncState="connecting"|"connected"|"failed";

export function OperatorSessionGate({children}:{children:ReactNode}){
  const [state,setState]=useState<GateState>(()=>productionRuntimeMode()==="local"?"ready":"checking");
  const [accessKey,setAccessKey]=useState("");
  const [localDirect,setLocalDirect]=useState(false);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [syncState,setSyncState]=useState<SyncState>("connecting");
  const [syncError,setSyncError]=useState("");

  useEffect(()=>{
    if(state!=="checking")return;
    let active=true;
    void getOperatorSession().then((session)=>{
      if(!active)return;
      setLocalDirect(Boolean(session.localDirect));
      setState(!session.configured?"unavailable":session.authenticated?"ready":"login");
    }).catch(()=>{if(active)setState("unavailable");});
    return ()=>{active=false;};
  },[state]);

  useEffect(()=>{
    if(state!=="ready"||productionRuntimeMode()==="local")return;
    let active=true;
    const updateSyncState=()=>{
      if(!active)return;
      const status=productionSyncStatus();
      setSyncState(status.realtimeStatus==="http-polling"?"connected":status.realtimeStatus==="http-error"?"failed":"connecting");
      setSyncError(status.lastError||"");
    };
    window.addEventListener("evolve-production-realtime-status",updateSyncState);
    updateSyncState();
    void initializeProductionSync().catch(()=>{updateSyncState();});
    const check=()=>{
      void getOperatorSession().then((session)=>{
        if(!active||session.authenticated)return;
        void stopProductionSync();
        setState(session.configured?"login":"unavailable");
      }).catch(()=>undefined);
    };
    const timer=window.setInterval(check,60_000);
    document.addEventListener("visibilitychange",check);
    return ()=>{
      active=false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange",check);
      window.removeEventListener("evolve-production-realtime-status",updateSyncState);
    };
  },[state]);

  const login=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError("");
    try{
      const session=await loginOperator(accessKey.trim());
      setAccessKey("");
      if(!session.authenticated)throw new Error("会话未生效，请重试");
      setState("ready");
    }catch(cause){setError(cause instanceof Error?cause.message:"无法建立访问会话");}
    finally{setBusy(false);}
  };

  const useLocal=()=>{
    configureProductionRuntime(localProductionPorts,"local");
    setError("");
    setState("offline");
  };

  const logout=async()=>{
    setState("login");
    await stopProductionSync();
    try{await logoutOperator();}catch{setError("退出请求未完成，请刷新页面核对会话状态");}
  };

  const retry=()=>{setError("");setState("checking");};

  if(state==="ready"||state==="offline")return <>
    {children}
    {state==="ready"&&productionRuntimeMode()!=="local"&&<div role="status" className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-2 rounded-xl border bg-white/95 px-3 py-2 text-xs shadow-lg">
      <span className={syncState==="connected"?"text-emerald-700":syncState==="failed"?"text-rose-700":"text-slate-600"}>
        {syncState==="connected"?"后端同步正常":syncState==="failed"?`后端同步失败${syncError?`：${syncError}`:"，正在重试"}`:"正在连接后端"}
      </span>
      {!localDirect&&<button type="button" className="font-medium text-slate-600 underline" onClick={()=>void logout()}>退出</button>}
    </div>}
    {state==="offline"&&<div className="fixed bottom-4 right-4 z-50 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-lg">
      本地模式 · 数据仅保存在此浏览器
    </div>}
  </>;

  return <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
    <section className="w-full max-w-md rounded-3xl border bg-white p-8 shadow-sm" aria-labelledby="operator-session-title">
      <div className="mb-3 text-xs font-semibold tracking-wide text-indigo-600">Evolution OS</div>
      <h1 id="operator-session-title" className="text-2xl font-semibold text-slate-900">
        {state==="checking"?"正在检查后端会话":state==="unavailable"?"后端访问尚未就绪":"连接工作区"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {state==="checking"?"正在确认此浏览器是否已获得服务端访问权限。":state==="unavailable"
          ?"当前无法建立安全的后端会话。管理员完成服务端配置后，即可从此处连接工作区。"
          :"输入管理员提供的单用户访问密钥。登录后，项目和任务会通过受保护的后端同步。"}
      </p>
      {state==="login"&&<form className="mt-6 space-y-4" onSubmit={(event)=>void login(event)}>
        <label className="block text-sm font-medium text-slate-700" htmlFor="operator-access-key">访问密钥</label>
        <input id="operator-access-key" type="password" autoComplete="off" required value={accessKey}
          onChange={(event)=>setAccessKey(event.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"/>
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy?"连接中…":"连接后端"}
        </button>
      </form>}
      {error&&<p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {state==="unavailable"&&<button type="button" className="mt-5 rounded-xl border px-4 py-2 text-sm font-medium text-slate-700" onClick={retry}>重新检查</button>}
      {state!=="checking"&&<div className="mt-6 border-t pt-5">
        <button type="button" className="text-sm font-medium text-slate-600 underline" onClick={useLocal}>仅在此浏览器继续</button>
        <p className="mt-2 text-xs leading-5 text-slate-500">本地模式不会把新项目同步到后端；切换设备前请导出项目备份。</p>
      </div>}
    </section>
  </main>;
}
