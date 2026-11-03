import {Link} from "react-router-dom";
import {ArrowRight} from "lucide-react";
import type {MissionHeader} from "@evolution/contracts";
/** Metadata is deliberately presented without inferred workflow or acceptance state. */
export function MissionDirectoryCard({header}:{header:MissionHeader}){
 return <Link to={"/projects/"+encodeURIComponent(header.missionId)} className="rounded-2xl border bg-white p-4 transition hover:border-indigo-300 focus-visible:outline-indigo-600"><div className="truncate font-semibold">{header.title||"未命名项目"}</div><div className="mt-2 text-xs text-amber-800">完整状态待核对</div><p className="mt-2 text-xs leading-5 text-slate-500">项目目录已读取，打开即可单独加载完整内容。</p><div className="mt-4 flex items-center gap-1 text-xs font-semibold text-indigo-600">打开项目<ArrowRight className="size-3"/></div></Link>;
}
