import { describe, expect, it } from "vitest";
import { htmlProtectionOriginalSearchCountFormat } from "./html-protection-original-search-count-format";

const sha = "a".repeat(64);
const setup = "const count = document.getElementById('searchCount'); const cards = Array.from(document.querySelectorAll('.slide-card'));";
const write = "let visible = 2; count.textContent = `${visible}/${cards.length}`;";
const document = (script = setup + write, control = '<span id="searchCount">2/2</span>', extra = "") =>
  '<!doctype html><html><head><meta charset="utf-8"></head><body>' + control + '<script>' + script + '</script>' + extra + '</body></html>';
const collect = (html = document()) => htmlProtectionOriginalSearchCountFormat({ sourceArtifactId: "source", originalSha256: sha, html });
function unavailable(html: string, code?: string) {
  const result = collect(html);
  expect(result.availability).toBe("unavailable");
  expect(result.countTemplate).toBeUndefined();
  expect(result.gaps.length).toBeGreaterThan(0);
  if (code) expect(result.gaps.map(item => item.code)).toContain(code);
  expect(result.slotMeaningVerified).toBe(false);
  return result;
}

describe("finite Original-only search counter format syntax", () => {
  it("extracts literal template slots and exact assignment/expression source locations", () => {
    const html = document(), result = collect(html);
    expect(result.availability).toBe("available"); expect(result.gaps).toEqual([]);
    expect(result).toMatchObject({ schemaVersion: "html-protection-original-search-count-format-v1", sourceArtifactId: "source",
      originalSha256: sha, slotMeaningVerified: false, countTemplate: { prefix: "", separator: "/", suffix: "" } });
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0]).toMatchObject({ scriptIndex: 0, receiver: { kind: "const-alias", name: "count" },
      visibleSlot: { kind: "identifier", name: "visible" }, totalSlot: { kind: "member-length", objectIdentifier: "cards", property: "length" } });
    const observation = result.writes[0]!;
    expect(html.slice(observation.assignmentRange.start, observation.assignmentRange.end)).toBe('count.textContent = `${visible}/${cards.length}`');
    expect(html.slice(observation.expressionRange.start, observation.expressionRange.end)).toBe('`${visible}/${cards.length}`');
    for (const key of ["pass", "verified", "complete", "wholeProtectionPassed", "proof", "permission"]) expect(result).not.toHaveProperty(key);
  });
  it("recognizes direct getElementById and exact querySelector without target alias assumptions", () => {
    for (const receiver of ["document.getElementById('searchCount')", "document.querySelector('#searchCount')"]) {
      const result = collect(document("const cards = [1, 2]; const visible = 2; " + receiver + ".textContent = `显示 ${visible} / ${cards.length} 张`;"));
      expect(result.availability).toBe("available");
      expect(result.writes[0]?.receiver).toEqual({ kind: "direct-control" });
      expect(result.countTemplate).toEqual({ prefix: "显示 ", separator: " / ", suffix: " 张" });
    }
  });
  it("preserves cooked Unicode/newline literals in string concatenation", () => {
    const result = collect(document(setup + "const visible = 2; count.textContent = '卡片😀\\n' + visible + ' / ' + cards.length + ' 张\\n';"));
    expect(result.availability).toBe("available");
    expect(result.countTemplate).toEqual({ prefix: "卡片😀\n", separator: " / ", suffix: " 张\n" });
  });
  it("retains all identical write ranges, including writes inside a declared function", () => {
    const html = document(setup + "let visible = 2; function render() { count.textContent = `${visible}/${cards.length}`; } render(); count.textContent = `${visible}/${cards.length}`;"), result = collect(html);
    expect(result.availability).toBe("available"); expect(result.writes).toHaveLength(2);
    expect(new Set(result.writes.map(item => item.assignmentRange.start)).size).toBe(2);
    expect(result.writes.every(item => html.slice(item.assignmentRange.start, item.assignmentRange.end) === 'count.textContent = `${visible}/${cards.length}`')).toBe(true);
  });
  it("keeps decoded UTF-16 ranges in complete source with comments, emoji and CRLF", () => {
    const html = document().replace('<head>', '<head><!-- 原始😀 -->\r\n').replace('<script>', '<script>\r\n'), result = collect(html);
    expect(result.availability).toBe("available");
    expect(html.slice(result.writes[0]!.expressionRange.start, result.writes[0]!.expressionRange.end)).toBe('`${visible}/${cards.length}`');
  });
  it("never runs supplied scripts or captured literal text", () => {
    const global = globalThis as { countCollectorExecuted?: boolean }; delete global.countCollectorExecuted;
    const result = collect(document(setup + "const visible = 2; count.textContent = `globalThis.countCollectorExecuted=true ${visible}/${cards.length}`;"));
    expect(result.availability).toBe("available"); expect(global.countCollectorExecuted).toBeUndefined();
    unavailable(document(setup + write + "globalThis.countCollectorExecuted=true;")); expect(global.countCollectorExecuted).toBeUndefined();
  });
  it("does not treat caller supplied SHA or identifier names as provenance or numeric semantics", () => {
    const result = collect(document(setup + "const visible = { any: 'value' }; count.textContent = `${visible}/${cards.length}`;"));
    expect(result.availability).toBe("available"); expect(result.slotMeaningVerified).toBe(false);
    expect(result.limitations.join(" ")).toContain("Original SHA is independently checked caller metadata");
    expect(result.limitations.join(" ")).toContain("do not establish numeric values");
  });
});

describe("unavailable control, document or executable source", () => {
  it.each([
    '<span id="other">2/2</span>',
    '<span id="searchCount">2/2</span><span id="searchCount">2/2</span>',
    '<template><span id="searchCount">2/2</span></template>',
    '<svg><text id="searchCount">2/2</text></svg>',
  ])("requires exactly one native non-inert Original searchCount control: %s", control => {
    unavailable(document(setup + write, control), "original-count-control-unavailable");
  });
  it("refuses incomplete/malformed documents rather than accepting a counter fragment", () => {
    unavailable('<span id="searchCount"></span><script>' + setup + write + '</script>', "original-count-document-uncertainty");
    unavailable(document().replace('</html>', ''), "original-count-document-uncertainty");
    unavailable(document().replace('<span id="searchCount">', '<span id="searchCount" id="duplicate">'), "original-count-document-uncertainty");
  });
  it.each([
    '<script src="https://fixture.invalid/script.js"></script>',
    '<script type="module">const untouched=1</script>',
    '<script type="application/json">{"counter":"unparsed"}</script>',
    '<template><script>counter.textContent=unknown</script></template>',
  ])("refuses additional scripts outside the closed classic-inline grammar: %s", extra => {
    unavailable(document(setup + write, undefined, extra), "original-count-unknown-script");
  });
  it("refuses unparsed inline handlers and executable references", () => {
    unavailable(document(setup + write, '<span id="searchCount" onclick="count.textContent=1">2/2</span>'), "original-count-unparsed-executable-reference");
    unavailable(document(setup + write, undefined, '<a href="java&#x73;cript:counter()">run</a>'), "original-count-unparsed-executable-reference");
  });
  it("records invalid JavaScript and missing count writers without running either", () => {
    unavailable(document(setup + write + "const =;"), "original-count-script-parser-unavailable");
    unavailable(document('const unrelated=1;'), "original-count-writer-unavailable");
  });
  it("refuses unknown calls even in another inline script", () => {
    unavailable(document(setup + write + "unknown();"), "original-count-unknown-call-reference");
    unavailable(document(setup + write, undefined, '<script>unresolved();</script>'), "original-count-unknown-call-reference");
  });
});

describe("count target aliases, rebound or reflective references remain unavailable", () => {
  it.each([
    "let count = document.getElementById('searchCount');",
    "var count = document.getElementById('searchCount');",
    "const count = document.getElementById('searchCount'); function other(count) {}",
  ])("refuses a nonunique immutable count binding: %s", declaration => {
    unavailable(document(declaration + "const cards = [1,2];" + write), "original-count-alias-rebinding");
  });
  it.each([
    "const alias=count;", "count=null;", "function observe(value){} observe(count);",
    "const state={count};", "count['textContent']='unexpected';", "count.innerHTML='unexpected';",
    "count.textContent+='changed';", "const previous=count.textContent;",
  ])("refuses count alias escape or unsupported property use: %s", extra => {
    unavailable(document(setup + write + extra));
  });
  it.each([
    "document.getElementById(variable)", "document.querySelector('#searchCount span')", "document.querySelectorAll('#searchCount')",
  ])("refuses dynamic, compound or ambiguous count selectors: %s", expression => {
    unavailable(document("const variable='searchCount'; const count=" + expression + "; const cards=[1,2];" + write));
  });
  it.each([
    "document.getElementById = function() {};", "const alias=document;", "window['eval']('unknown')", "globalThis.anything=1;",
    "eval('unknown');", "new Function('unknown');", "const proxy=Proxy;", "Reflect.set({}, 'x', 1);", "Object.defineProperty({}, 'x', {});",
    "Array.prototype.forEach=function(){};", "unknown?.();",
  ])("rejects document escape, dynamic execution or reflection: %s", extra => {
    unavailable(document(setup + write + extra));
  });
  it("rejects document shadowing anywhere, including nested function arguments", () => {
    unavailable(document(setup + write + "function other(document){}"), "original-count-document-shadowing");
  });
  it("does not treat an arbitrary fixed CSS selector as an independently known other control", () => {
    unavailable(document(setup + write + "const other=document.querySelector('.counter'); other.textContent='unknown';", '<span class="counter" id="searchCount">2/2</span>'), "original-count-unknown-write-reference");
    unavailable(document(setup + write + "const others=document.querySelectorAll('.counter'); others.textContent='unknown';"), "original-count-unknown-write-reference");
  });
  it("retains recognized writes but cannot supply a template after an unknown write", () => {
    const result = unavailable(document(setup + write + "unknownTarget.textContent='something';"), "original-count-unknown-write-reference");
    expect(result.writes).toHaveLength(1);
  });
});

describe("only fixed literal visible/member-length syntax may supply countTemplate", () => {
  it.each([
    "`${visible + 1}/${cards.length}`", "`${visible}/${cards.length + 1}`", "`${visible}/${other}`",
    "`${visible}/${cards['length']}`", "`${visible}/${cards.length}/${visible}`", "String(visible) + '/' + cards.length",
    "visible + '/' + cards.length", "`${visible()}/${cards.length}`", "`${visible}/${cards().length}`",
    "`${visible.toFixed(0)}/${cards.length}`", "`${visible}/${cards.length}`.trim()",
  ])("rejects dynamic, ambiguous or computed slot expression: %s", expression => {
    unavailable(document(setup + "let visible=2; count.textContent=" + expression + ";"));
  });
  it("retains every syntactic write when different literal formats disagree", () => {
    const result = unavailable(document(setup + write + "count.textContent = `找到 ${visible} of ${cards.length}`;"), "original-count-distinct-writes");
    expect(result.writes).toHaveLength(2); expect(result.writes.map(item => item.countTemplate.separator).sort()).toEqual([" of ", "/"]);
  });
  it("does not accept one shared format over different slot references or ambiguous slot bindings", () => {
    unavailable(document(setup + write + "const otherVisible=1; count.textContent=`${otherVisible}/${cards.length}`;"), "original-count-distinct-writes");
    unavailable(document(setup + write + "function unrelated(visible){}"), "original-count-slot-binding-ambiguous");
    unavailable(document(setup + "count.textContent=`${missing}/${cards.length}`;"), "original-count-slot-binding-ambiguous");
  });
  it("validates strict input without serializable authorization or extra executable fields", () => {
    const args = { sourceArtifactId: "source", originalSha256: sha, html: document() };
    for (const input of [{ ...args, sourceArtifactId: "" }, { ...args, originalSha256: "wrong" }, { ...args, html: "" },
      { ...args, evaluate: () => true }, { ...args, expectedCounter: "2/2" }]) {
      const result = htmlProtectionOriginalSearchCountFormat(input);
      expect(result.availability).toBe("unavailable"); expect(result.writes).toEqual([]);
      expect(result.gaps).toEqual([{ code: "invalid-original-count-source" }]);
    }
  });
});

describe("finite call receivers and immutable syntax bindings", () => {
  it("allows declared literal collection/string receivers and known inline callbacks only as syntax", () => {
    const html = document(setup + write + "cards.forEach(card => {}); const text='literal'; text.includes('value'); text.toLowerCase(); text.trim();");
    expect(collect(html).availability).toBe("available");
    expect(collect(html).slotMeaningVerified).toBe(false);
    expect(collect(document(setup + write + "const search=document.getElementById('other'); const respond=()=>{}; search.addEventListener('input',respond);")).availability).toBe("available");
  });
  it.each([
    "const opaque=unknown; opaque.forEach(()=>{});",
    "const opaque={forEach(){}}; opaque.forEach(()=>{});",
    "const opaque=unknown; opaque.toLowerCase();",
    "let mutable=[1,2]; mutable.forEach(()=>{});",
  ])("refuses a single declaration with an unknown or mutable member-call receiver: %s", extra => {
    unavailable(document(setup + write + extra), "original-count-unknown-call-reference");
  });
  it.each([
    "cards.forEach(externalCallback);",
    "cards.map(externalCallback);",
    "document.addEventListener('ready',externalCallback);",
    "window.addEventListener(eventName,()=>{});",
  ])("refuses unknown callback/event references: %s", extra => {
    unavailable(document(setup + write + extra), "original-count-unknown-callback-reference");
  });
  it("refuses Array.from over an unknown collection expression", () => {
    unavailable(document(setup + write + "const extra=Array.from(unknownCollection);"), "original-count-unknown-collection-reference");
  });
  it.each([
    "function render(){} render=unknown; render();",
    "function render(){} render++;",
    "const render=()=>{}; render=unknown; render();",
  ])("refuses a declared callable with a later reassignment or update: %s", extra => {
    unavailable(document(setup + write + extra), "original-count-callable-rebinding");
  });
  it("refuses Array/global or recognized native-member rebinding", () => {
    unavailable(document("const Array={from(){}};" + setup + write), "original-count-native-global-shadowing");
    unavailable(document(setup + write + "Array.from=unknown;"), "original-count-native-global-escape");
    unavailable(document(setup + write + "cards.forEach=unknown;"), "original-count-native-method-rebinding");
  });
});
