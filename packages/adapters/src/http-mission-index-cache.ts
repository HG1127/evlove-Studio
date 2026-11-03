import {MissionIndexSnapshotSchema,type MissionEnvelope,type MissionIndexSnapshot} from "@evolution/contracts";
import {httpApiErrorDetail} from "./http-error";

/** Private full-envelope cache. An interrupted read keeps verified envelopes for
 * the next poll but never returns a partial Mission collection to the caller. */
export function createHttpMissionIndexCache(
  root:string,readEnvelope:(id:string)=>Promise<MissionEnvelope|undefined>,workspaceChanged:()=>void,
){
  const envelopes=new Map<string,MissionEnvelope>();
  let supported:boolean|undefined,workspace:string|undefined;
  function bindWorkspace(index:MissionIndexSnapshot){
    if(workspace!==undefined&&workspace!==index.workspaceId){envelopes.clear();workspaceChanged();}
    workspace=index.workspaceId;
  }
  async function readIndex(){
    if(supported===false)return undefined;
    const response=await fetch(`${root}/mission-index`,{cache:"no-store"});
    if(response.status===404&&supported===undefined){supported=false;return undefined;}
    if(!response.ok){
      const detail=httpApiErrorDetail(await response.json().catch(()=>undefined));
      throw new Error(`项目版本同步 HTTP ${response.status}${detail?`: ${detail}`:""}`);
    }
    const index=MissionIndexSnapshotSchema.parse(await response.json());supported=true;return index;
  }
  const remember=(envelope:MissionEnvelope)=>envelopes.set(envelope.missionId,structuredClone(envelope));
  return {
    remember,
    forget:(id:string)=>{envelopes.delete(id);},
    list:async():Promise<MissionEnvelope[]|undefined>=>{
      let index=await readIndex();if(!index)return undefined;
      for(let attempt=0;attempt<2;attempt++){
        bindWorkspace(index);
        let missing=false;
        for(const item of index.items){
          if((envelopes.get(item.missionId)?.revision??-1)>=item.revision)continue;
          const envelope=await readEnvelope(item.missionId);
          if(!envelope){missing=true;break;}
          if(envelope.revision<item.revision)throw new Error("Mission read is older than its advertised revision");
          remember(envelope);
        }
        const after=await readIndex();if(!after)throw new Error("Mission index disappeared after capability confirmation");
        const ids=new Set(after.items.map(item=>item.missionId));
        const sameIds=after.workspaceId===index.workspaceId&&ids.size===index.items.length&&index.items.every(item=>ids.has(item.missionId));
        if(!missing&&sameIds){
          for(const id of envelopes.keys())if(!ids.has(id))envelopes.delete(id);
          // This remains an eventually consistent collection, as before: each
          // full payload meets the opening index's revision floor. Concurrent
          // later revisions are read on the next poll, never relabelled here.
          return structuredClone(index.items.map(item=>{
            const envelope=envelopes.get(item.missionId);
            if(!envelope||envelope.revision<item.revision)throw new Error("Incomplete Mission snapshot");
            return envelope;
          }));
        }
        index=after;
      }
      throw new Error("Mission identities changed during synchronization");
    },
  };
}
