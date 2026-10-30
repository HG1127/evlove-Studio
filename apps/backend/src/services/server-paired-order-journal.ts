import {createHash} from "node:crypto";
import {inspectPairedOrderObservation} from "@evolution/harness";
import {createEvolutionEvent,PairedOrderObservationSchema,type AiUsageScope,type EvolutionEvent,
 type PairedJudgeRequest,type PairedOrderJournalPort,type AiUsageRoute,type PairedOrderObservation} from "@evolution/contracts";
import {currentServerAiUsageScope,serverAiUsageRoute} from "./server-ai-usage";
import {resolveServerAiConfig} from "./server-ai-connection";
import {serverAiConfigForOperation} from "./server-ai-role-config";
import {pairedJudgePhysicalScopeSha256} from "./server-paired-judge-claim";

type Ports={scope:AiUsageScope|undefined;physicalRoutes():Promise<AiUsageRoute[]>;list(missionId:string,limit:number):Promise<EvolutionEvent[]>;append(event:EvolutionEvent):Promise<void>;now?():string};
const source="server-paired-order-journal";
const id=(scope:string,order:number)=>"evt-paired-order-completed-"+scope+"-"+order;
function trusted(request:PairedJudgeRequest,ports:Ports){
 const s=ports.scope,c=request.context;
 if(!s?.missionId||!s.jobId||s.missionId!==c.missionId||s.candidateId&&s.candidateId!==c.candidateId)
  throw Error("Paired order journal requires trusted matching Mission/Job scope");
 return s;
}
export function createServerPairedOrderJournal(ports:Ports):PairedOrderJournalPort{
 let request:PairedJudgeRequest|undefined,route:string|undefined;
 let physicalRoutes:AiUsageRoute[]=[];
 function checkPhysical(observation:PairedOrderObservation){
  if(observation.responseProvenance.some(p=>p.request.scope.jobId!==ports.scope!.jobId||!physicalRoutes.some(r=>r.operation===p.request.route.operation&&r.model===p.request.route.model&&r.protocol===p.request.route.protocol&&r.routeFingerprint===p.request.route.routeFingerprint)))throw Error("Paired response physical model/protocol/Job binding differs");
 }
 return {
  async read(issued,issuedRoute){
   trusted(issued,ports);request=issued;route=issuedRoute;
   physicalRoutes=await ports.physicalRoutes();if(!physicalRoutes.length)throw Error("Complete physical response provenance is unavailable on this route");
   const rows=await ports.list(issued.context.missionId,1000),scopeSha=pairedJudgePhysicalScopeSha256(issued);
   if(rows.length>=1000)throw Error("Paired order lookup incomplete; preserve occupied claim");
   const claim=rows.find(r=>r.id==="evt-paired-judge-claim-"+scopeSha);
   const stored=rows.filter(r=>r.id===id(scopeSha,0)||r.id===id(scopeSha,1));
   if(stored.length&&(!claim||claim.jobId!==ports.scope!.jobId||claim.missionId!==issued.context.missionId
     ||claim.source!=="server-paired-evidence-judge"||claim.type!=="ActionPlanned"
     ||claim.payload.inputFingerprint!==issued.context.inputFingerprint))
    throw Error("Persisted paired orders do not bind the original occupied claim");
   return stored.map(event=>{
    if(event.source!==source||event.type!=="ActionCompleted"||event.jobId!==ports.scope!.jobId
      ||event.missionId!==issued.context.missionId||event.payload.measurementKind!=="paired-order-observation-v2")
     throw Error("Paired order Event identity differs");
    const observation=PairedOrderObservationSchema.parse(event.payload.observation);
    checkPhysical(observation);
    if(event.id!==id(scopeSha,observation.order))throw Error("Paired order Event index differs");
    return observation;
   });
  },
  async save(raw){
   if(!request||!route)throw Error("Read canonical paired journal before saving");
   const scope=trusted(request,ports),observation=inspectPairedOrderObservation(raw,request,route,value=>createHash("sha256").update(JSON.stringify(value)).digest("hex"));
   checkPhysical(observation);
   const scopeSha=pairedJudgePhysicalScopeSha256(request);
   const before=await ports.list(scope.missionId!,1000),claim=before.find(row=>row.id==="evt-paired-judge-claim-"+scopeSha);
   if(before.length>=1000||!claim||claim.source!=="server-paired-evidence-judge"||claim.type!=="ActionPlanned"||claim.jobId!==scope.jobId||claim.missionId!==scope.missionId||claim.payload.inputFingerprint!==request.context.inputFingerprint)throw Error("Paired order needs its original occupied claim");
   const event=createEvolutionEvent({id:id(scopeSha,observation.order),missionId:scope.missionId,jobId:scope.jobId,
    type:"ActionCompleted",source,at:ports.now?.()??new Date().toISOString(),
    payload:{measurementKind:"paired-order-observation-v2",observation}});
   // Unknown append stays unknown. Canonical replay may discover a committed result later; it never resends the model.
   await ports.append(event);
   const rows=await ports.list(scope.missionId!,1000);
   if(rows.length>=1000)throw Error("Paired order canonical readback incomplete");
   const stored=rows.filter(r=>r.id===event.id);
   if(stored.length!==1||stored[0]!.jobId!==event.jobId||stored[0]!.missionId!==event.missionId
     ||stored[0]!.source!==source||stored[0]!.type!==event.type
     ||JSON.stringify(PairedOrderObservationSchema.parse(stored[0]!.payload.observation))!==JSON.stringify(observation))
    throw Error("Paired order canonical persistence differs");
  },
 };
}
async function productionJournal(){
 const {getServerProductionRuntime}=await import("./production-runtime"),runtime=getServerProductionRuntime();
 const saved=await resolveServerAiConfig(),config=saved?serverAiConfigForOperation(saved,"evaluate-paired"):undefined;
 const routes=config?.mode==="openai-compatible"?(config.protocol?[config.protocol]:["responses","chat-completions"] as const).map(p=>serverAiUsageRoute(config,p,"evaluate-paired")):[];
 return createServerPairedOrderJournal({scope:currentServerAiUsageScope(),physicalRoutes:async()=>routes,list:(missionId,limit)=>runtime.events.list(missionId,limit),append:event=>runtime.events.append(event)});
}
export function createProductionPairedOrderJournal():PairedOrderJournalPort{
 let journal:PairedOrderJournalPort|undefined;
 return {
  async read(request,route){journal=await productionJournal();return journal.read(request,route);},
  async save(observation){if(!journal)throw Error("Paired order has no request-local journal");await journal.save(observation);},
 };
}
