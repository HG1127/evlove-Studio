import { describe, expect, it } from "vitest";
import { HtmlProtectionObligationSchema, type HtmlProtectionEvidence, type HtmlProtectionProofBinding } from "@evolution/contracts";
import { htmlProtectionInventory } from "./html-protection-inventory";
import { htmlProtectionObligationPlan, type HtmlProtectionFiniteRuntimeProfile } from "./html-protection-obligation-plan";
import { validateHtmlProtectionProof } from "./html-protection-proof";

const wrap = (body: string, head = "") => "<!doctype html><html><head>" + head + "</head><body>" + body + "</body></html>";
const card = (id: string, text = "Original method") => '<article class="slide-card" id="' + id + '"><h2>Title ' + id + "</h2><div><p>" + text + "</p></div></article>";
const inventory = (html: string) => htmlProtectionInventory({ sourceArtifactId: "original-source", html });
const plan = (html: string) => htmlProtectionObligationPlan({ originalInventory: inventory(html) });
const profileFor = (original: ReturnType<typeof inventory>): HtmlProtectionFiniteRuntimeProfile => ({
  id: "developer-finite-profile", sourceArtifactId: original.sourceArtifactId,
  refinements: [{ parentObligationId: original.runtimeObligations[0]!.id, children: [
    { id: "state-b", target: "button#control", description: "Observe independently specified state B" },
    { id: "state-a", target: "button#control", description: "Observe independently specified state A" },
  ] }],
});
const byId = (result: ReturnType<typeof plan>, id: string) => result.requiredObligations.find((item) => item.id === id)!;

describe("Original-only HTML protection expected obligation plan", () => {
  it("deterministically retains each actual card's full four static facts and parallel semantic/visual scope", () => {
    const original = inventory(wrap(Array.from({ length: 111 }, (_, index) => card("card-" + index,
      "Full method " + index + " " + "x".repeat(1500))).join("")));
    const result = htmlProtectionObligationPlan({ originalInventory: original });
    expect(result).toEqual(htmlProtectionObligationPlan({ originalInventory: original }));
    expect(result.scope.cards).toHaveLength(111);
    expect(result.originalInventory.cards).toEqual(original.cards);
    expect(result.originalInventory.cards[110]!.text).toContain("Full method 110 " + "x".repeat(1500));
    expect(result.originalInventory.cards[110]!.title).toBe("Title card-110");
    for (const scope of result.scope.cards) {
      expect(scope.staticObligationIds).toHaveLength(4);
      expect(scope.staticObligationIds.map((id) => byId(result, id).kind)).toEqual(["card-content", "card-title", "card-structure", "card-attributes"]);
      expect(scope.staticObligationIds.every((id) => byId(result, id).support === "supported")).toBe(true);
      expect(byId(result, scope.semanticObligationId)).toMatchObject({ kind: "core-method", evidenceKind: "semantic", support: "unresolved" });
      expect(byId(result, scope.visualObligationId)).toMatchObject({ kind: "visual-layout", evidenceKind: "visual", support: "unresolved" });
    }
    expect(result.expectedCoverage.originalFactCounts.cards).toBe(111);
    expect(result.expectedCoverage.obligationCount).toBe(8 + 111 * 6);
    expect(new Set(result.requiredObligations.map((item) => item.id)).size).toBe(result.requiredObligations.length);
    expect(result.requiredObligations.every((item) => HtmlProtectionObligationSchema.safeParse(item).success)).toBe(true);
  });
  it("retains complete source literals, structure and attributes without execution, truncation or byte claims", () => {
    delete (globalThis as { planScriptRan?: boolean }).planScriptRan;
    const original = inventory(wrap(card("one"), '<style media="screen">\r\na{color:red}\r\n</style><script>\r\nglobalThis.planScriptRan=true\r\n</script>'));
    const result = htmlProtectionObligationPlan({ originalInventory: original });
    expect(result.originalInventory).toEqual(original);
    expect(result.originalInventory).not.toBe(original);
    expect(result.originalInventory.scripts[0]!.bodyLiteral).toContain("\r\n");
    expect(result.originalInventory.styles[0]!.literal).toBe(original.styles[0]!.literal);
    original.cards[0]!.text = "mutated caller facts";
    expect(result.originalInventory.cards[0]!.text).not.toBe("mutated caller facts");
    expect((globalThis as { planScriptRan?: boolean }).planScriptRan).toBeUndefined();
    for (const key of ["pass", "passed", "complete", "verificationStatus", "sha256", "binding", "receipts", "evidence", "authorization"]) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result.gaps.some((item) => item.code === "physical-provenance-required")).toBe(true);
  });
  it("requires global document content, format, structure, attributes, ordering, semantics, visual and unknown residual scope", () => {
    const result = plan(wrap("<p>Outside any card</p>" + card("one")));
    expect(Object.keys(result.scope.document)).toEqual(["format", "content", "structure", "attributes", "sequences", "semantic", "visual", "runtimeResidual"]);
    expect(byId(result, result.scope.document.format).support).toBe("unresolved");
    expect(byId(result, result.scope.document.content).support).toBe("unresolved");
    expect(result.gaps.find((gap) => gap.code === "complete-document-source-unindexed")?.obligationIds)
      .toEqual([result.scope.document.format, result.scope.document.content]);
    expect(byId(result, result.scope.document.runtimeResidual)).toMatchObject({ kind: "unknown-runtime", evidenceKind: "browser", support: "unresolved" });
  });
  it("keeps every executable, data, inert and configuration script alongside every style, reference and handler", () => {
    const original = inventory(wrap(card("one") + '<button id="control" onclick="save()" onmouseover="unknown()">save</button><img src="image.png">'
      + '<template><script>activateLater()</script></template>', '<style>a{}</style><style>b{}</style><script>run()</script><script type="application/json">{"a":1}</script><script type="importmap">{"imports":{}}</script>'));
    const result = htmlProtectionObligationPlan({ originalInventory: original });
    expect(result.scope.scripts).toHaveLength(4);
    expect(result.scope.styles).toHaveLength(2);
    expect(result.scope.references).toHaveLength(1);
    expect(result.scope.handlers).toHaveLength(2);
    expect(result.originalInventory.scripts.map((item) => item.kind)).toEqual(["classic", "data", "importmap", "inert"]);
    expect(result.originalInventory.scripts[3]!.activationUnresolved).toBe(true);
    expect([...result.scope.styles, ...result.scope.scripts, ...result.scope.references, ...result.scope.handlers]
      .every((id) => byId(result, id).evidenceKind === "static")).toBe(true);
    expect(result.scope.runtime).toHaveLength(original.runtimeObligations.length);
  });
  it("keeps each exact coarse runtime parent plus a required unresolved residual, including URLs and embedded/native controls", () => {
    const original = inventory(wrap('<a href="javascript:save()" onclick="save()">go</a><iframe src="frame.html"></iframe><input type="checkbox"><script>unknown()</script>'));
    const result = htmlProtectionObligationPlan({ originalInventory: original });
    for (const scope of result.scope.runtime) {
      expect(byId(result, scope.parentObligationId)).toEqual(original.runtimeObligations.find((item) => item.id === scope.parentObligationId));
      expect(scope.children).toEqual([]);
      expect(byId(result, scope.residualObligationId)).toMatchObject({ kind: "unknown-runtime", support: "unresolved", evidenceKind: "browser" });
      expect(result.expectedCoverage.unresolvedObligationIds).toContain(scope.parentObligationId);
      expect(result.expectedCoverage.unresolvedObligationIds).toContain(scope.residualObligationId);
    }
    expect(result.requiredObligations.filter((item) => item.kind === "unknown-runtime")).toHaveLength(original.runtimeObligations.length * 2 + 1);
    expect(result.expectedCoverage.byEvidenceKind.browser).toBe(original.runtimeObligations.length * 2 + 1);
  });
  it("preserves the absence of an original card heading as a fact without inventing a title", () => {
    const result = plan(wrap('<article class="slide-card" id="one"><p>Content</p></article>'));
    expect(result.originalInventory.cards[0]!.title).toBe("");
    expect(byId(result, result.scope.cards[0]!.staticObligationIds[1]!).support).toBe("supported");
  });
  it("never collapses missing, empty or globally duplicated card identities", () => {
    const result = plan(wrap(card("same") + card("same") + card("") + '<article class="slide-card"><p>No identity</p></article>'));
    expect(result.scope.cards).toHaveLength(4);
    expect(result.scope.cards.flatMap((item) => item.staticObligationIds)).toHaveLength(16);
    expect(result.scope.cards.flatMap((item) => item.staticObligationIds).every((id) => byId(result, id).support === "unresolved")).toBe(true);
    expect(result.gaps.filter((gap) => gap.code === "card-identity-unresolved")).toHaveLength(4);
    expect(result.originalInventory.duplicateIds).toEqual([{ id: "same", count: 2 }]);
    expect(byId(result, result.scope.document.sequences).support).toBe("unresolved");
  });
  it("retains parser errors, implicit tags and unterminated blocks as unresolved limitations", () => {
    const original = inventory('<article class="slide-card" id="one"><h2>Title</h2><script>unfinished');
    const result = htmlProtectionObligationPlan({ originalInventory: original });
    expect(result.originalInventory.parseErrorCount).toBeGreaterThan(0);
    expect(result.originalInventory.parseErrors).toEqual(original.parseErrors);
    expect(result.gaps.map((item) => item.code)).toContain("html-parser-repair");
    expect(result.gaps.map((item) => item.code)).toContain("implicit-document-tags");
    expect(result.gaps.map((item) => item.code)).toContain("script-source-unresolved");
    expect(byId(result, result.scope.scripts[0]!).support).toBe("unresolved");
    expect(byId(result, result.scope.document.structure).support).toBe("unresolved");
  });
  it("does not invent absent card/ref/handler source locations", () => {
    const original = inventory(wrap(card("one") + '<button onclick="save()" formaction="/save">save</button>'));
    original.cards[0]!.range = null;
    original.cards[0]!.literal = null;
    original.references[0]!.literal = null;
    original.handlers[0]!.literal = null;
    const result = htmlProtectionObligationPlan({ originalInventory: original });
    expect(result.scope.cards[0]!.staticObligationIds.every((id) => byId(result, id).support === "unresolved")).toBe(true);
    expect(byId(result, result.scope.references[0]!).support).toBe("unresolved");
    expect(byId(result, result.scope.handlers[0]!).support).toBe("unresolved");
    expect(result.gaps.map((item) => item.code)).toEqual(expect.arrayContaining(["card-source-unavailable", "reference-source-unavailable", "handler-source-unavailable"]));
  });
  it("retains every obligation when the complete scope exceeds the unchanged proof capacity", () => {
    const result = plan(wrap(Array.from({ length: 834 }, (_, index) => card("card-" + index)).join("")));
    expect(result.scope.cards).toHaveLength(834);
    expect(result.requiredObligations).toHaveLength(8 + 834 * 6);
    expect(result.expectedCoverage.fitsSingleProof).toBe(false);
    expect(result.expectedCoverage.singleProofObligationLimit).toBe(5000);
    expect(result.gaps.map((item) => item.code)).toContain("single-proof-capacity-exceeded");
    expect(result.scope.cards[833]!.staticObligationIds.every((id) => byId(result, id))).toBe(true);
  });
  it.each(["candidate", "proof", "trustedEvidence", "aiResult", "authorizedChanges"])("rejects %s as a plan input", (key) => {
    expect(() => htmlProtectionObligationPlan({ originalInventory: inventory(wrap(card("one"))), [key]: {} } as Parameters<typeof htmlProtectionObligationPlan>[0])).toThrow("accepts only Original");
  });
  it("rejects incomplete inventory, changed source runtime binding and duplicate coarse identities", () => {
    const original = inventory(wrap("<script>unknown()</script>"));
    expect(() => htmlProtectionObligationPlan({ originalInventory: { ...original, readWholeFile: false } as unknown as typeof original })).toThrow("complete Core Original");
    const changed = structuredClone(original);
    changed.runtimeObligations[0]!.sourceArtifactId = "other-source";
    expect(() => htmlProtectionObligationPlan({ originalInventory: changed })).toThrow("runtime identity");
    const duplicate = structuredClone(original);
    duplicate.runtimeObligations.push({ ...duplicate.runtimeObligations[0]! });
    expect(() => htmlProtectionObligationPlan({ originalInventory: duplicate })).toThrow("runtime identity");
    const supported = structuredClone(original);
    supported.runtimeObligations[0]!.support = "supported";
    expect(() => htmlProtectionObligationPlan({ originalInventory: supported })).toThrow();
  });
});

describe("finite source-specific runtime expected refinements", () => {
  it("adds sorted expected children without dropping or resolving the original parent or residual", () => {
    const original = inventory(wrap('<button id="control">go</button><script>unknown()</script>'));
    const base = htmlProtectionObligationPlan({ originalInventory: original });
    const runtimeProfile = profileFor(original);
    const result = htmlProtectionObligationPlan({ originalInventory: original, runtimeProfile });
    expect(result.requiredObligations).toHaveLength(base.requiredObligations.length + 2);
    expect(result.scope.runtime[0]!.children.map((item) => item.profileChildId)).toEqual(["state-a", "state-b"]);
    expect(result.scope.runtime[0]!.children.every((item) => byId(result, item.obligationId).support === "unresolved")).toBe(true);
    for (const scope of result.scope.runtime) {
      expect(byId(result, scope.parentObligationId)).toEqual(byId(base, scope.parentObligationId));
      expect(byId(result, scope.residualObligationId)).toEqual(byId(base, scope.residualObligationId));
    }
    const reordered = structuredClone(runtimeProfile);
    reordered.refinements[0]!.children = [...reordered.refinements[0]!.children].reverse();
    expect(result).toEqual(htmlProtectionObligationPlan({ originalInventory: original, runtimeProfile: reordered }));
  });
  it.each(["support", "evidenceKind", "passed", "actions", "authorizedChanges"])("rejects profile child %s rather than treating it as authority or executable code", (key) => {
    const original = inventory(wrap("<script>unknown()</script>"));
    const runtimeProfile = profileFor(original);
    runtimeProfile.refinements[0]!.children = [{ ...runtimeProfile.refinements[0]!.children[0]!, [key]: "supported" }];
    expect(() => htmlProtectionObligationPlan({ originalInventory: original, runtimeProfile })).toThrow("closed runtime child");
  });
  it("rejects wrong source, unknown parent and duplicate parent/child mappings", () => {
    const original = inventory(wrap("<script>unknown()</script><script>other()</script>"));
    const runtimeProfile = profileFor(original);
    expect(() => htmlProtectionObligationPlan({ originalInventory: original, runtimeProfile: { ...runtimeProfile, sourceArtifactId: "other-source" } })).toThrow("target this Original");
    expect(() => htmlProtectionObligationPlan({ originalInventory: original, runtimeProfile: { ...runtimeProfile,
      refinements: [{ ...runtimeProfile.refinements[0]!, parentObligationId: "missing-parent" }] } })).toThrow("runtime parent");
    expect(() => htmlProtectionObligationPlan({ originalInventory: original, runtimeProfile: { ...runtimeProfile,
      refinements: [...runtimeProfile.refinements, runtimeProfile.refinements[0]!] } })).toThrow("runtime parent");
    expect(() => htmlProtectionObligationPlan({ originalInventory: original, runtimeProfile: { ...runtimeProfile,
      refinements: [{ ...runtimeProfile.refinements[0]!, children: [runtimeProfile.refinements[0]!.children[0]!, runtimeProfile.refinements[0]!.children[0]!] }] } })).toThrow("child identity");
  });
});

describe("expected scope cannot become whole proof from static/search evidence", () => {
  it("requires the independent complete set and leaves runtime/semantic/visual/source gaps unresolved", () => {
    const result = plan(wrap(card("one") + '<button id="control" onclick="unknown()">go</button><script>unknown()</script>'));
    const binding: HtmlProtectionProofBinding = {
      missionId: "mission", testCaseId: "protect-test", criterionId: "PROTECT-ALL", paperSha256: "a".repeat(64),
      original: { sourceArtifactId: result.sourceArtifactId, sha256: "b".repeat(64), byteLength: 100 },
      executed: { sourceArtifactId: result.sourceArtifactId, sha256: "c".repeat(64), byteLength: 100 },
      subject: { kind: "candidate", candidateId: "candidate" },
    };
    const staticIds = result.requiredObligations.filter((item) => item.evidenceKind === "static" && item.support === "supported").map((item) => item.id);
    const trusted: HtmlProtectionEvidence = { schemaVersion: "html-protection-evidence-v1", id: "synthetic-static-record",
      binding, kind: "static", producer: "core-static", obligationIds: staticIds, verificationStatus: "verified", observedAt: "2026-10-13T00:00:00Z" };
    const proof = { schemaVersion: "html-protection-proof-v1", binding, requiredObligations: result.requiredObligations,
      receipts: result.requiredObligations.map((item) => ({ obligationId: item.id,
        verificationStatus: staticIds.includes(item.id) ? "verified" : "unverified", evidenceIds: staticIds.includes(item.id) ? [trusted.id] : [] })),
      evidence: [trusted], verificationStatus: "partial" };
    const args = { proof, expectedBinding: binding, requiredObligations: result.requiredObligations, trustedEvidence: [trusted] };
    expect(validateHtmlProtectionProof(args)).toMatchObject({ valid: true, passed: false, complete: false, verificationStatus: "partial" });
    expect(validateHtmlProtectionProof({ ...args, proof: { ...proof, verificationStatus: "verified" } })).toMatchObject({ valid: false, passed: false, complete: false });
    expect(validateHtmlProtectionProof({ ...args, proof: { ...proof, requiredObligations: result.requiredObligations.filter((item) => staticIds.includes(item.id)) } }))
      .toMatchObject({ valid: false, passed: false, complete: false });
  });
});
