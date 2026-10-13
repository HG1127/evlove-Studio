import { describe, expect, it } from "vitest";
import { BrowserStepSchema, HtmlProtectionSnapshotRegistrySchema } from "@evolution/contracts";
import { htmlProtectionOriginalRuntimePlan } from "./html-protection-original-runtime-plan";
import { htmlProtectionInventory } from "./html-protection-inventory";
import { htmlProtectionObligationPlan } from "./html-protection-obligation-plan";

const originalSha256 = "a".repeat(64);
const wrap = (body: string, head = "") => "<!doctype html><html><head>" + head + "</head><body>" + body + "</body></html>";
const argsFor = (html: string) => ({ sourceArtifactId: "synthetic-original", originalSha256, html });
const plan = (html: string) => htmlProtectionOriginalRuntimePlan(argsFor(html));
function catalog(count = 111, chapterCount = 11) {
  const chapters = Array.from({ length: chapterCount }, (_, chapter) => '<section class="chapter" id="chapter-' + chapter + '">'
    + Array.from({ length: count }, (_, index) => index % chapterCount === chapter
      ? '<article class="slide-card" id="card-' + index + '" data-search="' + (index % 2 ? "beta" : "alpha") + ' bucket-' + index + '">'
        + '<h2 id="heading-' + index + '">Synthetic title</h2><button class="copy-slide">Copy</button></article>' : "").join("")
    + "</section>").join("");
  return wrap('<div id="progress"></div><button id="menuBtn">Menu</button>'
    + '<input id="search"><output id="searchCount"></output><aside class="sidebar">'
    + Array.from({ length: chapterCount }, (_, index) => '<a href="#chapter-' + index + '">Nav</a>').join("") + "</aside>"
    + '<a href="#top">Home</a><a href="#top">Home again</a><section id="top"></section>' + chapters
    + '<button class="copy-btn">Extra copy 1</button><button class="copy-btn">Extra copy 2</button><button class="copy-btn">Extra copy 3</button>'
    + '<button id="toTop">Top</button><div class="check-item">Synthetic check</div>',
    '<script>globalThis.syntheticOriginalExecuted=true; /* SYNTHETIC_SOURCE_BODY_DO_NOT_EXPORT */</script><script></script><script></script><script></script>');
}
const registeredIds = (result: ReturnType<typeof plan>) => result.bootBatches.flatMap(batch =>
  batch.registry.projection === "boot-subtree-v1" ? batch.registry.targets.map(target => target.targetId) : []);
const code = (result: ReturnType<typeof plan>, value: string) => result.gaps.some(gap => gap.code === value);

describe("finite Original-only HTML runtime registry/plan", () => {
  it("independently retains the full synthetic 111/11/4/116/13/1 census and all 134 coarse parents", () => {
    const result = plan(catalog());
    expect(result.census).toMatchObject({ cards: 111, chapters: 11, buttons: 116, anchors: 13, inputs: 1 });
    expect(result.census.scripts).toHaveLength(4);
    expect(result.census.controls).toHaveLength(130);
    expect(result.expectedScope.coarseParents).toHaveLength(134);
    expect(result.expectedScope.coarseParents.every(parent => parent.kind === "unknown-runtime" && parent.support === "unresolved")).toBe(true);
    expect(result.expectedScope.mandatoryResidualParentIds).toEqual(result.expectedScope.coarseParents.map(parent => parent.id));
    expect(new Set(result.census.controls.map(control => control.sourcePath)).size).toBe(130);
    expect(result.census.controls.every(control => control.parentObligationIds.length === 1)).toBe(true);
    expect(result.census.copyTargets).toHaveLength(114);
    expect(code(result, "copy-material-projection-unavailable")).toBe(true);
  });
  it("does not execute scripts or emit Original source/script literals, evidence, authority or PASS", () => {
    delete (globalThis as { syntheticOriginalExecuted?: boolean }).syntheticOriginalExecuted;
    const result = plan(catalog(3, 1));
    expect((globalThis as { syntheticOriginalExecuted?: boolean }).syntheticOriginalExecuted).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_SOURCE_BODY_DO_NOT_EXPORT");
    for (const key of ["html", "originalInventory", "scriptSource", "proof", "receipts", "pass", "complete", "authorization", "verificationStatus"]) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result.limitations.join(" ")).toContain("no byte hash or authority");
    expect(code(result, "script-generated-state-unenumerated")).toBe(true);
  });
  it("partitions every eligible Original target exactly once into closed registries of at most 16 targets", () => {
    const result = plan(catalog());
    const ids = registeredIds(result);
    expect(ids).toEqual(result.targets.filter(target => target.selector !== null).map(target => target.targetId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.bootBatches.length).toBeGreaterThan(1);
    for (const batch of result.bootBatches) {
      expect(HtmlProtectionSnapshotRegistrySchema.safeParse(batch.registry).success).toBe(true);
      expect(batch.registry.originalSha256).toBe(originalSha256);
      expect(batch.registry.projection).toBe("boot-subtree-v1");
      if (batch.registry.projection === "boot-subtree-v1") expect(batch.registry.targets.length).toBeLessThanOrEqual(16);
      expect(batch.stateId).toBe("original-runtime:boot");
      if (batch.registeredScopes.projection === "boot-subtree-v1") for (const target of batch.registeredScopes.targets) {
        expect(new Set(target.originalElementIds).size).toBe(target.originalElementIds.length);
        expect(target.root.name).toBe(target.root.name.toUpperCase());
        if (target.root.id) expect(target.originalElementIds).toContain(target.root.id);
      }
    }
  });
  it("derives full membership and chapter ownership from Original, including every positive matching ID", () => {
    const result = plan(catalog()), states = result.search.states;
    expect(states.map(state => state.stateKind)).toEqual(["boot", "query", "query", "clear"]);
    expect(states.map(state => state.stateIntent)).toEqual(["boot", "query-positive", "query-negative", "clear"]);
    expect(states.map(state => state.predecessorStateId)).toEqual([null, states[0]!.stateId, states[1]!.stateId, states[2]!.stateId]);
    expect(states[1]!.inputValue).toBe("alpha");
    const expected = result.census.cardChapter.filter(item => Number(item.cardId!.split("-")[1]) % 2 === 0).map(item => item.cardId!);
    expect(states[1]!.expectedVisibleCardIds).toEqual(expected);
    expect(states[1]!.expectedVisibleCardIds).toHaveLength(56);
    expect(states[2]!.expectedVisibleCardIds).toEqual([]);
    expect(states[2]!.expectedVisibleChapterIds).toEqual([]);
    expect(states[3]!.expectedVisibleCardIds).toHaveLength(111);
    expect(states[3]!.expectedVisibleChapterIds).toHaveLength(11);
    for (const state of states) {
      expect(state.registeredScopes.projection).toBe("search-membership-v1");
      if (state.registeredScopes.projection === "search-membership-v1") {
        expect(state.registeredScopes.cardIds).toEqual(result.census.cardChapter.map(item => item.cardId));
        expect(state.registeredScopes.chapterIds).toHaveLength(11);
      }
    }
  });
  it("proposes bounded sequential native fills without claiming fresh boot Pages performed query/clear", () => {
    const result = plan(catalog(3, 1));
    expect(result.search.states[0]!.proposedActions).toEqual([]);
    expect(result.search.states[0]!.predecessorStateId).toBeNull();
    for (let index = 1; index < result.search.states.length; index++) {
      const state = result.search.states[index]!;
      expect(state.predecessorStateId).toBe(result.search.states[index - 1]!.stateId);
      expect(state.requiredCapability).toBe("stateful-browser-actions-unavailable");
      expect(state.proposedActions).toHaveLength(1);
      expect(state.proposedActions[0]).toMatchObject({ action: "fill", selector: "#search", value: state.inputValue });
      expect(BrowserStepSchema.safeParse(state.proposedActions[0]).success).toBe(true);
      expect(state.proposedActions.length).toBeLessThanOrEqual(24);
    }
    expect(code(result, "search-js-causality-unverified")).toBe(true);
    expect(code(result, "search-state-execution-unavailable")).toBe(true);
  });
  it("retains every original parent and a mandatory unresolved residual when composed into the existing obligation plan", () => {
    const html = catalog(), result = plan(html);
    const composed = htmlProtectionObligationPlan({ originalInventory: htmlProtectionInventory({ sourceArtifactId: "synthetic-original", html }),
      runtimeProfile: result.runtimeProfile });
    expect(composed.scope.runtime).toHaveLength(134);
    const obligations = new Map(composed.requiredObligations.map(obligation => [obligation.id, obligation]));
    for (const runtime of composed.scope.runtime) {
      expect(obligations.get(runtime.parentObligationId)?.support).toBe("unresolved");
      expect(obligations.get(runtime.residualObligationId)?.support).toBe("unresolved");
      for (const child of runtime.children) expect(obligations.get(child.obligationId)?.support).toBe("unresolved");
    }
    expect(composed.scope.runtime.filter(runtime => runtime.children.length === 0)).toHaveLength(4);
    expect(composed.expectedCoverage.unresolvedObligationIds).toContain("plan:document:runtime-residual");
  });
  it("treats JS/self-reported JSON claims as unknown and never lets search discharge other controls", () => {
    const html = catalog(3, 1).replace("</head>", '<script>const claim={complete:true,pass:true};document.body.remove()</script></head>')
      .replace('<button id="toTop">', '<button onclick="unknownHandler()" id="toTop">');
    const result = plan(html);
    expect(code(result, "original-handler-causality-unknown")).toBe(true);
    expect(result.census.inlineHandlers).toBe(1);
    expect(result.census.controls.find(control => control.id === "toTop")?.attributes).toContainEqual({ name: "onclick", namespace: "", value: "unknownHandler()" });
    expect(result.expectedScope.coarseParents.every(parent => parent.support === "unresolved")).toBe(true);
    expect(result.gaps.filter(gap => gap.code === "coarse-runtime-unresolved")).toHaveLength(result.expectedScope.coarseParents.length);
    expect(result.expectedScope.coarseParents.some(parent => parent.id.startsWith("runtime-handler:"))).toBe(true);
  });
  it("chooses a negative query absent from the entire Original, including script/comment/outside-card text", () => {
    const html = catalog(3, 1).replace("</body>", "<!-- __EVOLUTION_ORIGINAL_NO_MATCH_0__ -->"
      + "<script>const marker='__evolution_original_no_match_1__'</script></body>");
    const result = plan(html), query = result.search.states[2]!.inputValue;
    expect(query).toBe("__evolution_original_no_match_2__");
    expect(html.toLowerCase()).not.toContain(query);
  });
  it("returns a query gap rather than truncate a bounded exhausted negative-query search", () => {
    const html = catalog(3, 1).replace("</body>", "<!-- " + Array.from({ length: 128 }, (_, index) => "__evolution_original_no_match_" + index + "__").join(" ") + " --></body>");
    const result = plan(html);
    expect(result.search.registry).toBeNull();
    expect(result.search.states).toEqual([]);
    expect(code(result, "search-original-query-unavailable")).toBe(true);
    expect(result.census.cards).toBe(3);
  });
  it("requires complete card/chapter identities and all data-search fields rather than accepting a partial first/last sample", () => {
    const html = catalog(3, 1).replace('id="card-2"', 'id="card-1"');
    const result = plan(html);
    expect(result.census.cards).toBe(3);
    expect(result.search.registry).toBeNull();
    expect(code(result, "duplicate-original-id")).toBe(true);
    expect(result.expectedScope.unobservedTargetIds.length).toBeGreaterThan(0);
  });
  it.each([
    ['missing card ID', (html: string) => html.replace('id="card-2"', "")],
    ['missing chapter ID', (html: string) => html.replace('id="chapter-0"', "")],
    ['missing data field', (html: string) => html.replace('data-search="beta bucket-1"', "")],
    ['duplicate input', (html: string) => html.replace("</body>", '<input id="search"></body>')],
    ['duplicate count', (html: string) => html.replace("</body>", '<output id="searchCount"></output></body>')],
    ['non-input search', (html: string) => html.replace('<input id="search">', '<div id="search"></div>')],
    ['disabled input', (html: string) => html.replace('<input id="search">', '<input disabled id="search">')],
    ['readonly input', (html: string) => html.replace('<input id="search">', '<input readonly id="search">')],
    ['unsupported input type', (html: string) => html.replace('<input id="search">', '<input type="file" id="search">')],
    ['unrelated card-class element', (html: string) => html.replace("</body>", '<div class="slide-card" id="extra"></div></body>')],
    ['orphan chapter', (html: string) => html.replace("</body>", '<section class="chapter" id="empty"></section></body>')],
    ['card also chapter', (html: string) => html.replace('class="slide-card"', 'class="slide-card chapter"')],
  ] as const)("keeps %s unavailable without omitted Original facts", (_name, mutate) => {
    const result = plan(mutate(catalog(3, 1)));
    expect(result.search.registry).toBeNull();
    expect(result.search.states).toEqual([]);
    expect(code(result, "search-original-scope-unavailable")).toBe(true);
    expect(result.expectedScope.coarseParents.every(parent => parent.support === "unresolved")).toBe(true);
  });
  it("retains missing-ID gaps while proposing structural roots instead of pretending positional identity is an ID", () => {
    const result = plan(wrap('<button>One</button><button>Two</button>'));
    expect(result.targets).toHaveLength(2);
    expect(result.targets.every(target => target.identityKind === "structural-path")).toBe(true);
    expect(result.targets[0]!.selector).toBe("html:nth-child(1) > body:nth-child(2) > button:nth-child(1)");
    expect(result.targets[1]!.selector).toBe("html:nth-child(1) > body:nth-child(2) > button:nth-child(2)");
    expect(code(result, "target-without-original-id")).toBe(true);
  });
  it("safely encodes arbitrary Original IDs as CSS string literals", () => {
    const result = plan(wrap('<button id="a&quot;]button[">Synthetic</button>'));
    expect(result.targets[0]!.id).toBe('a"]button[');
    expect(result.targets[0]!.identityKind).toBe("unique-id");
    expect(result.targets[0]!.selector).toBe('[id="\\61 \\22 \\5d \\62 \\75 \\74 \\74 \\6f \\6e \\5b "]');
  });
  it("invalidates an entire selected subtree when any descendant original ID is ambiguous", () => {
    const result = plan(wrap('<article class="slide-card" id="unique"><p id="same"></p><span id="same"></span></article>'));
    expect(result.targets[0]!.selector).toBeNull();
    expect(result.bootBatches).toEqual([]);
    expect(code(result, "subtree-id-unavailable")).toBe(true);
  });
  it("preserves inert/template and foreign target gaps, never emitting partial selected trees as complete", () => {
    const result = plan(wrap('<template><button id="inert">Inert</button></template><svg><a href="#foreign" id="foreign"></a></svg>'));
    expect(result.census.controls).toHaveLength(2);
    expect(result.bootBatches).toEqual([]);
    expect(result.expectedScope.unobservedTargetIds).toHaveLength(2);
    expect(code(result, "inert-target-unavailable")).toBe(true);
    expect(code(result, "foreign-target-unavailable")).toBe(true);
    expect(code(result, "template-activation-unavailable")).toBe(true);
  });
  it("retains parser uncertainty and full census without source-repair registries", () => {
    const result = plan('<html><head></head><body><button id="one">One</button></body></html>');
    expect(result.census.buttons).toBe(1);
    expect(result.bootBatches).toEqual([]);
    expect(code(result, "original-parser-uncertainty")).toBe(true);
    expect(code(result, "target-parser-uncertainty")).toBe(true);
  });
  it("fails a selector budget conservatively without clipping the Original identity", () => {
    const id = "x".repeat(200), result = plan(wrap('<button id="' + id + '">One</button>'));
    expect(result.targets[0]!.id).toBe(id);
    expect(result.targets[0]!.selector).toBeNull();
    expect(result.bootBatches).toEqual([]);
    expect(code(result, "target-selector-budget")).toBe(true);
  });
  it("retains every control above the plan limit and refuses truncated batch/profile claims", () => {
    const result = plan(wrap(Array.from({ length: 5001 }, (_, index) => '<button id="b-' + index + '">Synthetic</button>').join("")));
    expect(result.census.controls).toHaveLength(5001);
    expect(result.targets).toHaveLength(5001);
    expect(result.expectedScope.coarseParents).toHaveLength(5001);
    expect(result.bootBatches).toEqual([]);
    expect(result.runtimeProfile.refinements).toEqual([]);
    expect(result.expectedScope.unobservedTargetIds).toHaveLength(5001);
    expect(code(result, "runtime-target-plan-budget")).toBe(true);
  });
  it("refuses boot scope when an ancestry budget would hide descendant IDs", () => {
    const result = plan(wrap('<button id="outer">' + "<div>".repeat(130) + '<i id="deep"></i>' + "</div>".repeat(130) + "</button>"));
    expect(code(result, "original-ancestry-budget")).toBe(true);
    expect(result.bootBatches).toEqual([]);
    expect(result.expectedScope.unobservedTargetIds).toContain(result.targets[0]!.targetId);
  });
  it.each([
    { candidate: "<html>candidate</html>" }, { observedIds: ["invented"] }, { runtimeProfile: {} }, { pass: true }, { html: null },
    { sourceArtifactId: "" }, { originalSha256: "not-sha" }, { sourceArtifactId: "x".repeat(513) }, { html: "" },
  ])("rejects external/caller evidence and invalid Original boundaries %#", override => {
    expect(() => htmlProtectionOriginalRuntimePlan({ ...argsFor(catalog(3, 1)), ...override } as Parameters<typeof htmlProtectionOriginalRuntimePlan>[0])).toThrow();
  });
  it("is deterministic and owns returned arrays independently of previous calls/caller metadata", () => {
    const input = argsFor(catalog(3, 1)), first = htmlProtectionOriginalRuntimePlan(input), second = htmlProtectionOriginalRuntimePlan(input);
    expect(second).toEqual(first);
    first.census.controls[0]!.parentObligationIds.push("forged");
    first.search.states[0]!.expectedVisibleCardIds.length = 0;
    input.originalSha256 = "b".repeat(64);
    expect(second.originalSha256).toBe(originalSha256);
    expect(second.search.states[0]!.expectedVisibleCardIds).toHaveLength(3);
    expect(second.census.controls[0]!.parentObligationIds).not.toContain("forged");
  });
});
