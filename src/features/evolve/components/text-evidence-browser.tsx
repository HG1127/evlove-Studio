import {useState} from "react";
import type {SourceArtifact} from "../schemas";
import {Button} from "@/components/ui/button";
export function TextEvidenceBrowser({artifact}:{artifact:SourceArtifact}){
 const [query,setQuery]=useState("");const [offset,setOffset]=useState(0);const [message,setMessage]=useState("");
 const text=artifact.textContent??"";const pageSize=6000;const start=Math.min(offset,Math.max(0,text.length-1));
 function find(next=false){const at=text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase(),next?start+Math.max(query.length,1):0);if(at<0){setMessage("未找到更多匹配，请修改关键词或从头查找。");return;}setOffset(at);setMessage(`匹配位于第 ${at+1} 个字符`);}
 return <details className="mt-3 rounded-xl border bg-white p-3"><summary className="cursor-pointer text-sm font-semibold">{artifact.name} · 已保留 {text.length.toLocaleString()} 字符 · 查看原文</summary>
  {/truncated by Evolve|已截断进入 AI/.test(text+artifact.warnings.join(" "))&&<p className="mt-2 text-sm text-amber-800">这是旧版截断的解析记录，请使用上方「重新深度解析」从原文件恢复全文；恢复后旧验收会失效。</p>}
  <div className="mt-3 flex flex-wrap gap-2"><input aria-label={`${artifact.name} 全文关键词`} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&query.trim())find();}} placeholder="在完整正文中查找" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"/><Button size="sm" disabled={!query.trim()} onClick={()=>find()}>查找</Button><Button size="sm" variant="secondary" disabled={!query.trim()} onClick={()=>find(true)}>下一个</Button></div>
  <p role="status" className="mt-2 text-xs text-slate-600">{message||"原文按页显示，仅控制界面长度，不截断底层材料。"}</p><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs leading-6">{text.slice(start,start+pageSize)||"没有可读取的正文。"}</pre>
  <div className="mt-2 flex items-center gap-2"><Button size="sm" variant="ghost" disabled={start===0} onClick={()=>setOffset(Math.max(0,start-pageSize))}>上一段</Button><span className="text-xs text-slate-600">{text.length?start+1:0}–{Math.min(text.length,start+pageSize)} / {text.length}</span><Button size="sm" variant="ghost" disabled={start+pageSize>=text.length} onClick={()=>setOffset(start+pageSize)}>下一段</Button></div>
 </details>;
}
