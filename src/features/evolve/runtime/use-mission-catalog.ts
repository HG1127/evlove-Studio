import {useEffect,useState} from "react";
import {readHttpMissionCatalog} from "@evolution/adapters";
import type {MissionCatalogSnapshot} from "@evolution/contracts";
import {serverEnv} from "./env";
import {productionRuntimeMode} from "./production-runtime";
import {productionSyncStatus} from "./production-sync";
export function useMissionCatalog(){
 const [state,setState]=useState<{snapshot?:MissionCatalogSnapshot;error?:string;unsupported?:boolean}>({});
 const mode=productionRuntimeMode(),api=serverEnv.EVOLUTION_API_URL?.trim()||"/api/evolution";
 useEffect(()=>{
  if(mode!=="http")return;
  let active=true,inFlight=false;let timer:ReturnType<typeof setTimeout>|undefined;let controller:AbortController|undefined;
  const read=async()=>{
   if(!active||inFlight||productionSyncStatus().realtimeStatus==="http-polling")return;
   inFlight=true;controller=new AbortController();
   try{const snapshot=await readHttpMissionCatalog(api,controller.signal);if(active&&!controller.signal.aborted&&productionSyncStatus().realtimeStatus!=="http-polling")setState(snapshot?{snapshot}:{unsupported:true});}
   catch(error){if(active&&!controller.signal.aborted)setState(previous=>({...previous,error:error instanceof Error?error.message:"项目目录暂未同步"}));}
   finally{inFlight=false;if(active&&!controller.signal.aborted)timer=setTimeout(()=>void read(),30_000);}
  };
  const syncChanged=()=>{if(productionSyncStatus().realtimeStatus==="http-polling"){clearTimeout(timer);controller?.abort();setState({});}else void read();};
  void read();window.addEventListener("evolve-production-realtime-status",syncChanged);
  return()=>{active=false;clearTimeout(timer);controller?.abort();window.removeEventListener("evolve-production-realtime-status",syncChanged);};
 },[api,mode]);
 return mode==="http"?state:{};
}
