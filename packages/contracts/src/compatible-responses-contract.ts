import {z} from "zod";

/** Only the non-streaming response fields consumed by compatible model adapters. */
export const CompatibleResponsesEnvelopeSchema=z.object({
  status:z.string().max(64).nullish(),
  error:z.object({
    message:z.string().max(8192).optional(),
    param:z.string().max(256).nullish(),
    code:z.string().max(256).nullish(),
  }).passthrough().nullish(),
  output_text:z.string().max(2_000_000).nullish(),
  output:z.array(z.object({
    content:z.array(z.object({
      type:z.string().max(128).optional(),
      text:z.string().max(2_000_000).optional(),
    }).passthrough()).max(1024).nullish(),
  }).passthrough()).max(1024).nullish(),
}).passthrough();

export type CompatibleResponsesEnvelope=z.infer<typeof CompatibleResponsesEnvelopeSchema>;
