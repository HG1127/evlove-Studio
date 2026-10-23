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

/** Plain body-text replacements bound to one frozen HTML parent, never executable markup. */
export const HtmlTextNodeEditsSchema = z.object({
  kind: z.literal("html-text-node-edits"),
  parentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  edits: z.array(z.object({anchorId:z.string().min(1),text:z.string()}).strict()).min(1).max(256),
}).strict();

/** Parent selection is server-owned; these IDs are issued for one SHA-verified request only. */
export const HtmlBodyNodeEditsSchema = z.object({
  kind:z.literal("html-body-node-edits-v1"),
  edits:z.array(z.object({anchorId:z.string().min(1),text:z.string()}).strict()).min(1).max(256),
}).strict();
