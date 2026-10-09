import {z} from "zod";
import {CompatibleResponsesEnvelopeSchema} from "./compatible-responses-contract";

/** Non-streaming compatible Chat fields consumed by our adapters; extra provider metadata is retained. */
export const CompatibleChatEnvelopeSchema=CompatibleResponsesEnvelopeSchema.extend({
  message:z.string().max(8192).nullish(),
  choices:z.array(z.object({
    finish_reason:z.string().max(128).nullish(),
    text:z.string().max(2_000_000).nullish(),
    message:z.object({
      content:z.union([z.string().max(2_000_000),z.array(z.object({
        type:z.string().max(128).optional(),text:z.string().max(2_000_000).nullish(),refusal:z.string().max(8192).nullish(),
      }).passthrough()).max(1024)]).nullish(),
      reasoning_content:z.string().max(2_000_000).nullish(),
      refusal:z.string().max(8192).nullish(),
      tool_calls:z.array(z.unknown()).max(128).nullish(),
      function_call:z.record(z.string(),z.unknown()).nullish(),
    }).passthrough().nullish(),
  }).passthrough()).max(1024).nullish(),
  usage:z.object({completion_tokens:z.number().int().nonnegative().optional(),output_tokens:z.number().int().nonnegative().optional()}).passthrough().nullish(),
}).passthrough();
export type CompatibleChatEnvelope=z.infer<typeof CompatibleChatEnvelopeSchema>;
