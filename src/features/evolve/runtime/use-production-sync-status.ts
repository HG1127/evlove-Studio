import {useEffect,useState} from "react";
import {productionSyncStatus} from "./production-sync";
export function useProductionSyncStatus(){
 const [state,setState]=useState(productionSyncStatus);
 useEffect(()=>{const update=()=>setState(productionSyncStatus());window.addEventListener("evolve-production-realtime-status",update);update();return()=>window.removeEventListener("evolve-production-realtime-status",update);},[]);
 return state;
}
