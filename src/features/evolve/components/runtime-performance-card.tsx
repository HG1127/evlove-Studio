import {useEffect,useState} from "react";
import {listAiPerformance} from "../ai/performance";
import {OPERATION_META} from "../ai/providers/registry";
export function RuntimePerformanceCard(){
 const [events,setEvents]=useState(listAiPerformance);
 useEffect(()=>{const update=()=>setEvents(listAiPerformance());window.addEventListener("evolve-ai-performance-changed",update);return()=>window.removeEventListener("evolve-ai-performance-changed",update);},[]);
 const groups=[...new Set(events.map(e=>e.operation))].map(operation=>{const items=events.filter(e=>e.operation===operation);const durations=items.filter(e=>!e.cached).map(e=>e.durationMs).sort((a,b)=>a-b);return {operation,total:durations.reduce((a,b)=>a+b,0),median:durations[Math.floor(durations.length/2)]??0,cached:items.filter(e=>e.cached).length,failures:items.filter(e=>e.status==="error").length};}).sort((a,b)=>b.total-a.total).slice(0,4);
 return <details className="mt-3 rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">查看耗时与重试原因</summary><p className="my-2 text-xs text-slate-600">当前浏览器最近 {events.length} 次 AI 调用，包含不同项目。并发调用的累计耗时不等于本轮等待时间。</p><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="py-2">节点</th><th>单次中位耗时</th><th>缓存命中</th><th>失败尝试</th></tr></thead><tbody>{groups.map(g=><tr key={g.operation} className="border-t"><td className="py-2">{OPERATION_META[g.operation]?.label??g.operation}</td><td>{(g.median/1000).toFixed(1)} 秒</td><td>{g.cached}</td><td>{g.failures}</td></tr>)}</tbody></table></div></details>;
}
