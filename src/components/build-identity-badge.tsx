import {useEffect,useState} from "react";
import {ProductionBuildInfoSchema,type ProductionBuildInfo} from "@evolution/contracts";

/** Read-only provenance: an absent/malformed response must never imply a verified build. */
export function BuildIdentityBadge(){
  const [identity,setIdentity]=useState<ProductionBuildInfo|null>();
  useEffect(()=>{
    const controller=new AbortController();
    void fetch("/api/evolution/build-info",{cache:"no-store",signal:controller.signal})
      .then(async response=>{
        if(!response.ok)throw Error("build-info unavailable");
        const parsed=ProductionBuildInfoSchema.safeParse(await response.json());
        if(!parsed.success)throw Error("build-info invalid");
        if(!controller.signal.aborted)setIdentity(parsed.data);
      })
      .catch(()=>{if(!controller.signal.aborted)setIdentity(null);});
    return()=>controller.abort();
  },[]);

  const sha=identity?.commitSha;
  const verifiedSha=sha&&/^[a-f0-9]{40}$/i.test(sha)?sha:undefined;
  const environment=identity?.vercelEnvironment;
  const host=identity?.deploymentHost??(typeof window==="undefined"?"":window.location.hostname);
  const label=environment==="preview"
    ? /^evlove-studio-evolution[-.]/.test(host)?"Lab Preview":"Preview"
    :environment==="production"?"Production":environment==="development"?"Development":"环境待确认";
  const text=verifiedSha?`${label} · ${verifiedSha.slice(0,8)}`
    :identity===undefined?"版本核对中":"版本未确认";
  const details=verifiedSha?`部署环境：${label}；Commit：${verifiedSha}；分支：${identity?.commitRef??"未提供"}；部署域名：${host||"未提供"}。此处为部署元数据，并非功能验收通过证明。`
    :"尚未得到可信的后端构建身份，不能依据页面推断部署版本。";
  return <span role="status" aria-label={`当前部署版本：${text}`} title={details} className="hidden max-w-[205px] truncate rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 sm:inline-block">{text}</span>;
}
