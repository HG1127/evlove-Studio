import { createHash } from "node:crypto";
import { z } from "zod";
import { HtmlProtectionVisualObservationsSchema } from "@evolution/contracts";
import { runServerAi, type ServerAiMedia } from "./ai-gateway";
import type { HtmlProtectionObligation, HtmlProtectionEvidence } from "@evolution/contracts";
import type { HtmlProtectionObligationPlan } from "@evolution/core";
import { prepareServerHtmlProtectionNativeVisualComparison } from "./server-html-protection-native-visual";
import { htmlProtectionCanonicalJson } from "./server-html-protection-authority-attestation";
/** Native full-document observations stay separate from semantic/static decisions. */
export function deriveServerHtmlProtectionVisualObservations(args: { plan: HtmlProtectionObligationPlan;
  originalDocuments: Array<{ stateId: string; material: unknown }>;
  executedDocuments: Array<{ stateId: string; material: unknown }>;
  nativeComplete: boolean; expectedDocumentStates: readonly string[];
}) {
  const observations: Array<{ obligationId: string; verificationStatus: HtmlProtectionEvidence["verificationStatus"]; detail: string }> = [];
  const completeStates = args.nativeComplete && args.expectedDocumentStates.length > 0
    && new Set(args.expectedDocumentStates).size === args.expectedDocumentStates.length
    && args.expectedDocumentStates.every(id => args.originalDocuments.filter(item => item.stateId === id).length === 1
      && args.executedDocuments.filter(item => item.stateId === id).length === 1);
  const knownComparisons = completeStates ? args.expectedDocumentStates.map(stateId => ({ stateId,
    equalNativeMaterial: htmlProtectionCanonicalJson(args.originalDocuments.find(item => item.stateId === stateId)!.material)
      === htmlProtectionCanonicalJson(args.executedDocuments.find(item => item.stateId === stateId)!.material) })) : [];
  for (const obligation of args.plan.requiredObligations.filter(item => item.evidenceKind === "visual")) {
    observations.push({ obligationId: obligation.id, verificationStatus: completeStates ? "partial" : "unverified",
      detail: completeStates ? "All registered actual native style/layout document records are retained; " + knownComparisons.length
        + " viewport comparisons are measured. Pixel/full responsive authority is still required; native metadata equality alone cannot close visual preservation."
        : "Complete actual Original/executed native style/layout records are unavailable for every registered document state" });
  }
  return { evidence: observations, supportedObligationIds: [] as string[], knownComparisons,
    gaps: ["html-protection-full-visual-observation-unavailable"],
    required: args.plan.requiredObligations.filter((item): item is HtmlProtectionObligation => item.evidenceKind === "visual") };
}

const dimensions = z.object({ width: z.number().finite().positive(), height: z.number().finite().positive() }).strict();
const region = dimensions.extend({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict();
const Tile = z.object({ value: z.object({ image: z.object({ mimeType: z.literal("image/png"), base64: z.string().max(6 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive().max(4 * 1024 * 1024) }).strict(),
  region, viewport: dimensions, documentSize: dimensions, before: z.unknown(), after: z.unknown(),
  nativeScrollDispatches: z.number().int().nonnegative() }).strict() }).passthrough();
type NativeTile = { stateId: string; material: unknown };
export type ServerHtmlProtectionVisualPair = { observationId: string; stateId: string;
  original: z.infer<typeof Tile>["value"]; executed: z.infer<typeof Tile>["value"];
  nativeComparison?: ReturnType<typeof prepareServerHtmlProtectionNativeVisualComparison> };
function parsedTiles(records: readonly NativeTile[], states: readonly string[]) {
  if (!states.length || new Set(states).size !== states.length || !records.length) throw Error("html-protection-full-visual-state-unavailable");
  const map = new Map<string, Array<z.infer<typeof Tile>["value"]>>();
  for (const state of states) {
    const matching = records.filter(item => item.stateId.startsWith(state + ":tile:"));
    if (!matching.length) throw Error("html-protection-full-visual-tile-missing");
    let covered = 0, priorY = -1, priorScroll = -1;
    const tiles: Array<z.infer<typeof Tile>["value"]> = [];
    for (let index = 0; index < matching.length; index++) {
      const record = matching[index]!;
      if (record.stateId !== state + ":tile:" + index) throw Error("html-protection-full-visual-tile-reordered");
      const tile = Tile.parse(record.material).value, bytes = Buffer.from(tile.image.base64, "base64");
      if (bytes.toString("base64") !== tile.image.base64 || bytes.length !== tile.image.byteLength
        || createHash("sha256").update(bytes).digest("hex") !== tile.image.sha256 || bytes.length < 33
        || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString("ascii", 12, 16) !== "IHDR"
        || Math.abs(bytes.readUInt32BE(16) - tile.region.width) > 1 || Math.abs(bytes.readUInt32BE(20) - tile.region.height) > 1) throw Error("html-protection-full-visual-pixels-invalid");
      if (tile.region.x !== 0 || tile.region.width !== tile.viewport.width || tile.documentSize.width > tile.viewport.width + 1
        || tile.region.y > covered + 1 || tile.region.y <= priorY || tile.region.y + tile.region.height > tile.documentSize.height + 1
        || tile.region.height !== Math.min(tile.viewport.height, tile.documentSize.height - tile.region.y)
        || tile.nativeScrollDispatches < priorScroll || index > 0 && tile.nativeScrollDispatches <= priorScroll
        || tiles.length && (htmlProtectionCanonicalJson(tile.documentSize) !== htmlProtectionCanonicalJson(tiles[0]!.documentSize)
          || htmlProtectionCanonicalJson(tile.viewport) !== htmlProtectionCanonicalJson(tiles[0]!.viewport))) throw Error("html-protection-full-visual-document-coverage-invalid");
      priorY = tile.region.y; priorScroll = tile.nativeScrollDispatches; covered = Math.max(covered, tile.region.y + tile.region.height); tiles.push(tile);
    }
    if (covered < tiles[0]!.documentSize.height - 1) throw Error("html-protection-full-visual-bottom-uncovered");
    map.set(state, tiles);
  }
  if (records.some(record => !states.some(state => record.stateId.startsWith(state + ":tile:")))) throw Error("html-protection-foreign-visual-state");
  return map;
}
/** Complete, actual read-back pixels for both source roles and every registered viewport; finite pixels alone do not close continuous responsive scope. */
export function prepareServerHtmlProtectionVisualPairs(args: { originalTiles: readonly NativeTile[]; executedTiles: readonly NativeTile[];
  expectedDocumentStates: readonly string[]; nativeComplete: boolean;
  operationalDocuments?: {original:readonly NativeTile[];executed:readonly NativeTile[]} }) {
  if (!args.nativeComplete) throw Error("html-protection-native-visual-sequence-incomplete");
  const original = parsedTiles(args.originalTiles, args.expectedDocumentStates), executed = parsedTiles(args.executedTiles, args.expectedDocumentStates);
  const pairs: ServerHtmlProtectionVisualPair[] = [];
  for (const stateId of args.expectedDocumentStates) {
    const left = original.get(stateId)!, right = executed.get(stateId)!;
    let nativeComparison: ServerHtmlProtectionVisualPair["nativeComparison"];
    if(args.operationalDocuments){
      const a=args.operationalDocuments.original.filter(item=>item.stateId===stateId),b=args.operationalDocuments.executed.filter(item=>item.stateId===stateId);
      if(a.length!==1||b.length!==1)throw Error("operational-native-visual-document-state-missing");
      nativeComparison=prepareServerHtmlProtectionNativeVisualComparison(a[0]!.material,b[0]!.material);
    }
    if (htmlProtectionCanonicalJson(left[0]!.viewport) !== htmlProtectionCanonicalJson(right[0]!.viewport)) throw Error("html-protection-paired-visual-viewport-mismatch");
    // Extra Candidate height is also observed. Reusing the last counterpart avoids dropping any actual PNG bytes.
    for (let index = 0; index < Math.max(left.length, right.length); index++) pairs.push({ observationId: stateId + ":pair:" + index,
      stateId, ...(nativeComparison?{nativeComparison}:{}), original: left[Math.min(index, left.length - 1)]!, executed: right[Math.min(index, right.length - 1)]! });
  }
  return pairs;
}
const wholeRegion = (tile: ServerHtmlProtectionVisualPair["original"]) => ({ x: 0, y: 0, width: tile.region.width, height: tile.region.height });
/** Exact exhaustive image scope and all raw observations are reconstructed from private physical records during restoration. */
export function validateServerHtmlProtectionVisualObservations(args: { pairs: readonly ServerHtmlProtectionVisualPair[]; raw: readonly unknown[];
  required: readonly HtmlProtectionObligation[]; unresolvedRuntimeObligationIds: readonly string[] }) {
  const raw = args.raw.map(item => HtmlProtectionVisualObservationsSchema.parse(item)), rows = raw.flatMap(item => item.observations);
  if (!args.pairs.length || new Set(args.pairs.map(item => item.observationId)).size !== args.pairs.length
    || new Set(rows.map(item => item.observationId)).size !== rows.length || rows.some(item => !args.pairs.some(pair => pair.observationId === item.observationId))) throw Error("html-protection-visual-observation-scope-ambiguous");
  let unavailable = false, failed = false;
  for (const pair of args.pairs) {
    const row = rows.find(item => item.observationId === pair.observationId);
    if (!row) { unavailable = true; continue; }
    if (pair.nativeComparison && row.nativeComparisonSha256 !== pair.nativeComparison.sha256) throw Error("operational-visual-native-comparison-not-observed");
    if (!pair.nativeComparison && row.nativeComparisonSha256) throw Error("operational-visual-native-comparison-foreign");
    if (row.originalImageSha256 !== pair.original.image.sha256 || row.executedImageSha256 !== pair.executed.image.sha256
      || row.status === "retained" && (htmlProtectionCanonicalJson(row.originalRegions) !== htmlProtectionCanonicalJson([wholeRegion(pair.original)])
        || htmlProtectionCanonicalJson(row.executedRegions) !== htmlProtectionCanonicalJson([wholeRegion(pair.executed)]))
      || row.status === "changed" && (!row.differences.length || !row.originalRegions.length)) throw Error("html-protection-visual-observation-binding-invalid");
    for (const [regions, tile] of [[row.originalRegions, pair.original], [row.executedRegions, pair.executed]] as const) {
      if (regions.some(value => value.x + value.width > tile.region.width || value.y + value.height > tile.region.height)) throw Error("html-protection-visual-observation-region-foreign");
    }
    failed ||= row.status === "changed"; unavailable ||= row.status === "unavailable";
  }
  // Complete real finite image coverage plus independently closed source/runtime/responsive obligations is needed.
  const complete = !unavailable && !args.unresolvedRuntimeObligationIds.length;
  const required = args.required.filter(item => item.evidenceKind === "visual");
  return { raw, supportedObligationIds: complete ? required.map(item => item.id) : [],
    evidence: required.map(item => ({ obligationId: item.id, verificationStatus: failed ? "failed" as const : complete ? "verified" as const : "partial" as const,
      detail: "Actual complete paired PNG tile observations: " + rows.length + "/" + args.pairs.length + "; source/runtime/responsive residuals: " + args.unresolvedRuntimeObligationIds.length })),
    gaps: [...(unavailable ? ["html-protection-selected-model-full-visual-observation-unavailable"] : []),
      ...(args.unresolvedRuntimeObligationIds.length ? ["html-protection-continuous-responsive-scope-unclosed"] : [])] };
}
/** The same selected direct connection receives the actual PNG bytes; an unsupported image route remains a real gap. */
export async function collectServerHtmlProtectionVisualObservations(args: { pairs: readonly ServerHtmlProtectionVisualPair[];
  binding: unknown; originalHtml: string; executedHtml: string; required: readonly HtmlProtectionObligation[]; unresolvedRuntimeObligationIds: readonly string[] },
  observe: (payload: unknown, media: ServerAiMedia) => Promise<unknown> = (payload, media) => runServerAi("html-protection-visual-observe", payload, media)) {
  const raw: unknown[] = [], gaps: string[] = [];
  for (let index = 0; index < args.pairs.length; index += 2) {
    const pairs = args.pairs.slice(index, index + 2);
    try { const response = await observe({ binding: args.binding, fullPhysicalOriginalHtml: args.originalHtml, fullPhysicalExecutedHtml: args.executedHtml,
      pairs: pairs.map(pair => ({ observationId: pair.observationId, stateId: pair.stateId,
        ...(pair.nativeComparison ? {nativeComparison:pair.nativeComparison,confirmedPolicy:"original-finite-operational-v2",instruction:"Read the COMPLETE native node/style/layout differences alongside both actual images. Retained requires all changes to preserve the Original visual meaning, controls and layout except explicitly allowed existing body text refinement flow. Changed non-flow behavior or style loss must be changed; unknown must be unavailable. Echo the exact nativeComparison.sha256."} : {}),
        original: { ...pair.original, image: { ...pair.original.image, base64: undefined } }, executed: { ...pair.executed, image: { ...pair.executed.image, base64: undefined } },
        requiredOriginalRegion: wholeRegion(pair.original), requiredExecutedRegion: wholeRegion(pair.executed) })),
      instruction: "Observe the entire actual paired image regions and identify original rendering changes. All PNG tiles on both roles are processed; additions are contextualized by both complete physical files. Return grounded image observations, never whole safety or responsive/runtime PASS." },
    { imageDataUrls: pairs.flatMap(pair => ["data:image/png;base64," + pair.original.image.base64, "data:image/png;base64," + pair.executed.image.base64]) });
      const parsed = HtmlProtectionVisualObservationsSchema.parse(response);
      if (parsed.observations.some(item => !pairs.some(pair => pair.observationId === item.observationId))) throw Error("html-protection-visual-response-outside-requested-batch");
      validateServerHtmlProtectionVisualObservations({ ...args, raw: [...raw, parsed] }); raw.push(parsed);
    } catch { gaps.push("html-protection-selected-model-visual-observation-unavailable"); break; }
  }
  const validated = validateServerHtmlProtectionVisualObservations({ ...args, raw });
  return { ...validated, gaps: [...new Set([...validated.gaps, ...gaps])] };
}
