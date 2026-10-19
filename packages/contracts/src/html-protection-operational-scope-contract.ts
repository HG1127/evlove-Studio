import { z } from "zod";
import { HtmlProtectionArtifactIdentitySchema } from "./html-protection-proof-contract";
/** Explicit human-confirmed acceptance contract. This DTO is not observation or execution authority. */
export const HtmlProtectionOperationalScopeSchema = z.object({
  schemaVersion: z.literal("html-protection-operational-scope-v2"),
  policy: z.literal("original-finite-operational-v2"),
  original: HtmlProtectionArtifactIdentitySchema,
  content: z.literal("existing-card-body-text-only"),
  runtime: z.literal("all-original-registered-controls-and-states"),
  visual: z.literal("all-original-derived-viewports-and-tiles"),
  outsideScope: z.literal("unverified"),
  universalProtectionProved: z.literal(false),
  confirmedBy: z.object({ actorId: z.string().min(1).max(512), actorSource: z.enum(["browser-session","trusted-header","internal-dev"]) }).strict(),
  confirmedAt: z.string().datetime({ offset: true }),
  rubricVersion: z.number().int().positive(),
  humanReviewNote: z.string().min(10).max(8000),
  /** Complete canonical frozen input, compared exactly; never a short noncryptographic hash. */
  targetContract: z.string().min(1).max(2 * 1024 * 1024),
}).strict();
export type HtmlProtectionOperationalScope = z.infer<typeof HtmlProtectionOperationalScopeSchema>;

const confirmationBase = { missionId:z.string().min(1).max(512), expectedRevision:z.number().int().nonnegative(), humanReviewNote:z.string().min(10).max(8000) };
export const HtmlProtectionOperationalConfirmationRequestSchema=z.discriminatedUnion("confirm",[
  z.object({...confirmationBase,confirm:z.literal(false)}).strict(),
  z.object({...confirmationBase,confirm:z.literal(true),targetContractSha256:z.string().regex(/^[a-f0-9]{64}$/),original:HtmlProtectionArtifactIdentitySchema}).strict(),
]);

/** Report boundary only; the private independently reconstructed capability is still mandatory. */
export const HtmlProtectionOperationalReportScopeSchema=HtmlProtectionOperationalScopeSchema.pick({policy:true,original:true,content:true,runtime:true,visual:true,outsideScope:true,universalProtectionProved:true,confirmedAt:true,confirmedBy:true});
