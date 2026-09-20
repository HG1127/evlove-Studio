import {useEffect,useState} from "react";
import {PROJECT_SAVE_EVENT} from "../runtime/project-database";
export function ProjectSaveStatus(){
 const [status,setStatus]=useState<{state:string;message?:string}>({state:"saved"});
 useEffect(()=>{const listener=(event:Event)=>setStatus((event as CustomEvent).detail);window.addEventListener(PROJECT_SAVE_EVENT,listener);return()=>window.removeEventListener(PROJECT_SAVE_EVENT,listener);},[]);
 return status.state === "saved" ? null : <div role={status.state==="error"?"alert":"status"} className={`rounded-xl border p-3 text-sm ${status.state==="error"?"border-rose-200 bg-rose-50 text-rose-800":"bg-slate-50 text-slate-600"}`}>{status.state==="error"?`保存失败，请保持此页面打开并导出项目备份。${status.message}`:"正在保存完整材料与进化记录，请稍候再关闭页面。"}</div>;
}
