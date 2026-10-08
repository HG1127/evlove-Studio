import { z } from "zod";

export const TextArtifactEditSchema = z.object({
  before: z.string().min(1),
  after: z.string(),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
}).strict();

/** The existing text-edits blueprint, validated before applying model output. */
export const TextArtifactEditsSchema = z.object({
  kind: z.literal("text-edits"),
  edits: z.array(TextArtifactEditSchema).min(1).max(256),
}).strict();
export type TextArtifactEdit = z.infer<typeof TextArtifactEditSchema>;
