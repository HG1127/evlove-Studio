import { z } from "zod";
/** Original-source compiled data only; no caller-supplied executable function enters the owned native realm. */
export const HtmlProtectionWholeClipboardValueProgramSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('native-lexical-string'),bindingName:z.string().min(1).max(512)}).strict(),
 z.object({kind:z.literal('literal'),text:z.string().max(2*1024*1024)}).strict(),
 z.object({kind:z.literal('control-dataset-element-text'),datasetProperty:z.string().regex(/^[a-z][a-zA-Z0-9]*$/).max(128),clone:z.boolean(),removeSelectors:z.array(z.string().min(1).max(2048)).max(32),getter:z.enum(['innerText','textContent']),trim:z.boolean()}).strict(),
]);
export type HtmlProtectionWholeClipboardValueProgram=z.infer<typeof HtmlProtectionWholeClipboardValueProgramSchema>;
