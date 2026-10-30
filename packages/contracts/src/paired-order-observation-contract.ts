import {z} from "zod";
import {PairedJudgeContextSchema} from "./paired-judge-contract";
import {PairedEvaluationAiResultSchema,type PairedJudgeRequest} from "./ai-schemas";
import {ServerAiResponseProvenanceSchema} from "./ai-response-provenance-contract";
export const PairedOrderObservationSchema=z.object({schemaVersion:z.literal("paired-order-observation-v2"),
 context:PairedJudgeContextSchema,scoringRouteFingerprint:z.string().min(1).max(200),
 order:z.union([z.literal(0),z.literal(1)]),resultSha256:z.string().regex(/^[a-f0-9]{64}$/),
 response:PairedEvaluationAiResultSchema,responseProvenance:z.array(ServerAiResponseProvenanceSchema).min(1).max(4)}).strict()
 .refine(v=>v.response.requestFingerprint===v.context.inputFingerprint+":"+v.order)
 .refine(v=>new Set(v.responseProvenance.map(p=>p.request.callId)).size===v.responseProvenance.length)
 .refine(v=>v.responseProvenance.every(p=>p.pairedRequestFingerprint===v.response.requestFingerprint&&p.request.route.operation==="evaluate-paired"
   &&p.request.scope.missionId===v.context.missionId&&(!p.request.scope.candidateId||p.request.scope.candidateId===v.context.candidateId)))
 .refine(v=>JSON.stringify(v).length<=1_000_000,"Paired order persistence exceeds the evidence budget");
export type PairedOrderObservation=z.infer<typeof PairedOrderObservationSchema>;
export interface PairedOrderJournalPort {
 read(request:PairedJudgeRequest,route:string):Promise<unknown[]>;
 save(observation:PairedOrderObservation):Promise<void>;
}
