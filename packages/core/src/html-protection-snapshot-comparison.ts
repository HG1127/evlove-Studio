import {
  HTML_PROTECTION_SNAPSHOT_LIMITS,
  HtmlProtectionSnapshotRequestSchema,
  HtmlProtectionSnapshotResultSchema,
  type HtmlProtectionProofBinding,
  type HtmlProtectionSnapshotBody,
  type HtmlProtectionSnapshotRequest,
  type HtmlProtectionSnapshotResult,
} from "@evolution/contracts";

type Role = "original" | "executed";
type BootBody = Extract<HtmlProtectionSnapshotBody, { projection: "boot-subtree-v1" }>;
type ScopeBase = { sourceArtifactId: string; originalSha256: string };
export type HtmlProtectionSnapshotRegisteredScopes = ScopeBase & (
  | { projection: "boot-subtree-v1"; targets: readonly {
    targetId: string; root: { name: string; namespace: string | null; id: string | null };
    originalElementIds: readonly string[];
  }[] }
  | { projection: "search-membership-v1"; targetId: string; cardIds: readonly string[]; chapterIds: readonly string[];
    stateKind: "boot" | "query" | "clear"; inputValue: string }
  | { projection: "copy-material-v1"; targetIds: readonly string[] }
);
export type HtmlProtectionSnapshotComparisonExpected = {
  binding: HtmlProtectionProofBinding;
  policyVersion: string;
  planSha256: string;
  registrySha256: string;
  registry: HtmlProtectionSnapshotRequest["registry"];
  stateId: string;
  batchId: string;
  execution: Record<Role, HtmlProtectionSnapshotRequest["execution"]>;
  documentUrl: Record<Role, string>;
  registeredScopes: HtmlProtectionSnapshotRegisteredScopes;
};
export type HtmlProtectionSnapshotComparisonFact = {
  scope: string;
  field: string;
  status: "match" | "missing" | "changed" | "unavailable";
  original?: unknown;
  executed?: unknown;
};
export type HtmlProtectionSnapshotComparisonGap = { code: string; scope: string; role?: Role };
export type HtmlProtectionSnapshotAdditionalItem = {
  role: Role;
  scope: string;
  kind: "element-id" | "node-position" | "card" | "chapter";
  value: unknown;
};
const expectedKeys = ["binding", "policyVersion", "planSha256", "registrySha256", "registry", "stateId", "batchId", "execution", "documentUrl", "registeredScopes"];
const equal = (left: unknown, right: unknown) => canonical(left) === canonical(right);
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
}
function closed(value: unknown, keys: readonly string[]) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)));
}
function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= HTML_PROTECTION_SNAPSHOT_LIMITS.nodes
    && value.every(item => typeof item === "string" && item.length > 0) && new Set(value).size === value.length;
}
function expectedRequests(expected: HtmlProtectionSnapshotComparisonExpected) {
  if (!closed(expected, expectedKeys) || !closed(expected.execution, ["original", "executed"])
    || !closed(expected.documentUrl, ["original", "executed"])) throw Error("Invalid expected comparison");
  const request = (role: Role) => HtmlProtectionSnapshotRequestSchema.parse({
    schemaVersion: "html-protection-snapshot-request-v1", binding: expected.binding, sourceRole: role,
    documentUrl: expected.documentUrl[role], policyVersion: expected.policyVersion, planSha256: expected.planSha256,
    registrySha256: expected.registrySha256, registry: expected.registry, execution: expected.execution[role],
    stateId: expected.stateId, batchId: expected.batchId,
  });
  return { original: request("original"), executed: request("executed") };
}
function validateScopes(scopes: HtmlProtectionSnapshotRegisteredScopes, request: HtmlProtectionSnapshotRequest) {
  const base = ["sourceArtifactId", "originalSha256", "projection"];
  if (!scopes || scopes.sourceArtifactId !== request.binding.original.sourceArtifactId
    || scopes.originalSha256 !== request.binding.original.sha256 || scopes.projection !== request.registry.projection) throw Error("Unbound Original scopes");
  if (scopes.projection === "boot-subtree-v1" && request.registry.projection === "boot-subtree-v1") {
    if (!closed(scopes, [...base, "targets"]) || !Array.isArray(scopes.targets)
      || !equal(scopes.targets.map(item => item.targetId), request.registry.targets.map(item => item.targetId))) throw Error("Incomplete registered targets");
    for (const target of scopes.targets) {
      if (!closed(target, ["targetId", "root", "originalElementIds"]) || !closed(target.root, ["name", "namespace", "id"])
        || typeof target.root.name !== "string" || !target.root.name.length
        || !(target.root.namespace === null || typeof target.root.namespace === "string")
        || !(target.root.id === null || typeof target.root.id === "string" && target.root.id.length > 0)
        || !ids(target.originalElementIds) || target.root.id !== null && !target.originalElementIds.includes(target.root.id)) throw Error("Invalid Original root/ID scope");
    }
  } else if (scopes.projection === "search-membership-v1" && request.registry.projection === "search-membership-v1") {
    if (!closed(scopes, [...base, "targetId", "cardIds", "chapterIds", "stateKind", "inputValue"])
      || scopes.targetId !== request.registry.targetId || !ids(scopes.cardIds) || !ids(scopes.chapterIds)
      || !["boot", "query", "clear"].includes(scopes.stateKind) || typeof scopes.inputValue !== "string"
      || scopes.stateKind === "clear" && scopes.inputValue !== "") throw Error("Invalid Original membership/state scope");
  } else if (scopes.projection === "copy-material-v1" && request.registry.projection === "copy-material-v1") {
    if (!closed(scopes, [...base, "targetIds"]) || !ids(scopes.targetIds)
      || !equal(scopes.targetIds, request.registry.targets.map(item => item.targetId))) throw Error("Incomplete copy targets");
  } else throw Error("Unsupported expected projection");
}
const nodeId = (node: BootBody["targets"][number]["nodes"][number]) =>
  node.attributes.find(attribute => attribute.name === "id" && attribute.namespace === null)?.value ?? null;
function materialIssues(body: HtmlProtectionSnapshotBody): string[] {
  const issues: string[] = [];
  let collected = 0, textBytes = 0;
  const size = (text: string | null) => {
    if ((text?.length ?? 0) > HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes) { issues.push("native-text-limit-exceeded"); return 0; }
    return new TextEncoder().encode(text ?? "").byteLength;
  };
  if (body.projection === "boot-subtree-v1") {
    for (const target of body.targets) {
      if (target.matchCount !== 1 || !target.nodes.length) issues.push("missing-or-ambiguous-subtree");
      if (target.nodes.length > body.counters.scannedNodes) issues.push("cropped-scan-count");
      collected += target.nodes.length;
      const depths: number[] = [], elementIds: string[] = [];
      let metadataCharacters = 0;
      for (const node of target.nodes) {
        depths.push(node.parent === null ? 0 : depths[node.parent]! + 1);
        if (depths[node.index]! > HTML_PROTECTION_SNAPSHOT_LIMITS.depth) issues.push("depth-limit-exceeded");
        if (node.assignedOutsideTarget > 0) issues.push("slot-outside-target");
        const parent = node.parent === null ? undefined : target.nodes[node.parent];
        if (node.edge === "shadow" && (node.type !== 11 || parent?.type !== 1)
          || node.edge === "template" && (node.type !== 11 || parent?.type !== 1 || parent.name !== "TEMPLATE")
          || node.assignedIndexes.length > 0 && (node.type !== 1 || node.name !== "SLOT")) issues.push("invalid-native-container");
        if (node.type !== 1 && (node.attributes.length || node.namespace !== null)) issues.push("invalid-native-node");
        if (new Set(node.attributes.map(attribute => canonical([attribute.namespace, attribute.name]))).size !== node.attributes.length) issues.push("duplicate-native-attribute");
        const id = nodeId(node); if (id !== null) elementIds.push(id);
        metadataCharacters += node.name.length + (node.namespace?.length ?? 0)
          + node.attributes.reduce((sum, attribute) => sum + attribute.name.length + (attribute.namespace?.length ?? 0), 0);
        if (metadataCharacters > HTML_PROTECTION_SNAPSHOT_LIMITS.bodyUtf8Bytes) issues.push("native-metadata-limit-exceeded");
        textBytes += size(node.value) + node.attributes.reduce((sum, attribute) => sum + size(attribute.value), 0);
      }
      if (new Set(elementIds).size !== elementIds.length || elementIds.some(id => !id.length)) issues.push("missing-or-duplicate-element-id");
    }
  } else {
    for (const rows of [body.cards, body.chapters]) {
      if (rows.some(row => !row.id) || new Set(rows.map(row => row.id)).size !== rows.length) issues.push("missing-or-duplicate-member-id");
      if (rows.length > body.counters.scannedNodes) issues.push("cropped-scan-count");
      textBytes += rows.reduce((sum, row) => sum + size(row.id) + size(row.classAttribute) + size(row.chapterId), 0);
    }
    if (body.input.matchCount !== 1 || body.input.tag !== "INPUT" || body.input.value === null
      || body.count.matchCount !== 1 || body.count.text === null) issues.push("missing-or-unsupported-search-control");
    collected = body.cards.length + body.chapters.length + Number(body.input.matchCount === 1) + Number(body.count.matchCount === 1);
    textBytes += size(body.input.value) + size(body.count.text);
  }
  if (collected !== body.counters.collectedNodes || textBytes !== body.counters.textUtf8Bytes) issues.push("incomplete-native-counters");
  return [...new Set(issues)];
}

/**
 * Compare selected native projection facts against independently registered Original-only scope.
 * Expected binding/plan/registry/state/batch and scopes MUST come from the trusted caller's frozen
 * Original, never Candidate output, AI prose or either received snapshot's self-reported metadata.
 * DTO/Zod/realm/stability fields do not authenticate observations. The caller independently owns
 * served physical bytes, controller provenance, digests and observation authority.
 * This Original-reference comparison is not paired Hidden current/Candidate evidence.
 * No preservation, authorization, semantic/visual, verification or whole-protection verdict is produced.
 */
export function compareHtmlProtectionSnapshots(args: {
  original: HtmlProtectionSnapshotResult;
  executed: HtmlProtectionSnapshotResult;
  expected: HtmlProtectionSnapshotComparisonExpected;
}) {
  const facts: HtmlProtectionSnapshotComparisonFact[] = [], gaps: HtmlProtectionSnapshotComparisonGap[] = [];
  const additionalItems: HtmlProtectionSnapshotAdditionalItem[] = [];
  const gap = (code: string, scope: string, role?: Role) => gaps.push({ code, scope, ...(role ? { role } : {}) });
  const unavailable = (scope = "comparison") => facts.push({ scope, field: "native-material", status: "unavailable" });
  const fact = (scope: string, field: string, original: unknown, executed: unknown) => facts.push({
    scope, field, status: executed === undefined ? "missing" : equal(original, executed) ? "match" : "changed", original, executed,
  });
  let expectedComparison: Pick<HtmlProtectionSnapshotComparisonExpected, "binding" | "policyVersion" | "planSha256" | "registrySha256" | "stateId" | "batchId"> & { projection: HtmlProtectionSnapshotRequest["registry"]["projection"] } | undefined;
  const result = () => ({ ...(expectedComparison ? { expectedComparison } : {}), schemaVersion: "html-protection-snapshot-comparison-v1" as const,
    facts, additionalItems, gaps, limitations: [
      "Selected Original-reference facts only; not paired Hidden current/Candidate evidence or whole protection.",
      "DTO/Zod/native realm fields are not observation authority or physical provenance; the caller independently authenticates trusted controller records.",
      "Equal digests, counts or fragments do not establish preserved source behavior, semantics, visuals or complete script closure.",
      "Additional items are unapproved observations; independent authorization policy and all unresolved obligations remain required.",
    ] });
  let requests: ReturnType<typeof expectedRequests>;
  try {
    if (!closed(args, ["original", "executed", "expected"])) throw Error("Invalid comparison arguments");
    requests = expectedRequests(args.expected); validateScopes(args.expected.registeredScopes, requests.original);
    const request = requests.original;
    expectedComparison = { binding: request.binding, policyVersion: request.policyVersion, planSha256: request.planSha256,
      registrySha256: request.registrySha256, stateId: request.stateId, batchId: request.batchId, projection: request.registry.projection };
  } catch { gap("invalid-independent-expectation", "comparison"); unavailable(); return result(); }
  const snapshots = { original: HtmlProtectionSnapshotResultSchema.safeParse(args.original), executed: HtmlProtectionSnapshotResultSchema.safeParse(args.executed) };
  for (const role of ["original", "executed"] as const) {
    const parsed = snapshots[role];
    if (!parsed.success) { gap("invalid-snapshot-contract", "comparison", role); continue; }
    const snapshot = parsed.data;
    for (const field of Object.keys(requests[role]) as (keyof HtmlProtectionSnapshotRequest)[]) {
      if (!equal(snapshot.request[field], requests[role][field])) gap("request-" + field + "-mismatch", "comparison", role);
    }
    const physical = requests[role].binding[role];
    if (snapshot.physicalInput.sha256 !== physical.sha256 || snapshot.physicalInput.byteLength !== physical.byteLength) gap("physical-role-binding-mismatch", "comparison", role);
    if (snapshot.availability !== "available" || !snapshot.projectionComplete || !snapshot.realm || !snapshot.stability || !snapshot.body) gap("native-projection-unavailable", "comparison", role);
    for (const item of [...snapshot.gaps, ...(snapshot.body?.gaps ?? [])]) gap("native-" + item.code, item.targetId ?? "comparison", role);
    if (snapshot.body) {
      const issues = materialIssues(snapshot.body);
      for (const issue of issues) gap(issue, "comparison", role);
      if (!issues.length && new TextEncoder().encode(canonical(snapshot.body)).byteLength !== snapshot.bodyUtf8Bytes) gap("native-body-size-mismatch", "comparison", role);
      if (snapshot.body.projection === "boot-subtree-v1" && requests[role].registry.projection === "boot-subtree-v1"
        && !equal(snapshot.body.targets.map(target => target.targetId), requests[role].registry.targets.map(target => target.targetId))) gap("registered-body-target-coverage-mismatch", "comparison", role);
      if (snapshot.body.projection === "search-membership-v1" && requests[role].registry.projection === "search-membership-v1"
        && snapshot.body.targetId !== requests[role].registry.targetId) gap("registered-body-target-coverage-mismatch", "comparison", role);
    }
  }
  if (gaps.length || !snapshots.original.success || !snapshots.executed.success
    || !snapshots.original.data.body || !snapshots.executed.data.body) { unavailable(); return result(); }
  const before = snapshots.original.data.body, after = snapshots.executed.data.body, scopes = args.expected.registeredScopes;
  if (before.projection === "boot-subtree-v1" && after.projection === "boot-subtree-v1" && scopes.projection === "boot-subtree-v1") {
    for (const [targetIndex, scope] of scopes.targets.entries()) {
      const original = before.targets[targetIndex]!, executed = after.targets[targetIndex]!;
      const originalRoot = original.nodes[0]!, executedRoot = executed.nodes[0]!;
      if (originalRoot.type !== 1 || originalRoot.name !== scope.root.name || originalRoot.namespace !== scope.root.namespace || nodeId(originalRoot) !== scope.root.id) {
        gap("original-root-scope-mismatch", scope.targetId, "original");
      }
      const allowedIds = new Set(scope.originalElementIds);
      for (const role of ["original", "executed"] as const) for (const node of (role === "original" ? original : executed).nodes) {
        const id = nodeId(node);
        if (id !== null && !allowedIds.has(id)) {
          additionalItems.push({ role, scope: scope.targetId, kind: "element-id", value: { id, nodeIndex: node.index } });
          if (role === "original") gap("unregistered-original-element", scope.targetId, role);
        }
      }
      const observedIds = new Set(original.nodes.map(nodeId).filter(id => id !== null));
      if (scope.originalElementIds.some(id => !observedIds.has(id))) gap("original-ID-scope-missing", scope.targetId, "original");
      if (executedRoot.type !== 1 || executedRoot.name !== scope.root.name || executedRoot.namespace !== scope.root.namespace
        || scope.root.id !== null && nodeId(executedRoot) !== scope.root.id) gap("executed-root-scope-mismatch", scope.targetId, "executed");
    }
    if (gaps.length) { unavailable(); return result(); }
    for (const [targetIndex, scope] of scopes.targets.entries()) {
      const original = before.targets[targetIndex]!, executed = after.targets[targetIndex]!;
      fact(scope.targetId, "ordered-node-count", original.nodes.length, executed.nodes.length);

      for (const id of scope.originalElementIds) {
        const beforeNode = original.nodes.find(node => nodeId(node) === id), afterNode = executed.nodes.find(node => nodeId(node) === id);
        fact(scope.targetId, "element-ID:" + id, beforeNode?.index, afterNode?.index);
      }
      for (const node of original.nodes) {
        const observed = executed.nodes[node.index];
        for (const field of ["index", "parent", "edge", "type", "name", "namespace", "value", "attributes", "assignedIndexes", "assignedOutsideTarget"] as const) {
          fact(scope.targetId, "node[" + node.index + "]." + field, node[field], observed?.[field]);
        }
      }
      for (const node of executed.nodes.slice(original.nodes.length)) additionalItems.push({ role: "executed", scope: scope.targetId, kind: "node-position", value: node });
    }
  } else if (before.projection === "search-membership-v1" && after.projection === "search-membership-v1" && scopes.projection === "search-membership-v1") {
    for (const kind of ["cards", "chapters"] as const) {
      const expectedIds = kind === "cards" ? scopes.cardIds : scopes.chapterIds;
      const originalIds = before[kind].map(row => row.id);
      if (expectedIds.some(id => !originalIds.includes(id))) gap("original-" + kind + "-scope-missing", scopes.targetId, "original");
      for (const role of ["original", "executed"] as const) for (const row of (role === "original" ? before : after)[kind]) {
        if (!expectedIds.includes(row.id!)) additionalItems.push({ role, scope: scopes.targetId, kind: kind === "cards" ? "card" : "chapter", value: row });
      }
    }
    if (before.input.value !== scopes.inputValue || after.input.value !== scopes.inputValue) gap("independent-search-state-mismatch", scopes.targetId);
    if (gaps.length || additionalItems.some(item => item.role === "original")) {
      if (additionalItems.some(item => item.role === "original")) gap("unregistered-original-membership", scopes.targetId, "original");
      unavailable(scopes.targetId); return result();
    }
    for (const kind of ["cards", "chapters"] as const) {
      const expectedIds = kind === "cards" ? scopes.cardIds : scopes.chapterIds;
      fact(scopes.targetId, kind + ".ordered-IDs", before[kind].map(row => row.id), after[kind].map(row => row.id));
      for (const id of expectedIds) {
        const original = before[kind].find(row => row.id === id)!, executed = after[kind].find(row => row.id === id);
        for (const field of ["id", "tag", "namespace", "classAttribute", "hidden", "display", "ancestorDisplayNone", "chapterId"] as const) {
          fact(scopes.targetId, kind + "[" + id + "]." + field, original[field], executed?.[field]);
        }
      }
    }
    for (const field of ["matchCount", "tag", "value"] as const) fact(scopes.targetId, "input." + field, before.input[field], after.input[field]);
    for (const field of ["matchCount", "text"] as const) fact(scopes.targetId, "count." + field, before.count[field], after.count[field]);
  } else { gap("unsupported-projection-comparison", "comparison"); unavailable(); }
  for (const item of additionalItems) gap("additional-" + item.kind, item.scope, item.role);
  return result();
}
export type HtmlProtectionSnapshotComparison = ReturnType<typeof compareHtmlProtectionSnapshots>;
