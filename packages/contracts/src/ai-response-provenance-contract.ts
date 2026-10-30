import {z} from "zod";
import {AiUsageRequestStartedSchema} from "./ai-usage-contract";
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const ServerAiResponseProvenanceSchema=z.object({
  schemaVersion:z.literal("server-ai-response-provenance-v1"),request:AiUsageRequestStartedSchema,
  requestBodyTextSha256:hash,responseBodyTextSha256:hash,responseBodyUtf8Bytes:z.number().int().nonnegative(),
  httpStatus:z.number().int().min(100).max(599),receivedAt:z.iso.datetime(),
  hashScope:z.literal("fully-received-decoded-http-body-utf8"),
  pairedRequestFingerprint:z.string().min(1).max(240).optional(),
}).strict().refine(v=>v.request.granularity==="physical-http-attempt"&&v.request.route.protocol!=="ai-sdk"
  &&Boolean(v.request.scope.missionId)&&Boolean(v.request.scope.jobId));
export type ServerAiResponseProvenance=z.infer<typeof ServerAiResponseProvenanceSchema>;
