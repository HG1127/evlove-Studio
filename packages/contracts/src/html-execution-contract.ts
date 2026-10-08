import { z } from "zod";
import { TestCaseSchema } from "./evolve-schemas";

export const SandboxHtmlValidationRequestSchema = z.object({
  id: z.string().min(1).max(256).optional(),
  html: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 20 * 1024 * 1024, "HTML must contain 1 byte to 20 MiB"),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  testCases: z.array(TestCaseSchema).min(1).max(100),
}).strict();
export type SandboxHtmlValidationRequest = z.infer<typeof SandboxHtmlValidationRequestSchema>;
