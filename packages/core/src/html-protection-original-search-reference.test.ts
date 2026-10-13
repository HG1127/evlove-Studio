import { describe, expect, it } from "vitest";
import {
  HtmlProtectionSnapshotLimitations, HtmlProtectionSnapshotRequestSchema, HtmlProtectionSnapshotResultSchema,
  type HtmlProtectionSnapshotBody, type HtmlProtectionSnapshotResult,
} from "@evolution/contracts";
import { compareHtmlProtectionSnapshots, type HtmlProtectionSnapshotComparisonExpected } from "./html-protection-snapshot-comparison";
import { compareHtmlProtectionOriginalSearchReference, type HtmlProtectionOriginalSearchReference } from "./html-protection-original-search-reference";

type Args = Parameters<typeof compareHtmlProtectionOriginalSearchReference>[0];
type Search = Extract<HtmlProtectionSnapshotBody, { projection: "search-membership-v1" }>;
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const sha = (character: string) => character.repeat(64);
const bytes = (text: string | null) => new TextEncoder().encode(text ?? "").byteLength;
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
}
const member = (id: string): Search["cards"][number] => ({ id, tag: "ARTICLE", namespace: htmlNamespace,
  classAttribute: "card", hidden: false, display: "block", ancestorDisplayNone: false, chapterId: "chapter" });
function body(): Search {
  return { projection: "search-membership-v1", targetId: "search", cards: [member("one"), member("two")],
    chapters: [{ ...member("chapter"), tag: "SECTION", classAttribute: "chapter" }],
    input: { matchCount: 1, tag: "INPUT", value: "" }, count: { matchCount: 1, text: "2/2" },
    counters: { scannedNodes: 100, collectedNodes: 5, shadowRoots: 0, textUtf8Bytes: 0 }, gaps: [] };
}
function recount(material: Search) {
  material.counters.collectedNodes = material.cards.length + material.chapters.length + 2;
  material.counters.textUtf8Bytes = [...material.cards, ...material.chapters].reduce((total, row) =>
    total + bytes(row.id) + bytes(row.classAttribute) + bytes(row.chapterId), 0) + bytes(material.input.value) + bytes(material.count.text);
  return material;
}
function material(snapshot: HtmlProtectionSnapshotResult): Search {
  if (snapshot.body?.projection !== "search-membership-v1") throw Error("Synthetic search body required");
  return snapshot.body;
}
function refresh(snapshot: HtmlProtectionSnapshotResult) {
  recount(material(snapshot));
  snapshot.bodyUtf8Bytes = bytes(canonical(snapshot.body));
}
function expected(): HtmlProtectionSnapshotComparisonExpected {
  return {
    binding: { missionId: "mission", testCaseId: "test", criterionId: "PROTECT-ALL", paperSha256: sha("f"),
      original: { sourceArtifactId: "source", sha256: sha("a"), byteLength: 2000 },
      executed: { sourceArtifactId: "source", sha256: sha("b"), byteLength: 2111 },
      subject: { kind: "candidate", candidateId: "candidate" } },
    policyVersion: "finite-profile-v1", planSha256: sha("e"), registrySha256: sha("d"),
    registry: { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: sha("a"),
      projection: "search-membership-v1", targetId: "search", cardSelector: ".card", chapterSelector: ".chapter", inputSelector: "#search", countSelector: "#count" },
    stateId: "search-clear", batchId: "batch-1",
    execution: { original: { executionId: "original-controller", jobId: "job", generation: 1 },
      executed: { executionId: "executed-controller", jobId: "job", generation: 1 } },
    documentUrl: { original: "https://fixture.invalid/original", executed: "https://fixture.invalid/executed" },
    registeredScopes: { sourceArtifactId: "source", originalSha256: sha("a"), projection: "search-membership-v1",
      targetId: "search", cardIds: ["one", "two"], chapterIds: ["chapter"], stateKind: "clear", inputValue: "" },
  };
}
function snapshot(seed: HtmlProtectionSnapshotComparisonExpected, sourceRole: "original" | "executed"): HtmlProtectionSnapshotResult {
  const request = HtmlProtectionSnapshotRequestSchema.parse({ schemaVersion: "html-protection-snapshot-request-v1", binding: seed.binding,
    sourceRole, documentUrl: seed.documentUrl[sourceRole], policyVersion: seed.policyVersion, planSha256: seed.planSha256,
    registrySha256: seed.registrySha256, registry: seed.registry, execution: seed.execution[sourceRole], stateId: seed.stateId, batchId: seed.batchId });
  const source = seed.binding[sourceRole], nativeBody = recount(body());
  return HtmlProtectionSnapshotResultSchema.parse({ schemaVersion: "html-protection-snapshot-result-v1", request,
    availability: "available", projectionComplete: true, observedAt: "2026-10-13T00:00:00Z",
    physicalInput: { sha256: source.sha256, byteLength: source.byteLength },
    realm: { observerVersion: "chromium-cdp-isolated-stable-dom-v2", frameId: "frame-" + sourceRole,
      loaderId: "loader-" + sourceRole, uniqueContextId: "context-" + sourceRole },
    stability: { protocol: "chromium-cdp-dom-mutation-window-v1", preMirrorSha256: sha("1"), postMirrorSha256: sha("1"), mutationEvents: 0 },
    body: nativeBody, bodySha256: sha("c"), bodyUtf8Bytes: bytes(canonical(nativeBody)), gaps: [], limitations: [...HtmlProtectionSnapshotLimitations] });
}
function fixture(): Args {
  const seed = expected();
  return { expected: seed, original: snapshot(seed, "original"), executed: snapshot(seed, "executed"), reference: {
    schemaVersion: "html-protection-original-search-reference-v1", sourceArtifactId: "source", originalSha256: sha("a"),
    policyVersion: seed.policyVersion, planSha256: seed.planSha256, registrySha256: seed.registrySha256,
    stateId: seed.stateId, targetId: "search", expectedOriginalVisibleCardIds: ["one", "two"],
    countTemplate: { prefix: "", separator: "/", suffix: "" },
  } };
}
const fact = (result: ReturnType<typeof compareHtmlProtectionOriginalSearchReference>, role: "original" | "executed" | "paired", field: string) =>
  result.referenceFacts.find(item => item.role === role && item.field === field);
function noReference(args: Args) {
  const result = compareHtmlProtectionOriginalSearchReference(args);
  expect(result.referenceFacts).toEqual([]);
  expect(result.gaps.length).toBeGreaterThan(0);
  expect(result.strictComparison).toEqual(compareHtmlProtectionSnapshots({ original: args.original, executed: args.executed, expected: args.expected }));
  return result;
}

describe("Original-relative search facts preserve the strict comparison", () => {
  it.each([0, 1, 2])("includes an executed card inserted at position %s in its own full counter", position => {
    const args = fixture();
    material(args.executed).cards.splice(position, 0, member("extra")); material(args.executed).count.text = "3/3"; refresh(args.executed);
    const expectedStrict = compareHtmlProtectionSnapshots({ original: args.original, executed: args.executed, expected: args.expected });
    const result = compareHtmlProtectionOriginalSearchReference(args);
    expect(result.strictComparison).toEqual(expectedStrict);
    expect(result.strictComparison.gaps).toContainEqual({ code: "additional-card", scope: "search", role: "executed" });
    expect(result.strictComparison.additionalItems).toEqual([{ role: "executed", scope: "search", kind: "card", value: member("extra") }]);
    expect(result.strictComparison.facts.find(item => item.field === "cards.ordered-IDs")?.status).toBe("changed");
    expect(result.strictComparison.facts.find(item => item.field === "count.text")?.status).toBe("changed");
    for (const role of ["original", "executed"] as const) {
      expect(fact(result, role, "cards.original-relative-order")?.status).toBe("match");
      expect(fact(result, role, "cards.original-native-visible-membership")?.status).toBe("match");
      expect(fact(result, role, "count.own-native-membership-text")?.status).toBe("match");
    }
    expect(fact(result, "original", "count.own-native-membership-text")?.expected).toBe("2/2");
    expect(fact(result, "executed", "count.own-native-membership-text")?.expected).toBe("3/3");
    expect(fact(result, "executed", "cards.all-native-visible-IDs")?.observed).toEqual(material(args.executed).cards.map(item => item.id));
    expect(result.referenceFacts.filter(item => item.role === "paired" && item.field.startsWith("cards[")).every(item => item.status === "match")).toBe(true);
    expect(fact(result, "paired", "chapters.empty-state")?.status).toBe("unavailable");
    for (const key of ["pass", "passed", "verified", "valid", "complete", "wholeProtectionPassed", "authorization"]) expect(result).not.toHaveProperty(key);
  });
  it("retains Original membership and strict raw observations when no independent literal counter format is available", () => {
    const args = fixture(); delete args.reference.countTemplate;
    material(args.executed).cards.splice(1, 0, member("extra")); material(args.executed).count.text = "unknown literal"; refresh(args.executed);
    const result = compareHtmlProtectionOriginalSearchReference(args);
    expect(result.strictComparison).toEqual(compareHtmlProtectionSnapshots({ original: args.original, executed: args.executed, expected: args.expected }));
    expect(result.strictComparison.additionalItems).toHaveLength(1);
    for (const role of ["original", "executed"] as const) {
      expect(fact(result, role, "cards.original-relative-order")?.status).toBe("match");
      expect(fact(result, role, "cards.original-native-visible-membership")?.status).toBe("match");
      expect(fact(result, role, "cards.all-native-counts")?.status).toBe("observed");
      expect(fact(result, role, "count.own-native-membership-text")?.status).toBe("unavailable");
      expect(result.gaps).toContainEqual({ code: "original-count-template-unavailable", scope: "search", role });
    }
  });
  it("does not modify input arrays, bodies, independently registered expectations or templates", () => {
    const args = fixture(), before = structuredClone(args);
    compareHtmlProtectionOriginalSearchReference(args); expect(args).toEqual(before);
  });
  it("keeps all added cards/chapters, including hidden additions and original native attribute changes", () => {
    const args = fixture(), executed = material(args.executed);
    executed.cards.push({ ...member("extra-hidden"), hidden: true });
    executed.cards[0]!.classAttribute = "changed";
    executed.chapters.push({ ...member("extra-chapter"), tag: "SECTION" }); refresh(args.executed);
    const result = compareHtmlProtectionOriginalSearchReference(args);
    expect(result.strictComparison.additionalItems).toHaveLength(2);
    expect(fact(result, "executed", "count.own-native-membership-text")).toMatchObject({ expected: "2/3", status: "changed" });
    expect(fact(result, "paired", "cards[one].classAttribute")?.status).toBe("changed");
    expect(result.strictComparison.gaps.map(item => item.code)).toEqual(["additional-card", "additional-chapter"]);
  });
  it("matches exact literal Unicode counter material and never executes strings", () => {
    const args = fixture();
    args.reference.countTemplate = { prefix: "卡片😀 globalThis.referenceExecuted=true：", separator: " / ", suffix: " 张\n" };
    for (const snapshot of [args.original, args.executed]) {
      material(snapshot).count.text = args.reference.countTemplate!.prefix + "2 / 2 张\n"; refresh(snapshot);
    }
    delete (globalThis as { referenceExecuted?: boolean }).referenceExecuted;
    const result = compareHtmlProtectionOriginalSearchReference(args);
    expect(fact(result, "executed", "count.own-native-membership-text")?.status).toBe("match");
    expect((globalThis as { referenceExecuted?: boolean }).referenceExecuted).toBeUndefined();
    material(args.executed).count.text = material(args.executed).count.text!.trimEnd(); refresh(args.executed);
    expect(fact(compareHtmlProtectionOriginalSearchReference(args), "executed", "count.own-native-membership-text")?.status).toBe("changed");
  });
});

describe("independent expected Original membership and each arm's native count", () => {
  it("does not call mutually equal wrong counters a membership counter match", () => {
    const args = fixture();
    for (const snapshot of [args.original, args.executed]) { material(snapshot).count.text = "0/2"; refresh(snapshot); }
    const result = compareHtmlProtectionOriginalSearchReference(args);
    expect(result.strictComparison.facts.find(item => item.field === "count.text")?.status).toBe("match");
    expect(fact(result, "original", "count.own-native-membership-text")?.status).toBe("changed");
    expect(fact(result, "executed", "count.own-native-membership-text")?.status).toBe("changed");
  });
  it("does not call mutually equal wrong visible membership a reference match", () => {
    const args = fixture();
    for (const snapshot of [args.original, args.executed]) {
      material(snapshot).cards[1]!.hidden = true; material(snapshot).count.text = "1/2"; refresh(snapshot);
    }
    const result = compareHtmlProtectionOriginalSearchReference(args);
    expect(fact(result, "paired", "cards[two].hidden")?.status).toBe("match");
    for (const role of ["original", "executed"] as const) {
      expect(fact(result, role, "cards.original-native-visible-membership")?.status).toBe("changed");
      expect(fact(result, role, "count.own-native-membership-text")?.status).toBe("match");
    }
  });
  it.each(["hidden", "display", "ancestorDisplayNone"] as const)("uses the native %s predicate for complete per-arm counts", attribute => {
    const args = fixture(); args.reference.expectedOriginalVisibleCardIds = ["one"];
    for (const snapshot of [args.original, args.executed]) {
      const row = material(snapshot).cards[1]!;
      if (attribute === "display") row.display = "none"; else row[attribute] = true;
      material(snapshot).count.text = "1/2"; refresh(snapshot);
    }
    const result = compareHtmlProtectionOriginalSearchReference(args);
    for (const role of ["original", "executed"] as const) {
      expect(fact(result, role, "cards.original-native-visible-membership")?.status).toBe("match");
      expect(fact(result, role, "count.own-native-membership-text")?.status).toBe("match");
    }
  });
  it("uses an unordered expected membership set without normalizing away observed relative order", () => {
    const args = fixture(); args.reference.expectedOriginalVisibleCardIds.reverse();
    let result = compareHtmlProtectionOriginalSearchReference(args);
    expect(fact(result, "original", "cards.original-native-visible-membership")?.status).toBe("match");
    material(args.original).cards.reverse(); material(args.executed).cards.reverse(); refresh(args.original); refresh(args.executed);
    result = compareHtmlProtectionOriginalSearchReference(args);
    expect(fact(result, "original", "cards.original-relative-order")?.status).toBe("changed");
    expect(fact(result, "executed", "cards.original-relative-order")?.status).toBe("changed");
    expect(fact(result, "original", "cards.original-native-visible-membership")?.status).toBe("match");
    expect(fact(result, "executed", "cards.original-native-visible-membership")?.status).toBe("match");
  });
  it("cannot hide missing Original membership by adding an ID with the same total and visible count", () => {
    const args = fixture(); material(args.executed).cards[1]!.id = "replacement"; refresh(args.executed);
    const result = compareHtmlProtectionOriginalSearchReference(args);
    expect(fact(result, "executed", "count.own-native-membership-text")?.status).toBe("match");
    expect(fact(result, "executed", "cards.original-relative-order")?.status).toBe("missing");
    expect(fact(result, "executed", "cards.original-native-visible-membership")?.status).toBe("missing");
    expect(fact(result, "paired", "cards[two].id")?.status).toBe("missing");
    expect(result.strictComparison.additionalItems[0]).toMatchObject({ role: "executed", kind: "card", value: { id: "replacement" } });
  });
  it("records missing members even when they were independently expected hidden", () => {
    const args = fixture(); args.reference.expectedOriginalVisibleCardIds = ["one"];
    material(args.original).cards[1]!.hidden = true; material(args.original).count.text = "1/2"; refresh(args.original);
    material(args.executed).cards.pop(); material(args.executed).count.text = "1/1"; refresh(args.executed);
    const result = compareHtmlProtectionOriginalSearchReference(args);
    expect(fact(result, "executed", "cards.original-native-visible-membership")?.status).toBe("missing");
    expect(fact(result, "paired", "cards[two].hidden")?.status).toBe("missing");
  });
  it.each(["", "inherit", "unknown-display", "BLOCK", " block "])("cannot infer membership from unrecognized display %j", display => {
    const args = fixture(); material(args.executed).cards[1]!.display = display; refresh(args.executed);
    const result = compareHtmlProtectionOriginalSearchReference(args);
    expect(result.gaps).toContainEqual({ code: "unknown-native-display", scope: "search", role: "executed" });
    expect(fact(result, "executed", "cards.original-native-visible-membership")?.status).toBe("unavailable");
    expect(fact(result, "executed", "count.own-native-membership-text")?.status).toBe("unavailable");
    expect(fact(result, "original", "count.own-native-membership-text")?.status).toBe("match");
  });
  it("requires known display for added members too, without silently excluding their count", () => {
    const args = fixture(); material(args.executed).cards.push({ ...member("extra"), display: "unrecognized", hidden: true }); refresh(args.executed);
    const result = compareHtmlProtectionOriginalSearchReference(args);
    expect(fact(result, "executed", "count.own-native-membership-text")?.status).toBe("unavailable");
    expect(result.strictComparison.additionalItems).toHaveLength(1);
  });
});

describe("strict material gates before producing Original-reference facts", () => {
  it.each(["original", "executed"] as const)("does not compare duplicate or anonymous %s member IDs", role => {
    for (const id of ["one", null]) {
      const args = fixture(); material(args[role]).cards[1]!.id = id; refresh(args[role]); noReference(args);
    }
  });
  it("refuses missing or extra Original members, instead of deriving Original scope from received material", () => {
    for (const mutate of [(value: Search) => value.cards.pop(), (value: Search) => value.cards.push(member("unregistered"))]) {
      const args = fixture(); mutate(material(args.original)); refresh(args.original); noReference(args);
    }
  });
  it.each(["collectedNodes", "textUtf8Bytes", "scannedNodes"] as const)("cannot produce reference facts from bad %s", field => {
    const args = fixture(); material(args.executed).counters[field] = 0;
    args.executed.bodyUtf8Bytes = bytes(canonical(args.executed.body)); noReference(args);
  });
  it("refuses wrong body byte counts, incomplete bodies, native gaps and unstable documents", () => {
    const changes: Array<(args: Args) => void> = [
      args => { args.executed.bodyUtf8Bytes!++; },
      args => { args.executed.projectionComplete = false; },
      args => { args.executed.gaps = [{ code: "closed-shadow-root" }]; },
      args => { material(args.executed).gaps = [{ code: "iframe" }]; refresh(args.executed); },
      args => { args.executed.stability!.postMirrorSha256 = sha("0"); },
      args => { delete args.executed.realm; },
      args => { material(args.executed).count.matchCount = 2; refresh(args.executed); },
      args => { material(args.executed).input.value = "not-cleared"; refresh(args.executed); },
    ];
    for (const change of changes) { const args = fixture(); change(args); noReference(args); }
  });
  it.each(["policyVersion", "planSha256", "registrySha256", "stateId", "batchId"] as const)("refuses wrong snapshot %s", field => {
    const args = fixture(); args.executed.request[field] = field.endsWith("Sha256") ? sha("0") : "wrong"; noReference(args);
  });
  it("refuses changed physical roles, controller, source, state target and subject", () => {
    const changes: Array<(args: Args) => void> = [
      args => { args.executed.physicalInput.byteLength++; },
      args => { args.executed.physicalInput.sha256 = sha("0"); },
      args => { args.executed.request.execution.executionId = "other"; },
      args => { args.executed.request.execution.jobId = "other"; },
      args => { args.executed.request.execution.generation++; },
      args => { args.executed.request.binding.original.sourceArtifactId = "other"; },
      args => { args.executed.request.binding.subject = { kind: "current", versionId: "other" }; },
      args => { material(args.executed).targetId = "other"; refresh(args.executed); },
      args => { [args.original, args.executed] = [args.executed, args.original]; },
    ];
    for (const change of changes) { const args = fixture(); change(args); noReference(args); }
  });
  it.each(["sourceArtifactId", "originalSha256", "policyVersion", "planSha256", "registrySha256", "stateId", "targetId"] as const)("refuses unbound independent template %s", field => {
    const args = fixture(); args.reference[field] = field.endsWith("Sha256") ? sha("0") : "wrong";
    expect(noReference(args).gaps.map(item => item.code)).toContain("unbound-independent-search-reference");
  });
  it("rejects invalid/duplicate/foreign independent IDs and executable or extra template keys", () => {
    const changes: Array<(args: Args) => void> = [
      args => { args.reference.expectedOriginalVisibleCardIds = ["one", "one"]; },
      args => { args.reference.expectedOriginalVisibleCardIds = ["foreign"]; },
      args => { args.reference.expectedOriginalVisibleCardIds = [""]; },
      args => { args.reference.countTemplate = { ...args.reference.countTemplate, evaluate: "return true" } as Args["reference"]["countTemplate"]; },
      args => { args.reference = { ...args.reference, authorization: true } as HtmlProtectionOriginalSearchReference; },
      args => { args.reference.countTemplate!.prefix = "😀".repeat(400_000); },
    ];
    for (const change of changes) { const args = fixture(); change(args); noReference(args); }
    const args = fixture(); noReference({ ...args, evaluate: () => true } as Args);
  });
  it("cannot claim a matching template authenticates an independently invented profile", () => {
    const result = compareHtmlProtectionOriginalSearchReference(fixture());
    expect(result.limitations.join(" ")).toContain("serialized expectations are not provenance or change permission");
    expect(result.limitations.join(" ")).toContain("No paired Hidden");
    expect(result.gaps.map(item => item.code)).toContain("chapter-empty-state-template-unavailable");
  });
});
