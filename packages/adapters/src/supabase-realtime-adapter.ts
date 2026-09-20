import type { EvolveProject, EvolutionEvent, EvolutionJob, SupabaseBackendConfig } from "@evolution/contracts";
import {
  createSupabaseBackendClient,
  supabaseRowToEvent,
  supabaseRowToJob,
  supabaseRowToMission,
} from "./supabase-production-adapter";

type Row = Record<string, unknown>;

export type SupabaseRealtimeHandlers = {
  onMissionUpsert?(mission:EvolveProject):void;
  onMissionDelete?(missionId:string):void;
  onJobUpsert?(job:EvolutionJob):void;
  onJobDelete?(jobId:string):void;
  onEventInsert?(event:EvolutionEvent):void;
  onArtifactChange?(artifactId:string,event:"INSERT"|"UPDATE"|"DELETE"):void;
  onStatus?(status:string):void;
  onError?(error:unknown):void;
};

function idOf(row:unknown){
  if(!row||typeof row!=="object")return undefined;
  const id=(row as Row).id;
  return typeof id==="string"?id:undefined;
}

export function subscribeSupabaseProductionRealtime(config:SupabaseBackendConfig,handlers:SupabaseRealtimeHandlers){
  const client=createSupabaseBackendClient(config);
  const channel=client.channel("evolution-production-v1")
    .on("postgres_changes",{event:"*",schema:"public",table:"missions"},(payload)=>{
      try{
        if(payload.eventType==="DELETE"){
          const id=idOf(payload.old);
          if(id)handlers.onMissionDelete?.(id);
        }else{
          handlers.onMissionUpsert?.(supabaseRowToMission(payload.new as Row));
        }
      }catch(error){handlers.onError?.(error);}
    })
    .on("postgres_changes",{event:"*",schema:"public",table:"jobs"},(payload)=>{
      try{
        if(payload.eventType==="DELETE"){
          const id=idOf(payload.old);
          if(id)handlers.onJobDelete?.(id);
        }else{
          handlers.onJobUpsert?.(supabaseRowToJob(payload.new as Row));
        }
      }catch(error){handlers.onError?.(error);}
    })
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"events"},(payload)=>{
      try{handlers.onEventInsert?.(supabaseRowToEvent(payload.new as Row));}
      catch(error){handlers.onError?.(error);}
    })
    .on("postgres_changes",{event:"*",schema:"public",table:"artifacts"},(payload)=>{
      const id=idOf(payload.eventType==="DELETE"?payload.old:payload.new);
      if(id)handlers.onArtifactChange?.(id,payload.eventType);
    })
    .subscribe((status,error)=>{
      handlers.onStatus?.(status);
      if(error)handlers.onError?.(error);
    });

  return {
    unsubscribe:async()=>{await client.removeChannel(channel);},
  };
}

export type SupabaseRealtimeHealth = {
  ready:boolean;
  status:string;
  latencyMs?:number;
  message:string;
};

export async function checkSupabaseRealtimeHealth(config:SupabaseBackendConfig,timeoutMs=5000):Promise<SupabaseRealtimeHealth>{
  const client=createSupabaseBackendClient(config);
  const id=`evt-rt-${crypto.randomUUID()}`;
  const channelName=`evolution-realtime-check-${id}`;
  const started=Date.now();
  let inserted=false;
  let channel:ReturnType<typeof client.channel>|undefined;

  const result=await new Promise<SupabaseRealtimeHealth>((resolve)=>{
    let settled=false;
    const finish=(value:SupabaseRealtimeHealth)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer=setTimeout(()=>finish({
      ready:false,
      status:"timeout",
      message:"Realtime 未在时限内收到数据库变更；请确认已执行 Realtime migration。",
    }),timeoutMs);

    channel=client.channel(channelName)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"events",filter:`id=eq.${id}`},()=>{
        finish({ready:true,status:"SUBSCRIBED",latencyMs:Date.now()-started,message:"Supabase Realtime 已收到真实 Event 推送"});
      })
      .subscribe(async(status,error)=>{
        if(error){
          finish({ready:false,status:"error",message:`Realtime 连接失败：${error.message}`});
          return;
        }
        if(status==="SUBSCRIBED"&&!inserted){
          inserted=true;
          const at=new Date().toISOString();
          const {error:insertError}=await client.from("events").insert({
            id,
            schema_version:"event-v1",
            type:"JobProgress",
            source:"realtime-self-test",
            payload:{selfTest:true},
            at,
          });
          if(insertError)finish({ready:false,status:"insert-failed",message:`Realtime 自检写入失败：${insertError.message}`});
        }else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"){
          finish({ready:false,status,message:`Realtime Channel 状态：${status}`});
        }
      });
  });

  try{await client.from("events").delete().eq("id",id);}catch{/* cleanup is best effort */}
  if(channel)await client.removeChannel(channel);
  return result;
}
