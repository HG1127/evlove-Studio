import {z} from "zod";
import {MissionEnvelopeSchema} from "./production-contracts";
const schemaVersion=z.literal("mission-read-stream-v1");
export const MissionReadFailureReasonSchema=z.enum(["credential-rejected","schema-unavailable","rate-limited-or-timeout","upstream-unavailable","network-error","invalid-response","unknown"]);
export const MissionReadStreamRecordSchema=z.discriminatedUnion("type",[
  z.object({schemaVersion,type:z.literal("pending")}).strict(),
  z.object({schemaVersion,type:z.literal("complete"),envelope:MissionEnvelopeSchema}).strict(),
  z.object({schemaVersion,type:z.literal("error"),failure:z.discriminatedUnion("code",[
    z.object({code:z.literal("MISSION_NOT_FOUND"),status:z.literal(404),reason:z.literal("not-found")}).strict(),
    z.object({code:z.literal("SERVER_DATA_PLANE_UNAVAILABLE"),status:z.literal(503),reason:MissionReadFailureReasonSchema}).strict(),
  ])}).strict(),
]);
export type MissionReadStreamRecord=z.infer<typeof MissionReadStreamRecordSchema>;
