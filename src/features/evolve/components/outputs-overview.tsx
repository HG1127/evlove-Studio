import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { CheckCircle2, Download, FileArchive, PackageCheck, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocalProjects } from "../runtime/use-local-projects";
import { buildDeliverableZip } from "../runtime/artifact-output-builders";
import { acceptMissionOutputs, isMissionUserAccepted, MISSION_REVIEW_CHANGED_EVENT } from "../runtime/mission-review-store";
import { ArtifactReviewModal } from "./artifact-review-modal";

function downloadBlob(name:string, blob:Blob){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);}

export function OutputsOverview(){
  const projects=useLocalProjects();
  const [reviewProjectId,setReviewProjectId]=useState<string>();
  const reviewProject=projects.find((item)=>item.id===reviewProjectId);
  const [,setReviewTick]=useState(0);
  useEffect(()=>{
    const refresh=()=>setReviewTick(v=>v+1);
    window.addEventListener(MISSION_REVIEW_CHANGED_EVENT,refresh);
    return()=>window.removeEventListener(MISSION_REVIEW_CHANGED_EVENT,refresh);
  },[]);
  const eligible=projects.filter((p)=>p.searchChampion);
  const withOutputs=projects.filter((p)=>p.outputArtifacts.length>0);
  const total=projects.reduce((sum,p)=>sum+p.outputArtifacts.length,0);
  return <div className="space-y-5">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div><div className="text-xs font-semibold text-emerald-700">Artifact Center</div><h1 className="mt-1 text-3xl font-bold">成果</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">机器验收与用户验收分开记录：Gate F 只证明成果满足 Acceptance Contract；你确认验收后，这个 Mission 才会在工作台进入“已完成”。</p></div>
      <div className="flex flex-wrap gap-2"><Badge className="border-amber-200 bg-amber-50 text-amber-700">{eligible.length} Champions</Badge><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{total} Artifacts</Badge></div>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      {eligible.length ? eligible.map((project)=>{
        const c=project.searchChampion!;
        const artifacts=project.outputArtifacts;
        const userAccepted=isMissionUserAccepted(project);
        const downloadable=artifacts.length>0&&!artifacts.filter((a)=>a.kind==='primary').some((a)=>!a.accepted);
        return <Card key={project.id}><CardContent className="pt-5">
          <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><div className="font-semibold">{project.name}</div><Badge>{project.department}</Badge></div><div className="mt-2 flex items-center gap-2"><Trophy className="size-4 text-amber-500"/><span className="text-2xl font-bold">{c.versionLabel}</span><span className="text-sm font-semibold text-indigo-600">Score {c.score.toFixed(1)}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">{c.reason}</p></div><FileArchive className="size-5 text-emerald-600"/></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><Mini label="Rounds" value={project.roundHistory.length}/><Mini label="Archive" value={project.evolutionArchive.length}/><Mini label="Files" value={artifacts.length}/></div>
          <div className="mt-3 flex flex-wrap gap-1.5"><Badge className={c.artifactAcceptance?.status === "passed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}>系统验收 · {c.artifactAcceptance?.status ?? "missing"}</Badge>{c.artifactAcceptance?.status === "passed"&&<Badge>Coverage {c.artifactAcceptance.coverageScore}</Badge>}<Badge className={userAccepted?"border-emerald-200 bg-emerald-50 text-emerald-700":"border-sky-200 bg-sky-50 text-sky-700"}>{userAccepted?"用户已验收":"等待用户验收"}</Badge></div>
          <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={()=>setReviewProjectId(project.id)}>查看成果与差异</Button><Button size="sm" disabled={!downloadable} onClick={async()=>{try{downloadBlob(`${project.name}-${c.versionLabel}.zip`,await buildDeliverableZip(project));}catch(error){toast.error(error instanceof Error?error.message:"成果包下载失败");}}}><Download className="size-3.5"/>下载成果</Button>{userAccepted?<Button size="sm" variant="secondary" disabled><CheckCircle2 className="size-3.5"/>已确认验收</Button>:<Button size="sm" disabled={!artifacts.some((a)=>a.kind==='primary'&&a.accepted)} onClick={()=>{try{acceptMissionOutputs(project);toast.success("已确认验收当前成果");}catch(error){toast.error(error instanceof Error?error.message:"验收失败");}}}><CheckCircle2 className="size-3.5"/>确认验收</Button>}<Link to={`/projects/${project.id}`}><Button size="sm" variant="ghost">打开任务</Button></Link></div>
        </CardContent></Card>;
      }) : <Card><CardContent className="py-16 text-center"><PackageCheck className="mx-auto size-8 text-slate-300"/><div className="mt-3 text-sm font-semibold text-slate-600">还没有已验收的最佳版本</div><p className="mt-1 text-xs text-slate-400">Winner 通过 Hidden Validation 与 Gate F 后，成果会自动结算到这里。</p></CardContent></Card>}
    </div>
    {withOutputs.length>0&&<div className="rounded-2xl border bg-slate-50 p-4 text-xs leading-5 text-slate-500">正式成果只使用被 Hidden Validation + Gate F 验证过的同一 Candidate Snapshot；用户验收记录绑定当前成果指纹，新版本出现后会自动重新进入“待验收”。</div>}
    {reviewProject&&<ArtifactReviewModal project={reviewProject} onClose={()=>setReviewProjectId(undefined)} />}
  </div>;
}
function Mini({label,value}:{label:string;value:string|number}){return <div className="rounded-xl border bg-slate-50 p-2.5"><div className="text-lg font-bold">{value}</div><div className="text-[10px] text-slate-400">{label}</div></div>}
