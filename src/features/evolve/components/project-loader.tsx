import {useEffect,useState} from "react";
import {ProjectStudio} from "./project-studio";
import {getLocalProject} from "../runtime/local-store";
import {productionRuntimeMode} from "../runtime/production-runtime";
import {readProductionMission} from "../runtime/production-mission-read";
import type {EvolveProject} from "../schemas";

type Receipt={id:string;status:"ready"|"missing"|"failed";error?:string};
export function ProjectLoader({projectId,fallback}:{projectId:string;fallback?:EvolveProject}){
 const [,setRevision]=useState(0),[attempt,setAttempt]=useState(0),[receipt,setReceipt]=useState<Receipt>();
 const mode=productionRuntimeMode();
 useEffect(()=>{const refresh=()=>setRevision(value=>value+1);window.addEventListener("evolve-projects-changed",refresh);refresh();return()=>window.removeEventListener("evolve-projects-changed",refresh);},[]);
 useEffect(()=>{
  if(mode!=="http")return;
  const controller=new AbortController();
  void readProductionMission(projectId,controller.signal).then(project=>{if(!controller.signal.aborted)setReceipt({id:projectId,status:project?"ready":"missing"});}).catch(error=>{if(!controller.signal.aborted)setReceipt({id:projectId,status:"failed",error:error instanceof Error?error.message:"项目暂时无法读取"});});
  return()=>controller.abort();
 },[projectId,mode,attempt]);
 const current=receipt?.id===projectId?receipt:undefined;
 if(mode==="http"&&(!current||current.status==="failed"))return <div role="status" className="rounded-2xl border bg-white p-8"><div className="font-semibold">{current?.status==="failed"?"项目读取暂未完成":"正在读取此项目的完整状态"}</div><p className="mt-2 text-sm text-slate-600">{current?.error??"无需等待其他历史项目加载完成。"}</p>{current?.status==="failed"&&<button type="button" className="mt-4 text-indigo-600 underline" onClick={()=>{setReceipt(undefined);setAttempt(value=>value+1);}}>重新读取</button>}</div>;
 const project=mode==="http"?(current?.status==="ready"?getLocalProject(projectId):undefined):getLocalProject(projectId)??fallback;
 if(!project)return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8"><div className="font-semibold text-rose-900">项目不存在</div><p className="mt-2 text-sm text-rose-700">该项目可能已删除，或未保存在当前环境。</p></div>;
 return <ProjectStudio key={project.id} project={project}/>;
}
