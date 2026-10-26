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

/** Complete, non-executable body anchors; offsets refer to the same physical full HTML parent. */
export const HtmlBodyEditAnchorSchema=z.object({
  anchorId:z.string().min(1).max(100),element:z.string().min(1).max(100),section:z.string().max(200),
  before:z.string().min(1).max(64_000),start:z.number().int().nonnegative(),end:z.number().int().positive(),
}).strict().refine(value=>value.end>value.start&&value.before.length===value.end-value.start,"Body anchor length or source offsets differ");
export const HtmlSemanticComponentSchema=z.object({section:z.string().regex(/^slide-\d+$/),label:z.string().min(1).max(200),paragraphCount:z.literal(2)}).strict();
export const HTML_BUILD_BODY_CONTEXT_VERSION="html-build-body-context-v1";
export const HtmlBuildBodyContextSchema=z.object({
  schemaVersion:z.literal(HTML_BUILD_BODY_CONTEXT_VERSION),parentSha256:z.string().regex(/^[a-f0-9]{64}$/),
  anchors:z.array(HtmlBodyEditAnchorSchema).min(1).max(4096),components:z.array(HtmlSemanticComponentSchema).max(1000),
}).strict().refine(value=>value.anchors.every(anchor=>anchor.anchorId===`t${anchor.start.toString(36)}_${anchor.end.toString(36)}-${value.parentSha256.slice(0,16)}`),"Body anchors do not bind the declared physical parent");
export const HtmlSemanticLayoutIssueSchema=z.object({
  section:z.string().max(200),label:z.string().max(200),
  code:z.enum(["missing-or-ambiguous-component","paragraph-count-changed","new-content-outside-rendered-slots"]),
  expectedParagraphs:z.literal(2),actualParagraphs:z.number().int().nonnegative().optional(),
}).strict();

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
