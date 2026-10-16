import type { HtmlProtectionWholeRuntimeSourcePlan, HtmlProtectionWholeRuntimeRegistration, HtmlProtectionWholeRuntimeActionFact } from "@evolution/contracts";
import { HtmlProtectionWholeRuntimeActionFactSchema } from "@evolution/contracts";
import { htmlProtectionWholeRuntimeActions } from "./html-protection-whole-runtime-plan";

type MaterialRecord = { record: { recordId: string; kind: "boot-census" | "action" | "document" | "visual-tile" | "script-coverage" | "diagnostic"; stateId: string; sha256: string; byteLength: number }; material: unknown };
type Role = { manifest: { request: { sourceRole: "original" | "executed"; sourcePlanSha256: string; binding: { original: HtmlProtectionWholeRuntimeSourcePlan["original"]; executed: HtmlProtectionWholeRuntimeSourcePlan["original"] }; execution: unknown };
  registration?: HtmlProtectionWholeRuntimeRegistration; availability: string; expectedActions: unknown[]; actualActionCount: number;
  custody?: { navigation: { frameId: string; loaderId: string }; staged: { sha256: string; byteLength: number }; nodeResponse: { sha256: string; byteLength: number }; browserResponse: { sha256: string; byteLength: number }; blockedRequests: number } };
  records: MaterialRecord[] };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Independent pure coverage assessment of full read-back observations. Its caller must separately establish all native/physical producer provenance. */
export function assessHtmlProtectionWholeRuntimeObservationCoverage(args: { sourcePlan: HtmlProtectionWholeRuntimeSourcePlan; original: Role; executed: Role }) {
  const { sourcePlan: plan, original, executed } = args, gaps = new Set<string>();
  const evidence: Array<{ obligationId: string; verificationStatus: "verified" | "partial" | "unverified" | "failed"; recordIds: string[] }> = [];
  const actionEvidence: Array<{ role: "original" | "executed"; action: HtmlProtectionWholeRuntimeActionFact["action"]; verificationStatus: "partial" | "unverified" | "failed"; recordIds: string[]; gaps: string[] }> = [];
  let completeNativeSequence = true;

  if (!original.manifest.registration || !executed.manifest.registration || !equal(original.manifest.registration, executed.manifest.registration)
    || original.manifest.request.sourceRole !== "original" || executed.manifest.request.sourceRole !== "executed"
    || !equal(original.manifest.request.binding, executed.manifest.request.binding)
    || !equal(original.manifest.request.execution, executed.manifest.request.execution)
    || original.manifest.request.sourcePlanSha256 !== executed.manifest.request.sourcePlanSha256
    || !equal(original.manifest.request.binding.original, plan.original)) { gaps.add("foreign-or-incomplete-runtime-pair"); completeNativeSequence = false; }
  for (const role of [original, executed]) for (const gap of role.manifest.registration?.gaps ?? []) gaps.add(gap);
  const expected = original.manifest.registration ? htmlProtectionWholeRuntimeActions(plan, original.manifest.registration) : [];
  for (const role of [original, executed]) {
    const observed: HtmlProtectionWholeRuntimeActionFact[] = [], documents = new Set<string>(), realmIds = new Set<string>();
    const custody = role.manifest.custody, physical = role.manifest.request.binding[role.manifest.request.sourceRole];
    if (!custody || custody.blockedRequests || [custody.staged, custody.nodeResponse, custody.browserResponse].some(value => value.sha256 !== physical.sha256 || value.byteLength !== physical.byteLength)) gaps.add("runtime-physical-custody-incomplete");
    for (const record of role.records) {
      if (record.record.kind === "action") {
        const parsed = HtmlProtectionWholeRuntimeActionFactSchema.safeParse(record.material);
        if (!parsed.success) { gaps.add("invalid-complete-action-material"); continue; }
        const fact = parsed.data; observed.push(fact);
        const status = fact.status === "observed" ? "partial" as const : fact.status === "failed" && fact.dispatched === 1 && fact.nativeObservation !== undefined && fact.gaps.some(isKnownBehaviorFailure) ? "failed" as const : "unverified" as const;
        actionEvidence.push({ role: role.manifest.request.sourceRole, action: fact.action, verificationStatus: status, recordIds: [record.record.recordId], gaps: [...fact.gaps] });
        if (fact.action.stateId !== record.record.stateId || !equal(fact.action, expected[observed.length - 1])) gaps.add("foreign-or-reordered-runtime-action");
        if (fact.status !== "observed" || !fact.settled || fact.dispatched !== (fact.action.operation === "boot" ? 0 : 1)
          || fact.beforeBackendNodeId === null || fact.beforeBackendNodeId !== fact.afterBackendNodeId) gaps.add("actual-native-action-unobserved");
        const before = fact.nativeObservation && typeof fact.nativeObservation === "object" && "before" in fact.nativeObservation ? (fact.nativeObservation as { before: unknown }).before : undefined;
        const after = fact.nativeObservation && typeof fact.nativeObservation === "object" && "after" in fact.nativeObservation ? (fact.nativeObservation as { after: unknown }).after : undefined;
        for (const observation of [before, after]) if (!nativeWindow(observation, custody, realmIds)) gaps.add("action-native-window-unbound");
        if (fact.action.operation === "copy") {
          const clipboard = fact.nativeObservation && typeof fact.nativeObservation === "object" && "clipboard" in fact.nativeObservation ? (fact.nativeObservation as { clipboard: unknown }).clipboard : undefined;
          if (!clipboard || typeof clipboard !== "object" || !("text" in clipboard) || typeof clipboard.text !== "string") gaps.add("actual-native-clipboard-missing");
        }
      } else if (record.record.kind === "document") {
        if (!expected.some(action => action.stateId === record.record.stateId && ["boot", "viewport"].includes(action.operation)) || documents.has(record.record.stateId)) gaps.add("foreign-native-document-state");
        documents.add(record.record.stateId); if (!nativeWindow(record.material, custody, realmIds)) gaps.add("document-native-window-unbound");
        const body = record.material && typeof record.material === "object" && "value" in record.material ? (record.material as { value: unknown }).value : undefined;
        if (!body || typeof body !== "object" || !("styleTable" in body) || !("snapshot" in body) || !("elementCount" in body)) gaps.add("complete-native-document-material-missing");
      } else if (!["script-coverage", "diagnostic"].includes(record.record.kind) && !nativeWindow(record.material, custody, realmIds)) gaps.add(record.record.kind === "visual-tile" ? "visual-native-window-unbound" : "boot-native-window-unbound");
    }
    if (realmIds.size !== 1) gaps.add("runtime-page-realm-drift");
    if (observed.length !== expected.length || role.manifest.actualActionCount !== observed.length || role.manifest.availability !== "available"
      || expected.some(action => ["boot", "viewport"].includes(action.operation) && !documents.has(action.stateId))) gaps.add("complete-native-sequence-missing");

  }
  completeNativeSequence &&= gaps.size === 0;
  // Full source parents remain present. Their causal/residual scope cannot be discharged by finite state sampling.
  for (const parentId of plan.runtimeParentIds) evidence.push({ obligationId: parentId,
    verificationStatus: completeNativeSequence ? "partial" : "unverified",
    recordIds: [...original.records, ...executed.records].filter(record => record.record.kind === "action").map(record => record.record.recordId) });
  if (plan.runtimeParentIds.length) gaps.add("source-parent-residual-closure-unproved");
  for (const gap of plan.gaps) gaps.add(gap);
  return { completeNativeSequence, evidence, actionEvidence, knownBehaviorFailures: actionEvidence.filter(item => item.verificationStatus === "failed"), supportedObligationIds: [] as string[],
    unresolvedRuntimeParentIds: [...plan.runtimeParentIds], gaps: [...gaps].sort(),
    limitations: ["Full private native readback and exact source/Job provenance must be established independently of this pure assessment.",
      "Actual actions and all-element CSS/layout observations support finite state evidence; arbitrary JS and continuous responsive residuals remain unresolved."] };
}
function nativeWindow(value: unknown, custody: Role["manifest"]["custody"], realms: Set<string>) {
  if (!value || typeof value !== "object" || !("realm" in value) || !("stability" in value) || !custody) return false;
  const realm = value.realm as { frameId?: unknown; loaderId?: unknown; uniqueContextId?: unknown }, stability = value.stability as { preMirrorSha256?: unknown; postMirrorSha256?: unknown; mutationEvents?: unknown };
  if (!realm || !stability || realm.frameId !== custody.navigation.frameId || realm.loaderId !== custody.navigation.loaderId || typeof realm.uniqueContextId !== "string"
    || typeof stability.preMirrorSha256 !== "string" || stability.preMirrorSha256 !== stability.postMirrorSha256 || stability.mutationEvents !== 0) return false;
  realms.add(realm.uniqueContextId); return true;
}

function isKnownBehaviorFailure(code: string) {
  return ["clipboard-no-native-write-observed", "actual-hover-transition-mismatch", "actual-check-transition-mismatch", "actual-menu-transition-mismatch", "actual-details-transition-mismatch",
    "actual-top-navigation-mismatch", "actual-reveal-transition-unobserved", "actual-search-membership-transition-mismatch", "actual-input-value-mismatch",
    "actual-anchor-navigation-mismatch", "actual-anchor-scroll-alignment-mismatch", "actual-anchor-target-replaced", "registered-control-replaced"].includes(code);
}