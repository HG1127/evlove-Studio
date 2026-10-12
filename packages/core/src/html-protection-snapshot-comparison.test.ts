import { describe, expect, it } from "vitest";
import {
  HtmlProtectionSnapshotLimitations, HtmlProtectionSnapshotRequestSchema, HtmlProtectionSnapshotResultSchema,
  type HtmlProtectionSnapshotBody, type HtmlProtectionSnapshotResult,
} from "@evolution/contracts";
import { compareHtmlProtectionSnapshots, type HtmlProtectionSnapshotComparisonExpected } from "./html-protection-snapshot-comparison";

type Args = Parameters<typeof compareHtmlProtectionSnapshots>[0];
type Boot = Extract<HtmlProtectionSnapshotBody, { projection: "boot-subtree-v1" }>;
type Search = Extract<HtmlProtectionSnapshotBody, { projection: "search-membership-v1" }>;
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const sha = (character: string) => character.repeat(64);
const size = (text: string | null) => new TextEncoder().encode(text ?? "").byteLength;
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
}
function finish(body: HtmlProtectionSnapshotBody) {
  if (body.projection === "boot-subtree-v1") {
    body.counters.collectedNodes = body.targets.reduce((sum, target) => sum + target.nodes.length, 0);
    body.counters.textUtf8Bytes = body.targets.reduce((total, target) => total + target.nodes.reduce((sum, node) =>
      sum + size(node.value) + node.attributes.reduce((n, attribute) => n + size(attribute.value), 0), 0), 0);
  } else {
    body.counters.collectedNodes = body.cards.length + body.chapters.length + Number(body.input.matchCount === 1) + Number(body.count.matchCount === 1);
    body.counters.textUtf8Bytes = [...body.cards, ...body.chapters].reduce((sum, row) =>
      sum + size(row.id) + size(row.classAttribute) + size(row.chapterId), 0) + size(body.input.value) + size(body.count.text);
  }
  return body;
}
function expected(): HtmlProtectionSnapshotComparisonExpected {
  return {
    binding: { missionId: "mission", testCaseId: "test", criterionId: "PROTECT-ALL", paperSha256: sha("f"),
      original: { sourceArtifactId: "source", sha256: sha("a"), byteLength: 2000 },
      executed: { sourceArtifactId: "source", sha256: sha("b"), byteLength: 2011 },
      subject: { kind: "candidate", candidateId: "candidate" } },
    policyVersion: "finite-profile-v1", planSha256: sha("e"), registrySha256: sha("d"),
    registry: { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: sha("a"),
      projection: "boot-subtree-v1", targets: [{ targetId: "card-scope", selector: "#card" }] },
    stateId: "boot", batchId: "batch-1",
    execution: { original: { executionId: "original-controller", jobId: "job", generation: 1 },
      executed: { executionId: "executed-controller", jobId: "job", generation: 1 } },
    documentUrl: { original: "https://fixture.invalid/original", executed: "https://fixture.invalid/executed" },
    registeredScopes: { sourceArtifactId: "source", originalSha256: sha("a"), projection: "boot-subtree-v1",
      targets: [{ targetId: "card-scope", root: { name: "ARTICLE", namespace: htmlNamespace, id: "card" },
        originalElementIds: ["card", "title", "content", "host", "slotted"] }] },
  };
}
function node(index: number, parent: number | null, name: string, id?: string, type = 1): Boot["targets"][number]["nodes"][number] {
  return { index, parent, edge: index === 0 ? "root" : "light", type, name, namespace: type === 1 ? htmlNamespace : null,
    value: type === 3 ? "Complete original text 😀" : null,
    attributes: id === undefined ? [] : [{ name: "id", namespace: null, value: id }], assignedIndexes: [], assignedOutsideTarget: 0 };
}
function bootBody(): Boot {
  const nodes = [node(0, null, "ARTICLE", "card"), node(1, 0, "H2", "title"), node(2, 1, "#text", undefined, 3),
    node(3, 0, "SPAN", "content"), node(4, 3, "#text", undefined, 3), node(5, 0, "DIV", "host"),
    node(6, 5, "SPAN", "slotted"), node(7, 6, "#text", undefined, 3), node(8, 5, "#document-fragment", undefined, 11),
    node(9, 8, "SLOT"), node(10, 9, "#text", undefined, 3)];
  nodes[8]!.edge = "shadow"; nodes[9]!.assignedIndexes = [6];
  return finish({ projection: "boot-subtree-v1", targets: [{ targetId: "card-scope", matchCount: 1, nodes }],
    counters: { scannedNodes: 100, collectedNodes: 0, shadowRoots: 1, textUtf8Bytes: 0 }, gaps: [] }) as Boot;
}
function snapshot(seed: HtmlProtectionSnapshotComparisonExpected, sourceRole: "original" | "executed", body: HtmlProtectionSnapshotBody): HtmlProtectionSnapshotResult {
  const request = HtmlProtectionSnapshotRequestSchema.parse({ schemaVersion: "html-protection-snapshot-request-v1",
    binding: seed.binding, sourceRole, documentUrl: seed.documentUrl[sourceRole], policyVersion: seed.policyVersion,
    planSha256: seed.planSha256, registrySha256: seed.registrySha256, registry: seed.registry,
    execution: seed.execution[sourceRole], stateId: seed.stateId, batchId: seed.batchId });
  const physical = seed.binding[sourceRole];
  return HtmlProtectionSnapshotResultSchema.parse({ schemaVersion: "html-protection-snapshot-result-v1", request,
    availability: "available", projectionComplete: true, observedAt: "2026-10-13T00:00:00Z",
    physicalInput: { sha256: physical.sha256, byteLength: physical.byteLength },
    realm: { observerVersion: "chromium-cdp-isolated-stable-dom-v2", frameId: "frame-" + sourceRole,
      loaderId: "loader-" + sourceRole, uniqueContextId: "context-" + sourceRole },
    stability: { protocol: "chromium-cdp-dom-mutation-window-v1", preMirrorSha256: sha("1"), postMirrorSha256: sha("1"), mutationEvents: 0 },
    body, bodySha256: sha("c"), bodyUtf8Bytes: size(canonical(body)), gaps: [], limitations: [...HtmlProtectionSnapshotLimitations] });
}
function boot(): Args {
  const seed = expected();
  return { expected: seed, original: snapshot(seed, "original", bootBody()), executed: snapshot(seed, "executed", bootBody()) };
}
function refresh(observation: HtmlProtectionSnapshotResult) {
  if (!observation.body) throw Error("Synthetic body required");
  finish(observation.body);
  observation.bodyUtf8Bytes = size(canonical(observation.body));
  // Intentionally retain the same digest fixture: digest equality is not the comparison.
}
function bootMaterial(observation: HtmlProtectionSnapshotResult) {
  if (observation.body?.projection !== "boot-subtree-v1") throw Error("Synthetic boot required");
  return observation.body;
}
function searchMaterial(observation: HtmlProtectionSnapshotResult) {
  if (observation.body?.projection !== "search-membership-v1") throw Error("Synthetic search required");
  return observation.body;
}
function search(clear = false): Args {
  const seed = expected(), query = clear ? "" : "query";
  seed.registry = { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: sha("a"),
    projection: "search-membership-v1", targetId: "search", cardSelector: ".card", chapterSelector: ".chapter", inputSelector: "#search", countSelector: "#count" };
  seed.stateId = clear ? "search-clear" : "search-query";
  seed.registeredScopes = { sourceArtifactId: "source", originalSha256: sha("a"), projection: "search-membership-v1",
    targetId: "search", cardIds: ["one", "two"], chapterIds: ["chapter"], stateKind: clear ? "clear" : "query", inputValue: query };
  const member = (id: string) => ({ id, tag: "ARTICLE", namespace: htmlNamespace, classAttribute: "card",
    hidden: false, display: "block", ancestorDisplayNone: false, chapterId: "chapter" });
  const body: Search = { projection: "search-membership-v1", targetId: "search", cards: [member("one"), member("two")],
    chapters: [{ ...member("chapter"), tag: "SECTION", classAttribute: "chapter" }],
    input: { matchCount: 1, tag: "INPUT", value: query }, count: { matchCount: 1, text: clear ? "2/2" : "1/2" },
    counters: { scannedNodes: 100, collectedNodes: 0, shadowRoots: 0, textUtf8Bytes: 0 }, gaps: [] };
  if (!clear) { body.cards[1]!.hidden = true; body.cards[1]!.display = "none"; body.cards[1]!.ancestorDisplayNone = true; }
  finish(body);
  return { expected: seed, original: snapshot(seed, "original", structuredClone(body)), executed: snapshot(seed, "executed", structuredClone(body)) };
}
function unavailable(result: ReturnType<typeof compareHtmlProtectionSnapshots>) {
  expect(result.gaps.length).toBeGreaterThan(0);
  expect(result.facts.some(fact => fact.status === "unavailable")).toBe(true);
  expect(result.facts.some(fact => fact.status === "match")).toBe(false);
}

describe("strict independent comparison binding before native facts", () => {
  it("compares selected native facts without any authority or whole verdict", () => {
    const args = boot(), result = compareHtmlProtectionSnapshots(args);
    expect(result.gaps).toEqual([]);
    expect(result.additionalItems).toEqual([]);
    expect(result.facts.length).toBeGreaterThan(100);
    expect(result.facts.every(fact => fact.status === "match")).toBe(true);
    expect(result.expectedComparison?.binding).toEqual(args.expected.binding);
    for (const key of ["pass", "passed", "complete", "valid", "verified", "verificationStatus", "provenance", "wholeProtectionPassed"]) expect(result).not.toHaveProperty(key);
    expect(result.limitations.join(" ")).toContain("not paired Hidden");
    expect(result.limitations.join(" ")).toContain("not observation authority");
  });
  it("rejects reversed source roles and each role's independently bound physical bytes", () => {
    const swapped = boot();
    [swapped.original, swapped.executed] = [swapped.executed, swapped.original];
    unavailable(compareHtmlProtectionSnapshots(swapped));
    for (const role of ["original", "executed"] as const) {
      const args = boot();
      args[role].physicalInput = { ...args[role === "original" ? "executed" : "original"].physicalInput };
      unavailable(compareHtmlProtectionSnapshots(args));
      args[role].physicalInput = { sha256: args.expected.binding[role].sha256, byteLength: args.expected.binding[role].byteLength + 1 };
      unavailable(compareHtmlProtectionSnapshots(args));
    }
  });
  it.each(["missionId", "testCaseId", "criterionId", "paperSha256"] as const)("rejects changed %s binding with otherwise identical material", field => {
    const args = boot();
    args.executed.request.binding[field] = field === "paperSha256" ? sha("0") : "other";
    unavailable(compareHtmlProtectionSnapshots(args));
  });
  it("rejects another subject, artifact, registry/crop or controller identity", () => {
    const cases: Array<(args: Args) => void> = [
      args => { args.executed.request.binding.subject = { kind: "current", versionId: "other-version" }; },
      args => { args.executed.request.binding.original.sha256 = sha("0"); args.executed.request.registry.originalSha256 = sha("0"); },
      args => { args.executed.request.execution.generation++; },
      args => { args.executed.request.execution.jobId = "other-job"; },
      args => { args.executed.request.documentUrl = "https://fixture.invalid/other"; },
      args => { if (args.executed.request.registry.projection === "boot-subtree-v1") args.executed.request.registry.targets[0]!.selector = "#wrong-crop"; },
    ];
    for (const change of cases) { const args = boot(); change(args); unavailable(compareHtmlProtectionSnapshots(args)); }
  });
  it.each(["policyVersion", "planSha256", "registrySha256", "stateId", "batchId"] as const)("rejects different %s instead of accepting equal DTO bodies", field => {
    const args = boot();
    args.executed.request[field] = field.endsWith("Sha256") ? sha("0") : "other";
    unavailable(compareHtmlProtectionSnapshots(args));
  });
  it.each(["realm", "stability", "body", "bodySha256", "bodyUtf8Bytes"] as const)("does not compare without %s", field => {
    const args = boot(); delete args.executed[field];
    unavailable(compareHtmlProtectionSnapshots(args));
  });
  it("retains unavailable/native gaps and rejects unstable or falsely complete material", () => {
    const args = boot();
    args.executed = { ...args.executed, availability: "unavailable", projectionComplete: false, realm: undefined,
      stability: undefined, body: undefined, bodySha256: undefined, bodyUtf8Bytes: undefined, gaps: [{ code: "capability-unavailable" }] };
    unavailable(compareHtmlProtectionSnapshots(args));
    const unstable = boot(); unstable.executed.stability!.postMirrorSha256 = sha("0");
    unavailable(compareHtmlProtectionSnapshots(unstable));
    const incomplete = boot(); incomplete.executed.projectionComplete = false;
    unavailable(compareHtmlProtectionSnapshots(incomplete));
    const closed = boot(); closed.executed.gaps = [{ code: "closed-shadow-root" }];
    unavailable(compareHtmlProtectionSnapshots(closed));
  });
  it("rejects self-reported counters, byte lengths and slot/container omissions", () => {
    const changes: Array<(body: Boot) => void> = [
      body => { body.counters.collectedNodes = 0; },
      body => { body.counters.textUtf8Bytes = 0; },
      body => { body.counters.scannedNodes = 0; },
      body => { body.targets[0]!.nodes[9]!.assignedOutsideTarget = 1; },
      body => { body.targets[0]!.nodes[3]!.assignedIndexes = [4]; },
      body => { body.targets[0]!.nodes[8]!.edge = "template"; },
      body => { body.targets[0]!.nodes[1]!.attributes.push({ ...body.targets[0]!.nodes[1]!.attributes[0]! }); },
    ];
    for (const change of changes) { const args = boot(); change(bootMaterial(args.executed)); args.executed.bodyUtf8Bytes = size(canonical(args.executed.body)); unavailable(compareHtmlProtectionSnapshots(args)); }
    const wrongBytes = boot(); wrongBytes.executed.bodyUtf8Bytes = wrongBytes.executed.bodyUtf8Bytes! + 1;
    unavailable(compareHtmlProtectionSnapshots(wrongBytes));
  });
  it("rejects missing, repeated, foreign or reordered target bodies even when hashes agree", () => {
    const cases: Array<(body: Boot) => void> = [
      body => { body.targets = []; },
      body => { body.targets.push(structuredClone(body.targets[0]!)); },
      body => { body.targets[0]!.targetId = "other-target"; },
      body => { body.targets[0]!.nodes = []; },
    ];
    for (const change of cases) { const args = boot(); change(bootMaterial(args.executed)); refresh(args.executed); unavailable(compareHtmlProtectionSnapshots(args)); }
  });
  it("rejects reordered multi-target bodies instead of matching identical cropped material", () => {
    const seed = expected();
    if (seed.registry.projection !== "boot-subtree-v1" || seed.registeredScopes.projection !== "boot-subtree-v1") throw Error("boot");
    seed.registry.targets.push({ targetId: "second-scope", selector: "#card" });
    seed.registeredScopes.targets = [...seed.registeredScopes.targets, { ...seed.registeredScopes.targets[0]!, targetId: "second-scope" }];
    const body = bootBody();
    body.targets.push({ ...structuredClone(body.targets[0]!), targetId: "second-scope" }); finish(body);
    const args: Args = { expected: seed, original: snapshot(seed, "original", structuredClone(body)), executed: snapshot(seed, "executed", structuredClone(body)) };
    expect(compareHtmlProtectionSnapshots(args).gaps).toEqual([]);
    bootMaterial(args.executed).targets.reverse(); refresh(args.executed);
    unavailable(compareHtmlProtectionSnapshots(args));
  });
  it("rejects duplicated boot element identities rather than selecting one matching occurrence", () => {
    const args = boot();
    bootMaterial(args.executed).targets[0]!.nodes[3]!.attributes[0]!.value = "card"; refresh(args.executed);
    unavailable(compareHtmlProtectionSnapshots(args));
  });
  it("preserves unavailable copy projection and never accesses clipboard or claims equality", () => {
    const seed = expected();
    seed.registry = { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: sha("a"),
      projection: "copy-material-v1", targets: [{ targetId: "copy", selector: "#copy" }] };
    seed.registeredScopes = { sourceArtifactId: "source", originalSha256: sha("a"), projection: "copy-material-v1", targetIds: ["copy"] };
    const observation = (role: "original" | "executed") => HtmlProtectionSnapshotResultSchema.parse({
      ...snapshot({ ...seed, registry: expected().registry }, role, bootBody()), request: { ...snapshot({ ...seed, registry: expected().registry }, role, bootBody()).request, registry: seed.registry },
      availability: "unavailable", projectionComplete: false, realm: undefined, stability: undefined,
      body: undefined, bodySha256: undefined, bodyUtf8Bytes: undefined, gaps: [{ code: "copy-material-undefined" }],
    });
    unavailable(compareHtmlProtectionSnapshots({ expected: seed, original: observation("original"), executed: observation("executed") }));
  });
  it("rejects wrong Original/candidate-generated expected scope and arbitrary callbacks", () => {
    const args = boot();
    if (args.expected.registeredScopes.projection !== "boot-subtree-v1") throw Error("boot");
    args.expected.registeredScopes.targets[0]!.originalElementIds = ["card"];
    unavailable(compareHtmlProtectionSnapshots(args));
    const wrongHash = boot(); wrongHash.expected.registeredScopes.originalSha256 = sha("0");
    unavailable(compareHtmlProtectionSnapshots(wrongHash));
    const wrongTargets = boot(); if (wrongTargets.expected.registeredScopes.projection === "boot-subtree-v1") wrongTargets.expected.registeredScopes.targets = [];
    unavailable(compareHtmlProtectionSnapshots(wrongTargets));
    unavailable(compareHtmlProtectionSnapshots({ ...boot(), policy: () => true } as Args));
    unavailable(compareHtmlProtectionSnapshots({ ...boot(), expected: { ...expected(), evaluate: "return true" } } as Args));
  });
});

describe("ordered boot subtree facts including native slot relationships", () => {
  it.each(["name", "namespace", "value", "attributes", "parent", "assignedIndexes"] as const)("observes changed %s despite an identical digest", field => {
    const args = boot(), nodes = bootMaterial(args.executed).targets[0]!.nodes;
    if (field === "name") nodes[1]!.name = "H3";
    if (field === "namespace") nodes[1]!.namespace = "http://www.w3.org/2000/svg";
    if (field === "value") nodes[2]!.value = "Different full text";
    if (field === "attributes") nodes[3]!.attributes.push({ name: "data-state", namespace: null, value: "changed" });
    if (field === "parent") nodes[4]!.parent = 0;
    if (field === "assignedIndexes") nodes[9]!.assignedIndexes = [];
    refresh(args.executed);
    expect(args.original.bodySha256).toBe(args.executed.bodySha256);
    const result = compareHtmlProtectionSnapshots(args);
    expect(result.gaps).toEqual([]);
    expect(result.facts.some(fact => fact.field.endsWith("." + field) && fact.status === "changed")).toBe(true);
  });
  it("uses full material rather than requiring equal body hashes", () => {
    const args = boot(); args.executed.bodySha256 = sha("9");
    expect(compareHtmlProtectionSnapshots(args).facts.every(fact => fact.status === "match")).toBe(true);
  });
  it("reports missing original positions/IDs and separates unknown added nodes without permission", () => {
    const removed = boot(); bootMaterial(removed.executed).targets[0]!.nodes.pop(); refresh(removed.executed);
    expect(compareHtmlProtectionSnapshots(removed).facts.some(fact => fact.status === "missing")).toBe(true);
    const added = boot(), nodes = bootMaterial(added.executed).targets[0]!.nodes;
    nodes.push(node(nodes.length, 0, "DIV", "new-item")); refresh(added.executed);
    const result = compareHtmlProtectionSnapshots(added);
    expect(result.additionalItems.map(item => item.kind)).toEqual(["element-id", "node-position"]);
    expect(result.gaps.map(gap => gap.code)).toContain("additional-element-id");
    expect(result.facts.find(fact => fact.field === "ordered-node-count")?.status).toBe("changed");
  });
  it("does not compare an Original subtree missing a registered ID or an unrelated executed root", () => {
    const missing = boot();
    bootMaterial(missing.original).targets[0]!.nodes[3]!.attributes = [];
    refresh(missing.original); unavailable(compareHtmlProtectionSnapshots(missing));
    const wrongRoot = boot(); bootMaterial(wrongRoot.executed).targets[0]!.nodes[0]!.name = "SECTION";
    refresh(wrongRoot.executed); unavailable(compareHtmlProtectionSnapshots(wrongRoot));
  });
  it("does not execute captured text or attribute strings", () => {
    delete (globalThis as { snapshotComparisonExecuted?: boolean }).snapshotComparisonExecuted;
    const args = boot();
    for (const observation of [args.original, args.executed]) {
      bootMaterial(observation).targets[0]!.nodes[2]!.value = "globalThis.snapshotComparisonExecuted=true";
      refresh(observation);
    }
    expect(compareHtmlProtectionSnapshots(args).facts.some(fact => fact.field === "node[2].value" && fact.status === "match")).toBe(true);
    expect((globalThis as { snapshotComparisonExecuted?: boolean }).snapshotComparisonExecuted).toBeUndefined();
  });
});

describe("full Original search membership and clear-state facts", () => {
  it.each([false, true])("compares every Original card/chapter and native input/count state, clear=%s", clear => {
    const result = compareHtmlProtectionSnapshots(search(clear));
    expect(result.gaps).toEqual([]);
    expect(result.facts.every(fact => fact.status === "match")).toBe(true);
    expect(result.facts.filter(fact => fact.field.startsWith("cards[")).length).toBe(16);
    expect(result.facts.find(fact => fact.field === "input.value")?.original).toBe(clear ? "" : "query");
  });
  it.each(["hidden", "display", "ancestorDisplayNone", "chapterId", "classAttribute", "namespace"] as const)("records changed %s without search/count substituting for membership", field => {
    const args = search(), row = searchMaterial(args.executed).cards[1]!;
    if (field === "hidden") row.hidden = false;
    if (field === "display") row.display = "block";
    if (field === "ancestorDisplayNone") row.ancestorDisplayNone = false;
    if (field === "chapterId") row.chapterId = null;
    if (field === "classAttribute") row.classAttribute = "other-class";
    if (field === "namespace") row.namespace = "http://www.w3.org/2000/svg";
    refresh(args.executed);
    const result = compareHtmlProtectionSnapshots(args);
    expect(result.facts.find(fact => fact.field === "cards[two]." + field)?.status).toBe("changed");
    expect(result.facts.find(fact => fact.field === "count.text")?.status).toBe("match");
  });
  it("compares membership order and count text while listing unknown Candidate members separately", () => {
    const ordered = search(); searchMaterial(ordered.executed).cards.reverse(); refresh(ordered.executed);
    expect(compareHtmlProtectionSnapshots(ordered).facts.find(fact => fact.field === "cards.ordered-IDs")?.status).toBe("changed");
    const added = search(), body = searchMaterial(added.executed);
    body.cards.push({ ...body.cards[0]!, id: "new-card" }); body.count.text = "2/3"; refresh(added.executed);
    const result = compareHtmlProtectionSnapshots(added);
    expect(result.additionalItems).toHaveLength(1);
    expect(result.additionalItems[0]).toMatchObject({ role: "executed", kind: "card" });
    expect(result.gaps.map(gap => gap.code)).toContain("additional-card");
    expect(result.facts.find(fact => fact.field === "count.text")?.status).toBe("changed");
  });
  it("records missing Candidate cards but never aligns missing/duplicated Original IDs or ambiguous controls", () => {
    const removed = search(); searchMaterial(removed.executed).cards.pop(); refresh(removed.executed);
    expect(compareHtmlProtectionSnapshots(removed).facts.find(fact => fact.field === "cards[two].hidden")?.status).toBe("missing");
    const originalMissing = search(); searchMaterial(originalMissing.original).cards.pop(); refresh(originalMissing.original);
    unavailable(compareHtmlProtectionSnapshots(originalMissing));
    const duplicate = search(); searchMaterial(duplicate.executed).cards[1]!.id = "one"; refresh(duplicate.executed);
    unavailable(compareHtmlProtectionSnapshots(duplicate));
    const anonymous = search(); searchMaterial(anonymous.original).cards[1]!.id = null; refresh(anonymous.original);
    unavailable(compareHtmlProtectionSnapshots(anonymous));
    const ambiguous = search(); searchMaterial(ambiguous.executed).input.matchCount = 2; refresh(ambiguous.executed);
    unavailable(compareHtmlProtectionSnapshots(ambiguous));
  });
  it("retains unregistered Original members and refuses an incomplete expected set", () => {
    const args = search();
    if (args.expected.registeredScopes.projection !== "search-membership-v1") throw Error("search");
    args.expected.registeredScopes.cardIds = ["one"];
    const result = compareHtmlProtectionSnapshots(args);
    unavailable(result); expect(result.additionalItems[0]).toMatchObject({ role: "original", kind: "card" });
  });
  it("cannot call a query result a clear observation or accept the wrong native search target", () => {
    const args = search(true);
    for (const observation of [args.original, args.executed]) { searchMaterial(observation).input.value = "not-cleared"; refresh(observation); }
    unavailable(compareHtmlProtectionSnapshots(args));
    const wrong = search(); searchMaterial(wrong.executed).targetId = "other"; refresh(wrong.executed);
    unavailable(compareHtmlProtectionSnapshots(wrong));
  });
});
