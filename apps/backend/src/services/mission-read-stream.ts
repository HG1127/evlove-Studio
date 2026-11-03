import {MissionEnvelopeSchema,MissionReadFailureReasonSchema,type MissionEnvelope,type MissionReadStreamRecord} from "@evolution/contracts";
import {z} from "zod";
const KnownFailureSchema=z.object({statusCode:z.literal(503),data:z.object({code:z.literal("SERVER_DATA_PLANE_UNAVAILABLE"),reason:MissionReadFailureReasonSchema})});
const version="mission-read-stream-v1" as const;
/** Pending frames keep the transport alive. Only the final validated receipt
 * publishes state; errors and interrupted streams never become empty Missions. */
export function missionReadStream(read:(signal:AbortSignal)=>Promise<MissionEnvelope|undefined>){
  const abort=new AbortController();let closed=false;
  let heartbeat:ReturnType<typeof setInterval>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
  const clear=()=>{clearInterval(heartbeat);clearTimeout(deadline);};
  return new Response(new ReadableStream<Uint8Array>({
    start(controller){
      const emit=(record:MissionReadStreamRecord)=>{
        if(closed)return;
        const bytes=new TextEncoder().encode(JSON.stringify(record)+"\n");
        // Preserve byte boundaries even when a terminal receipt exceeds 6 MB.
        for(let offset=0;offset<bytes.length;offset+=64*1024)controller.enqueue(bytes.subarray(offset,offset+64*1024));
      };
      const finish=(record:MissionReadStreamRecord)=>{if(closed)return;emit(record);closed=true;clear();controller.close();};
      emit({schemaVersion:version,type:"pending"});
      heartbeat=setInterval(()=>{if(!closed)emit({schemaVersion:version,type:"pending"});},10_000);
      deadline=setTimeout(()=>{
        abort.abort();finish({schemaVersion:version,type:"error",failure:{code:"SERVER_DATA_PLANE_UNAVAILABLE",status:503,reason:"network-error"}});
      },120_000);
      void (async()=>{
        try{
          const value=await read(abort.signal);if(closed)return;
          if(!value){finish({schemaVersion:version,type:"error",failure:{code:"MISSION_NOT_FOUND",status:404,reason:"not-found"}});return;}
          const envelope=MissionEnvelopeSchema.parse(value);
          if(envelope.payload.id!==envelope.missionId)throw new Error("Mission identity mismatch");
          finish({schemaVersion:version,type:"complete",envelope});
        }catch(error){
          if(closed)return;
          const known=KnownFailureSchema.safeParse(error);
          finish({schemaVersion:version,type:"error",failure:{code:"SERVER_DATA_PLANE_UNAVAILABLE",status:503,reason:known.success?known.data.data.reason:error instanceof z.ZodError?"invalid-response":"unknown"}});
        }
      })().catch(()=>{if(!closed){closed=true;clear();abort.abort();controller.error(new Error("Mission stream failed"));}});
    },
    cancel(){closed=true;clear();abort.abort();},
  }),{headers:{"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-store, no-transform","X-Content-Type-Options":"nosniff"}});
}
