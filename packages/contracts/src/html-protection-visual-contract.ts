import { z } from "zod";
const identity = z.string().min(1).max(512), sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const region = z.object({ x: z.number().nonnegative(), y: z.number().nonnegative(), width: z.number().positive(), height: z.number().positive() }).strict();
export const HtmlProtectionVisualObservationsSchema = z.object({ schemaVersion: z.literal("html-protection-visual-observations-v1"),
  observations: z.array(z.object({ observationId: identity, originalImageSha256: sha256, executedImageSha256: sha256,
    nativeComparisonSha256: sha256.nullable().optional(),
    status: z.enum(["retained", "changed", "unavailable"]), originalRegions: z.array(region).max(100), executedRegions: z.array(region).max(100),
    observedRendering: z.string().min(1).max(8000), differences: z.array(z.string().min(1).max(2000)).max(100),
  }).strict()).min(1).max(2),
}).strict();
export type HtmlProtectionVisualObservations = z.infer<typeof HtmlProtectionVisualObservationsSchema>;
