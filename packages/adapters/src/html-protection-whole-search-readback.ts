import { z } from "zod";
import type { HtmlProtectionWholeRuntimeRequest, HtmlProtectionWholeRuntimeActionFactSchema } from "@evolution/contracts";
import { selectHtmlProtectionWholeSearchPredicate, evaluateHtmlProtectionWholeSearchPredicate } from "@evolution/core";
import { htmlProtectionCloudCanonicalJson as canonical } from "./vercel-sandbox-html-protection-cloud-protocol";
const identity = z.string().min(1), digest = z.string().regex(/^[a-f0-9]{64}$/);
const Source = z.object({ parentId: identity, scriptId: identity, sourceSha256: digest, sourceCharacters: z.number().int().nonnegative(), frameId: identity, contextUniqueId: identity, url: z.string(), nativeSourceLocation: z.object({ line: z.number().int().nonnegative(), column: z.number().int().nonnegative() }).strict() }).strict();
const Claim = z.discriminatedUnion("availability", [
  z.object({ availability: z.literal("unavailable"), gaps: z.array(identity).min(1) }).strict(),
  z.object({ availability: z.enum(["observed", "failed"]), profile: z.unknown(), source: Source }).strict(),
]);
/** Re-derive the search fact from complete native material and the physical Original; stored claims grant no authority. */
export function validateHtmlProtectionWholeSearchReadback(args: { request: HtmlProtectionWholeRuntimeRequest; facts: Array<z.infer<typeof HtmlProtectionWholeRuntimeActionFactSchema>>; sourceMaterial: unknown }) {
  const sources = z.object({ scripts: z.array(Source.passthrough()) }).passthrough().safeParse(args.sourceMaterial);
  for (const fact of args.facts) {
    if (fact.action.operation !== "fill" || fact.nativeObservation === undefined) continue;
    const observation = z.object({ behaviorClaims: z.object({ search: z.unknown() }).strict().optional(), events: z.unknown().optional(), after: z.object({ value: z.object({ target: z.object({ value: z.string() }).passthrough(), globals: z.array(z.object({ attributes: z.array(z.tuple([z.string(), z.string()])) }).passthrough()) }).passthrough() }).passthrough().optional() }).passthrough().parse(fact.nativeObservation);
    if (!observation.behaviorClaims) { if (fact.status === "observed") throw Error("Whole search observation lacks independent source claim"); continue; }
    const claim = Claim.parse(observation.behaviorClaims.search);
    const selected = selectHtmlProtectionWholeSearchPredicate({ sourcePlan: args.request.sourcePlan, subjectScriptLocations: args.request.subjectScriptLocations, nativeEvents: observation.events });
    if (claim.availability === "unavailable") {
      if (fact.gaps.includes("actual-search-membership-transition-mismatch")) throw Error("Whole unavailable search cannot claim known product failure");
      if (selected.availability === "unavailable" && canonical(claim.gaps) !== canonical(selected.gaps)) throw Error("Whole unavailable search source gaps differ");
      continue;
    }
    if (selected.availability !== "available" || canonical(selected.profile) !== canonical(claim.profile) || !sources.success) throw Error("Whole search source predicate not independently bound");
    const source = sources.data.scripts.find(source => source.scriptId === selected.profile.nativeScriptId && source.parentId === selected.profile.parentId);
    if (!source || canonical(Source.strip().parse(source)) !== canonical(claim.source) || source.contextUniqueId !== selected.profile.nativeContextUniqueId || source.frameId !== selected.profile.nativeFrameId) throw Error("Whole search physical native script identity differs");
    const after = observation.after?.value;
    if (!after || after.target.value !== fact.action.value) throw Error("Whole search query did not reach actual native input");
    const cards = after.globals.filter(card => (new Map(card.attributes).get("class") ?? "").split(/\s+/).includes("slide-card"));
    if (!cards.length || cards.some(card => !new Map(card.attributes).has("data-search"))) throw Error("Whole search native card catalog incomplete");
    const mismatch = cards.some(card => { const attributes = new Map(card.attributes); return (attributes.get("class") ?? "").split(/\s+/).includes("search-hidden") === evaluateHtmlProtectionWholeSearchPredicate(selected.profile, attributes.get("data-search")!, fact.action.value!); });
    if ((claim.availability === "failed") !== mismatch || (claim.availability === "failed" && (fact.status !== "failed" || !fact.gaps.includes("actual-search-membership-transition-mismatch"))) || (claim.availability === "observed" && fact.status !== "observed")) throw Error("Whole search status differs from independently observed membership");
  }
}
