import {useEffect,useState} from "react";
import {MissionReadProgressSchema,type MissionReadProgress} from "@evolution/contracts";
export function useMissionReadProgress(){
 const [progress,setProgress]=useState<MissionReadProgress>();
 useEffect(()=>{const update=(event:Event)=>{const parsed=MissionReadProgressSchema.safeParse((event as CustomEvent).detail);if(parsed.success)setProgress(parsed.data);};window.addEventListener("evolve-mission-read-progress",update);return()=>window.removeEventListener("evolve-mission-read-progress",update);},[]);
 return progress;
}
