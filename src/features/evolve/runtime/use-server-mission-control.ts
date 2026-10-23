import {useCallback,useEffect,useRef,useState} from "react";
import {inspectServerMissionControl,type MissionControlInspection} from "./server-mission-control-client";

export type ServerMissionControlState={
  checking:boolean;inspection?:MissionControlInspection;error?:string;
  blocked:boolean;refresh:()=>void;
};

/**
 * Poll using the signed-in browser's own HttpOnly Operator Session. Never
 * retrieve a credential into React/JS, and never mutate Mission or Job data.
 */
export function useServerMissionControlStatus(missionId:string,enabled:boolean):ServerMissionControlState{
  const [state,setState]=useState<{
    missionId?:string;checking:boolean;inspection?:MissionControlInspection;error?:string;
  }>({checking:enabled});
  const [refreshTick,setRefreshTick]=useState(0);
  const requestControllerRef=useRef<AbortController|null>(null);
  const refresh=useCallback(()=>{
    if(!enabled)return;
    // Abort the previous read immediately, expose loading synchronously, then
    // let the effect create exactly one replacement request.
    requestControllerRef.current?.abort();
    setState(previous=>({
      missionId,checking:true,
      ...(previous.missionId===missionId&&previous.inspection?{inspection:previous.inspection}:{}),
    }));
    setRefreshTick(tick=>tick+1);
  },[missionId,enabled]);
  useEffect(()=>{
    if(!enabled){
      requestControllerRef.current?.abort();
      requestControllerRef.current=null;
      return;
    }
    let active=true;
    let timer:number|ReturnType<typeof setTimeout>|undefined;
    let inFlight=false;
    let controller:AbortController|undefined;
    const inspect=async()=>{
      if(!active||inFlight)return;
      inFlight=true;
      controller=new AbortController();
      requestControllerRef.current=controller;
      try{
        const inspection=await inspectServerMissionControl(missionId,controller.signal);
        if(active&&!controller.signal.aborted)setState({missionId,checking:false,inspection});
      }catch(error){
        // An intentional refresh/navigation cancellation is not an error state.
        if(active&&!controller.signal.aborted)setState({
          missionId,checking:false,error:error instanceof Error?error.message:String(error),
        });
      }finally{
        inFlight=false;
        if(requestControllerRef.current===controller)requestControllerRef.current=null;
        // Schedule only after the previous read settles. A slow endpoint can
        // never overlap the next periodic poll.
        if(active&&!controller.signal.aborted){
          timer=window.setTimeout(()=>void inspect(),30_000);
        }
      }
    };
    void inspect();
    return ()=>{
      active=false;
      if(timer!==undefined)window.clearTimeout(timer);
      controller?.abort();
      if(requestControllerRef.current===controller)requestControllerRef.current=null;
    };
  },[missionId,enabled,refreshTick]);
  const currentInspection=state.missionId===missionId&&state.inspection?.missionId===missionId
    ?state.inspection:undefined;
  const currentError=state.missionId===missionId?state.error:undefined;
  const checking=enabled&&(state.missionId!==missionId||state.checking
    ||(!currentError&&!currentInspection));
  return {
    checking,inspection:currentInspection,error:currentError,
    // On HTML audit Targets, an unknown/blocked durable state is not permission
    // to create a new Workflow. Only a positively read "ready" is startable.
    blocked:enabled&&(checking||Boolean(currentError)||currentInspection?.state!=="ready"),
    refresh,
  };
}
