import type { HtmlProtectionWholeRuntimeSourcePlan } from "@evolution/contracts";
import { htmlProtectionScriptEffectProfile } from "./html-protection-script-effect-profile";

type Range = { startOffset: number; endOffset: number; count: number };
type NativeScript = { parentId: string; sourceSha256: string; sourceCharacters: number; frameId: string;
  coveragePresent: boolean; functions: Array<{ ranges: Range[]; isBlockCoverage: boolean }> };
type SourceCoverage = { producer: string; scripts: NativeScript[]; unmatched: unknown[]; missingParentIds: string[]; gaps: string[] };
/** Full-span precise coverage only. Positive V8 counts retain partial execution evidence, never successful effect or parent proof. */
export function assessHtmlProtectionScriptEffectExecution(args: { sourcePlan: HtmlProtectionWholeRuntimeSourcePlan; original: SourceCoverage; executed: SourceCoverage }) {
  const parents = args.sourcePlan.scriptShape.map(source => {
    const literal = source.literal?.replace(/\r\n?/g, "\n") ?? null, profile = htmlProtectionScriptEffectProfile({ parentId: source.id, literal });
    const role = (coverage: SourceCoverage) => {
      const found = coverage.scripts.filter(script => script.parentId === source.id);
      return coverage.producer === "chromium-v8-precise-source-coverage-v1" && !coverage.unmatched.length && !coverage.gaps.length && !coverage.missingParentIds.includes(source.id)
        && found.length === 1 && found[0]?.coveragePresent && found[0]?.sourceCharacters === (literal?.length ?? 0) ? found[0] : undefined;
    };
    const original = role(args.original), executed = role(args.executed), binding = original && executed && original.sourceSha256 === executed.sourceSha256;
    const observations = profile.effects.map(effect => {
      const originalCoverage = binding ? spanCoverage(original!, effect.sourceRange, literal!.length) : { count: null, gap: "native-source-identity-or-execution-missing" };
      const executedCoverage = binding ? spanCoverage(executed!, effect.sourceRange, literal!.length) : { count: null, gap: "native-source-identity-or-execution-missing" };
      return { obligationId: effect.id, verificationStatus: originalCoverage.count !== null && originalCoverage.count > 0 && executedCoverage.count !== null && executedCoverage.count > 0 ? "partial" as const : "unverified" as const,
        originalCount: originalCoverage.count, executedCount: executedCoverage.count, gaps: [originalCoverage.gap, executedCoverage.gap].filter((value): value is string => Boolean(value)) };
    });
    const unexecutedRangeCount = [original, executed].reduce((sum, script) => sum + (script?.functions.flatMap(fn => fn.ranges).filter(range => range.count === 0).length ?? 0), 0);
    return { parentId: source.id, sourceGraphComplete: profile.completeSourceGraph, completeEffectClassification: profile.completeEffectClassification, sourceBindingPresent: Boolean(binding), observations,
      unexecutedEffectIds: observations.filter(item => item.verificationStatus === "unverified").map(item => item.obligationId), unexecutedRangeCount,
      sourceBranchIds: profile.branches.map(branch => branch.id), sourceFunctionIds: profile.functions.map(fn => fn.id),
      gaps: [...new Set([...profile.gaps, ...observations.flatMap(item => item.gaps), ...(unexecutedRangeCount ? ["actual-source-range-not-executed"] : []), "source-effect-success-and-causality-unproved"])],
      parentVerificationStatus: "partial" as const, support: "unresolved" as const };
  });
  return { policyVersion: "native-source-effect-full-span-execution-v2", parents, supportedParentIds: [] as string[], unresolvedParentIds: parents.map(parent => parent.parentId),
    limitations: ["Complete Original AST children remain independently regenerated; native coverage requires physical producer and source-digest authentication by the App.",
      "Full-span block counts observe actual execution only. They do not establish successful DOM effects, predicates, all data or future event sequences."] };
}
function spanCoverage(script: NativeScript, span: { start: number; end: number }, sourceLength: number): { count: number | null; gap?: string } {
  const functions = script.functions.filter(fn => fn.ranges.some(range => range.startOffset <= span.start && range.endOffset >= span.end));
  if (!functions.length) return { count: null, gap: "actual-effect-span-uncovered" };
  // Choose the lexical function covering the entire expression; function-only coverage cannot refine its branches.
  const selected = functions.sort((a, b) => extent(a.ranges) - extent(b.ranges))[0]!;
  if (!selected.isBlockCoverage) return { count: null, gap: "native-block-coverage-unavailable" };
  const ranges = selected.ranges;
  if (!ranges.length || ranges.some(range => !Number.isSafeInteger(range.startOffset) || !Number.isSafeInteger(range.endOffset) || !Number.isSafeInteger(range.count)
    || range.startOffset < 0 || range.endOffset > sourceLength || range.endOffset <= range.startOffset || range.count < 0)) return { count: null, gap: "invalid-native-source-range" };
  for (let i = 0; i < ranges.length; i++) for (let j = i + 1; j < ranges.length; j++) {
    const a = ranges[i]!, b = ranges[j]!, overlap = a.startOffset < b.endOffset && b.startOffset < a.endOffset;
    if (overlap && !((a.startOffset <= b.startOffset && a.endOffset >= b.endOffset) || (b.startOffset <= a.startOffset && b.endOffset >= a.endOffset))) return { count: null, gap: "ambiguous-native-source-range" };
    if (a.startOffset === b.startOffset && a.endOffset === b.endOffset && a.count !== b.count) return { count: null, gap: "ambiguous-native-source-range" };
  }
  const boundaries = [...new Set([span.start, span.end, ...ranges.flatMap(range => [range.startOffset, range.endOffset]).filter(position => position > span.start && position < span.end)])].sort((a, b) => a - b);
  let minimum = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const covering = ranges.filter(range => range.startOffset <= boundaries[i]! && range.endOffset >= boundaries[i + 1]!).sort((a, b) => (a.endOffset - a.startOffset) - (b.endOffset - b.startOffset));
    if (!covering.length) return { count: null, gap: "actual-effect-span-uncovered" };
    minimum = Math.min(minimum, covering[0]!.count);
  }
  return minimum === 0 ? { count: 0, gap: "actual-effect-span-not-executed" } : { count: minimum };
}
const extent = (ranges: Range[]) => Math.max(...ranges.map(range => range.endOffset)) - Math.min(...ranges.map(range => range.startOffset));
