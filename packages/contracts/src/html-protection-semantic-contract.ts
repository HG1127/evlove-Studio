import { z } from "zod";
import { HtmlProtectionOperationalScopeSchema } from "./html-protection-operational-scope-contract";
import { AcceptanceCriterionSchema, TestCaseSchema } from "./evolve-schemas";
const identity = z.string().min(1).max(512), sha256 = z.string().regex(/^[a-f0-9]{64}$/);
/** Complete frozen domain input, not permission supplied by a Candidate or a model. The App must authenticate its stored owner/paper. */
export const HtmlProtectionSemanticFrozenRequirementsSchema = z.object({
  schemaVersion: z.literal("html-protection-semantic-frozen-requirements-v1"),
  missionId: identity, sourceArtifactId: identity, criterionId: identity, paperSha256: sha256,
  testCase: TestCaseSchema, paper: z.array(TestCaseSchema).min(1), rubric: z.array(AcceptanceCriterionSchema).min(1),
  operationalScope: HtmlProtectionOperationalScopeSchema.optional(),
  goal: z.string(), evolutionCommand: z.string(), protectedItems: z.array(z.string()), editableItems: z.array(z.string()),
}).strict();
export type HtmlProtectionSemanticFrozenRequirements = z.infer<typeof HtmlProtectionSemanticFrozenRequirementsSchema>;
const citation = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive(),
  quote: z.string().min(1).max(4000) }).strict().refine(item => item.end > item.start, "Citation range must be nonempty");
/** Individual semantic observations, not overall quality scores, safety or acceptance verdicts. */
export const HtmlProtectionSemanticObservationsSchema = z.object({
  schemaVersion: z.literal("html-protection-semantic-observations-v3"),
  observations: z.array(z.object({ obligationId: identity, observationId: identity, observationOrigin: z.enum(["selected-model","exact-full-identity"]),
    originalRenderedRange: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().refine(range=>range.end>=range.start),
    executedRenderedRange: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().refine(range=>range.end>=range.start), originalContentSha256: sha256, executedContentSha256: sha256,
    originalRenderedSha256: sha256, executedRenderedSha256: sha256, requirementsSha256: sha256,
    status: z.enum(["retained", "changed", "unavailable"]),
    originalCitations: z.array(citation).max(50), executedCitations: z.array(citation).max(50),
    originalRenderedCitations: z.array(citation).max(512), executedRenderedCitations: z.array(citation).max(512),
    observedMeaning: z.string().min(1).max(8000), differences: z.array(z.string().min(1).max(2000)).max(100),
  }).strict()).min(1).max(16),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 2 * 1024 * 1024, "Semantic observations exceed the complete 2MiB result budget");
export type HtmlProtectionSemanticObservations = z.infer<typeof HtmlProtectionSemanticObservationsSchema>;
