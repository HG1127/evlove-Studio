import { z } from "zod";

export const SupabaseBackendConfigSchema = z.object({
  url: z.string().url(),
  anonKey: z.string().min(20),
  artifactBucket: z.string().min(1).max(63).regex(/^[a-z0-9][a-z0-9._-]*$/).default("evolution-artifacts"),
});
export type SupabaseBackendConfig = z.infer<typeof SupabaseBackendConfigSchema>;
