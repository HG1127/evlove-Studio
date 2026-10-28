import {z} from "zod";

export const PLANNING_DOCUMENT_CONTEXT_VERSION="planning-document-context-v2";
export const PLANNING_DOCUMENT_TOTAL_CHARS=128_000;
export const PLANNING_ARTIFACT_CONTEXT_CHARS=200_000;
const fields={sourceArtifactId:z.string().min(1),currentVersion:z.string().min(1),
  parentSha256:z.string().regex(/^[0-9a-f]{64}$/),inputChars:z.number().int().positive(),text:z.string().min(1).max(64_000),textChars:z.number().int().positive(),
  complete:z.literal(true),
  excludes:z.tuple([z.literal("scripts"),z.literal("styles"),z.literal("templates"),z.literal("noscript"),z.literal("svg"),z.literal("executable-attributes"),z.literal("runtime-verdicts")]),
};
const outline={index:z.number().int().nonnegative(),id:z.string().max(200),title:z.string().max(500)};
const element=z.string().min(1).max(200),count=z.number().int().positive();
export const HtmlStaticLocatorFactsSchema=z.object({
  schemaVersion:z.literal("html-static-locator-facts-v1"),scope:z.literal("source-body-markup"),complete:z.literal(true),
  tagCounts:z.array(z.object({element,count}).strict()).max(1024),
  idElements:z.array(z.object({id:z.string().min(1).max(200),element,classes:z.array(z.string().min(1).max(200)).max(128)}).strict()).max(16384),
  classCounts:z.array(z.object({element,className:z.string().min(1).max(200),count}).strict()).max(16384),
}).strict();
export type HtmlStaticLocatorFacts=z.infer<typeof HtmlStaticLocatorFactsSchema>;
/** Strict v1 is retained; old records gain no invented element or locator observation. */
export const PlanningDocumentContextV1Schema=z.object({...fields,schemaVersion:z.literal("planning-document-context-v1"),
  outline:z.array(z.object(outline).strict()).max(1024),
}).strict().refine(value=>value.text.length===value.textChars,"Planning body text length mismatch");
export const PlanningDocumentContextV2Schema=z.object({...fields,schemaVersion:z.literal("planning-document-context-v2"),
  outline:z.array(z.object({...outline,element}).strict()).max(1024),locatorFacts:HtmlStaticLocatorFactsSchema,
}).strict().refine(value=>value.text.length===value.textChars,"Planning body text length mismatch");
export const PlanningDocumentContextSchema=z.discriminatedUnion("schemaVersion",[PlanningDocumentContextV1Schema,PlanningDocumentContextV2Schema]);
export type PlanningDocumentContext=z.infer<typeof PlanningDocumentContextSchema>;
