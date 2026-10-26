import {z} from "zod";

export const PLANNING_DOCUMENT_CONTEXT_VERSION="planning-document-context-v1";
export const PLANNING_DOCUMENT_TOTAL_CHARS=128_000;
export const PLANNING_ARTIFACT_CONTEXT_CHARS=200_000;
export const PlanningDocumentContextSchema=z.object({
  schemaVersion:z.literal(PLANNING_DOCUMENT_CONTEXT_VERSION),sourceArtifactId:z.string().min(1),currentVersion:z.string().min(1),
  parentSha256:z.string().regex(/^[0-9a-f]{64}$/),inputChars:z.number().int().positive(),text:z.string().min(1).max(64_000),textChars:z.number().int().positive(),
  complete:z.literal(true),outline:z.array(z.object({index:z.number().int().nonnegative(),id:z.string().max(200),title:z.string().max(500)}).strict()).max(1024),
  excludes:z.tuple([z.literal("scripts"),z.literal("styles"),z.literal("templates"),z.literal("noscript"),z.literal("svg"),z.literal("executable-attributes"),z.literal("runtime-verdicts")]),
}).strict().refine(value=>value.text.length===value.textChars,"Planning body text length mismatch");
export type PlanningDocumentContext=z.infer<typeof PlanningDocumentContextSchema>;
