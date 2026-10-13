// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve, relative, isAbsolute, basename } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile, symlink, unlink, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { TestCaseSchema, type TestCase } from "@evolution/contracts";
import { VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT, sandboxBrowserCommandTimeoutMs } from "./vercel-sandbox-browser-runner";

const html = '<!doctype html><html><meta name="viewport" content="width=device-width"><title>Isolated synthetic browser</title><style>body{margin:0}#first{height:80px}#gap{height:1600px}#late,#brokenReveal{height:120px;opacity:0;transform:translateY(40px)}#wrongTransform{opacity:1;transform:translateY(40px)}#track{width:200px;height:8px;background:#ddd}#bar{width:0%;height:8px;background:red}.control{position:fixed;right:0;width:110px;height:28px}#nav{top:0}#badNav{top:30px}#top{top:60px}#badTop{top:90px}#poison{top:120px}#mobileMenu,#brokenMobileMenu,#mobilePanel{display:none}@media(max-width:600px){#mobileMenu,#brokenMobileMenu{display:block;position:fixed;left:0;width:120px;height:28px;top:0}#brokenMobileMenu{top:30px}#mobilePanel.is-open{display:block;position:fixed;left:0;top:60px;width:220px;height:80px;background:#eee}}#hoverCard,#brokenHover{width:200px;height:60px;margin:20px;transform:none}#hoverCard:hover{transform:translateY(-2px)}#hoverReset{top:200px}</style><body><header id="first">First</header><button class="control" id="nav">Navigate</button><button class="control" id="badNav">Bad navigate</button><button class="control" id="top">Top</button><button class="control" id="badTop">Bad top</button><button class="control" id="poison">Poison APIs</button><div id="poisonNote"></div><button id="mobileMenu" aria-expanded="false">Mobile menu</button><button id="brokenMobileMenu" aria-expanded="false">Broken mobile menu</button><nav id="mobilePanel">Mobile navigation</nav><div id="transparent" style="opacity:0">Legacy visible</div><div style="opacity:0"><div id="opaqueChild" style="opacity:1">Hidden through parent</div></div><div id="wrongTransform">Moved</div><button id="menu" aria-expanded="false" class="menu">Open</button><input id="task" type="checkbox"><input id="brokenTask" type="checkbox"><p id="done">0 done</p><div id="track"><div id="bar"></div></div><div id="shadow" style="opacity:0.5"></div><div id="slotHost"><span id="slotted" slot="card" style="opacity:1">Slotted card</span></div><div id="alwaysHidden" style="display:none">Hidden</div><article id="hoverCard">Synthetic hover</article><article id="brokenHover">Broken hover</article><button class="control" id="hoverReset">Fixed reset target</button><div id="gap"></div><article id="late">Revealed late card</article><article id="brokenReveal">Broken reveal</article><script>document.querySelector("#mobileMenu").onclick=()=>{document.querySelector("#mobileMenu").setAttribute("aria-expanded","true");document.querySelector("#mobilePanel").classList.add("is-open")};document.querySelector("#nav").onclick=()=>document.querySelector("#first").scrollIntoView();document.querySelector("#top").onclick=()=>window.scrollTo({top:0});document.querySelector("#menu").onclick=()=>{document.querySelector("#menu").setAttribute("aria-expanded","true");document.querySelector("#menu").classList.add("open")};document.querySelector("#task").onchange=()=>{document.querySelector("#done").textContent="1 done";document.querySelector("#bar").style.width="50%"};document.querySelector("#brokenTask").onchange=()=>{document.querySelector("#bar").style.width="10%"};const root=document.querySelector("#shadow").attachShadow({mode:"open"});root.innerHTML="<span id=inner style=opacity:0.5>Shadow</span>";const slotted=document.querySelector("#slotHost").attachShadow({mode:"open"});slotted.innerHTML="<div style=opacity:0><slot name=card></slot></div>";new IntersectionObserver(entries=>{for(const item of entries)if(item.isIntersecting){item.target.style.opacity="1";item.target.style.transform="translateY(0)"}}).observe(document.querySelector("#late"));document.querySelector("#poison").onclick=()=>{document.querySelector("#poisonNote").textContent="Main APIs poisoned";window.getComputedStyle=()=>({opacity:"1",getPropertyValue:property=>property==="opacity"?"1":property==="width"?"9999px":property==="transform"?"none":"block"});Element.prototype.getBoundingClientRect=()=>({x:0,y:0,top:0,left:0,right:9999,bottom:9999,width:9999,height:9999});Document.prototype.querySelectorAll=()=>[];Element.prototype.querySelectorAll=()=>[];Object.defineProperty(window,"scrollY",{value:0,configurable:true});Object.defineProperty(window,"innerWidth",{value:1,configurable:true});Object.defineProperty(document.documentElement,"scrollWidth",{value:9999,configurable:true});Object.defineProperty(Document.prototype,"title",{get:()=>"Forged main-world title",configurable:true});window.DOMMatrixReadOnly=class{toFloat64Array(){return [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}};window.IntersectionObserver=class{constructor(callback){this.callback=callback}observe(target){this.callback([{target,intersectionRatio:1,isIntersecting:true}])}disconnect(){}}};</script></body></html>';
const steps = {
  scroll: { action: "scroll-into-view", selector: "#late" },
  opacity: { action: "computed-style", selector: "#late", property: "opacity", mode: "numeric-range", min: 0.99, max: 1 },
  identity: { action: "computed-style", selector: "#late", property: "transform", mode: "identity-transform" },
};
const cases: Array<{ id: string; steps: unknown[]; status: string; assertions?: number; raw?: boolean }> = [
  { id: "hover-only-is-not-an-assertion", steps: [{ action: "hover", selector: "#hoverCard" }], status: "partial", assertions: 0 },
  { id: "actual-hover-and-reset", steps: [{ action: "hover", selector: "#hoverCard" }, { action: "computed-style", selector: "#hoverCard", property: "transform", mode: "literal", value: "matrix(1, 0, 0, 1, 0, -2)" }, { action: "hover", selector: "#hoverReset" }, { action: "computed-style", selector: "#hoverCard", property: "transform", mode: "identity-transform" }], status: "verified", assertions: 2 },
  { id: "broken-hover-cannot-pass-style", steps: [{ action: "hover", selector: "#brokenHover" }, { action: "computed-style", selector: "#brokenHover", property: "transform", mode: "literal", value: "matrix(1, 0, 0, 1, 0, -2)" }], status: "failed", assertions: 0 },
  { id: "hover-restoration-is-measured", steps: [{ action: "hover", selector: "#hoverCard" }, { action: "computed-style", selector: "#hoverCard", property: "transform", mode: "identity-transform" }], status: "failed", assertions: 0 },
  { id: "spoofed-hover-observation-fails", steps: [{ action: "click", selector: "#poison" }, { action: "hover", selector: "#brokenHover" }, { action: "computed-style", selector: "#brokenHover", property: "transform", mode: "literal", value: "matrix(1, 0, 0, 1, 0, -2)" }], status: "failed", assertions: 0 },
  { id: "raw-hover-callback-rejected", steps: [{ action: "hover", selector: "#hoverCard", evaluate: "document.body.remove()" }], status: "unverified", assertions: 0, raw: true },
  { id: "viewport-only-is-not-an-assertion", steps: [{ action: "viewport", selector: "html", width: 390, height: 844 }], status: "partial", assertions: 0 },
  { id: "mobile-menu-actual-open", steps: [{ action: "viewport", selector: "html", width: 390, height: 844 }, { action: "click", selector: "#mobileMenu" }, { action: "attribute", selector: "#mobileMenu", name: "aria-expanded", value: "true" }, { action: "attribute", selector: "#mobilePanel", name: "class", mode: "contains", value: "is-open" }, { action: "computed-style", selector: "#mobilePanel", property: "display", mode: "literal", value: "block" }, { action: "in-viewport", selector: "#mobilePanel", ratio: 0.5 }], status: "verified", assertions: 4 },
  { id: "mobile-menu-broken-click", steps: [{ action: "viewport", selector: "html", width: 390, height: 844 }, { action: "click", selector: "#brokenMobileMenu" }, { action: "attribute", selector: "#brokenMobileMenu", name: "aria-expanded", value: "true" }], status: "failed" },
  { id: "desktop-mobile-menu-hidden", steps: [{ action: "computed-style", selector: "#mobileMenu", property: "display", mode: "literal", value: "none" }], status: "verified", assertions: 1 },
  { id: "desktop-mobile-menu-not-visible", steps: [{ action: "computed-style", selector: "#mobileMenu", property: "display", mode: "literal", value: "block" }], status: "failed" },
  { id: "mobile-menu-really-visible", steps: [{ action: "viewport", selector: "html", width: 390, height: 844 }, { action: "computed-style", selector: "#mobileMenu", property: "display", mode: "literal", value: "none" }], status: "failed" },
  { id: "mobile-menu-switch-back-to-desktop", steps: [{ action: "viewport", selector: "html", width: 390, height: 844 }, { action: "click", selector: "#mobileMenu" }, { action: "viewport", selector: "html", width: 1440, height: 960 }, { action: "computed-style", selector: "#mobileMenu", property: "display", mode: "literal", value: "none" }], status: "verified", assertions: 1 },
  { id: "raw-invalid-viewport", steps: [{ action: "viewport", selector: "html", width: 239, height: 844 }], status: "unverified", assertions: 0, raw: true },
  { id: "old-visible-transparent", steps: [{ action: "visible", selector: "#transparent" }], status: "verified", assertions: 1 },
  { id: "transparent-style-fails", steps: [{ ...steps.opacity, selector: "#transparent" }], status: "failed" },
  { id: "ancestor-opacity-fails", steps: [{ ...steps.opacity, selector: "#opaqueChild" }], status: "failed" },
  { id: "shadow-effective-opacity", steps: [{ action: "computed-style", selector: "#inner", property: "opacity", mode: "numeric-range", min: 0.249, max: 0.251 }], status: "verified", assertions: 1 },
  { id: "slotted-transparent-fails", steps: [{ ...steps.opacity, selector: "#slotted" }], status: "failed" },
  { id: "slotted-effective-zero", steps: [{ action: "computed-style", selector: "#slotted", property: "opacity", mode: "numeric-range", min: 0, max: 0 }], status: "verified", assertions: 1 },
  { id: "actual-card-reveal", steps: [steps.scroll, { action: "in-viewport", selector: "#late", ratio: 0.5 }, steps.opacity, steps.identity], status: "verified", assertions: 3 },
  { id: "broken-reveal", steps: [{ action: "scroll-into-view", selector: "#brokenReveal" }, { ...steps.opacity, selector: "#brokenReveal" }], status: "failed" },
  { id: "wrong-transform", steps: [{ ...steps.identity, selector: "#wrongTransform" }], status: "failed" },
  { id: "menu-attribute", steps: [{ action: "click", selector: "#menu" }, { action: "attribute", selector: "#menu", name: "aria-expanded", value: "true" }, { action: "attribute", selector: "#menu", name: "class", mode: "contains", value: "open" }], status: "verified", assertions: 2 },
  { id: "wrong-attribute", steps: [{ action: "attribute", selector: "#menu", name: "aria-expanded", value: "true" }], status: "failed" },
  { id: "checklist-progress", steps: [{ action: "click", selector: "#task" }, { action: "checked", selector: "#task", checked: true }, { action: "text", selector: "#done", value: "1 done" }, { action: "computed-style", selector: "#bar", property: "width", mode: "parent-relative", relativeTo: "#track", min: 0.49, max: 0.51 }], status: "verified", assertions: 3 },
  { id: "unchecked", steps: [{ action: "checked", selector: "#task", checked: false }], status: "verified", assertions: 1 },
  { id: "wrong-checked", steps: [{ action: "checked", selector: "#task", checked: true }], status: "failed" },
  { id: "broken-progress", steps: [{ action: "click", selector: "#brokenTask" }, { action: "computed-style", selector: "#bar", property: "width", mode: "parent-relative", relativeTo: "#track", min: 0.49, max: 0.51 }], status: "failed" },
  { id: "correct-navigation", steps: [steps.scroll, { action: "click", selector: "#nav" }, { action: "in-viewport", selector: "#first", ratio: 0.5 }], status: "verified", assertions: 1 },
  { id: "broken-navigation", steps: [steps.scroll, { action: "click", selector: "#badNav" }, { action: "in-viewport", selector: "#first", ratio: 0.5 }], status: "failed" },
  { id: "to-top", steps: [steps.scroll, { action: "click", selector: "#top" }, { action: "scroll-position", selector: "html", min: 0, max: 2 }], status: "verified", assertions: 1 },
  { id: "broken-to-top", steps: [steps.scroll, { action: "click", selector: "#badTop" }, { action: "scroll-position", selector: "html", min: 0, max: 2 }], status: "failed" },
  { id: "outside-viewport", steps: [{ action: "in-viewport", selector: "#late", expected: false }], status: "verified", assertions: 1 },
  { id: "scroll-only", steps: [steps.scroll], status: "partial", assertions: 0 },
  { id: "computed-display", steps: [{ action: "computed-style", selector: "#alwaysHidden", property: "display", mode: "literal", value: "none" }], status: "verified", assertions: 1 },
  { id: "numeric-width", steps: [{ action: "computed-style", selector: "#track", property: "width", mode: "numeric-range", min: 199, max: 201 }], status: "verified", assertions: 1 },
  { id: "spoofed-opacity-fails", steps: [{ action: "click", selector: "#poison" }, { ...steps.opacity, selector: "#transparent" }], status: "failed" },
  { id: "spoofed-opacity-actual-zero", steps: [{ action: "click", selector: "#poison" }, { action: "computed-style", selector: "#transparent", property: "opacity", mode: "numeric-range", min: 0, max: 0 }], status: "verified", assertions: 1 },
  { id: "spoofed-matrix-fails", steps: [{ action: "click", selector: "#poison" }, { ...steps.identity, selector: "#wrongTransform" }], status: "failed" },
  { id: "spoofed-geometry-actual-width", steps: [{ action: "click", selector: "#poison" }, { action: "computed-style", selector: "#track", property: "width", mode: "numeric-range", min: 199, max: 201 }], status: "verified", assertions: 1 },
  { id: "spoofed-native-viewport-fails", steps: [{ action: "click", selector: "#poison" }, { action: "in-viewport", selector: "#late" }], status: "failed" },
  { id: "spoofed-native-viewport-outside", steps: [{ action: "click", selector: "#poison" }, { action: "in-viewport", selector: "#late", expected: false }], status: "verified", assertions: 1 },
  { id: "spoofed-scroll-fails", steps: [steps.scroll, { action: "click", selector: "#poison" }, { action: "scroll-position", selector: "html", min: 0, max: 2 }], status: "failed" },
  { id: "spoofed-scroll-physical-value", steps: [steps.scroll, { action: "click", selector: "#poison" }, { action: "scroll-position", selector: "html", min: 1000, max: 5000 }], status: "verified", assertions: 1 },
  { id: "spoofed-dom-prototype-actual-query", steps: [{ action: "click", selector: "#poison" }, { action: "in-viewport", selector: "#first", ratio: 0.5 }], status: "verified", assertions: 1 },
  { id: "unsupported-isolated-selector", steps: [{ action: "computed-style", selector: "role=button", property: "opacity", mode: "numeric-range", min: 0, max: 1 }], status: "unverified", assertions: 0 },  { id: "unknown-operation", steps: [{ action: "evaluate", selector: "html", value: "throw new Error()" }], status: "unverified", assertions: 0, raw: true },
  { id: "unknown-field", steps: [{ action: "visible", selector: "#first", evaluate: "arbitrary" }], status: "unverified", assertions: 0, raw: true },
];
type Result = { testCaseId: string; verificationStatus: string; assertions: number; error?: string; trace: Array<{ id: string; stage: string; status: string; summary: string; detail?: string }> };
const run = promisify(execFile);
const tempParent = resolve(tmpdir());
let server: Server | undefined, root: string | undefined;
let results: Result[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tempParent, "evolution-sandbox-typed-"));
  await mkdir(join(root, "runtime"), { recursive: true });
  await mkdir(join(root, "browser", "node_modules"), { recursive: true });
  const require = createRequire(import.meta.url);
  const playwrightRequire = createRequire(require.resolve("@playwright/test/package.json"));
  await symlink(dirname(playwrightRequire.resolve("playwright/package.json")), join(root, "browser", "node_modules", "playwright"), process.platform === "win32" ? "junction" : "dir");
  const script = join(root, "runtime", "browser-runner.mjs"), input = join(root, "runtime", "browser-cases.json");
  await writeFile(script, VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT, "utf8");
  const parsedCases = cases.map(item => {
    const paper = { id: item.id, title: item.id, input: "Synthetic typed observations", expected: ["Actual state"],
      hidden: true, executionMode: "external-runner", evidenceScope: "product-behavior", browserSteps: item.steps };
    return item.raw ? paper : TestCaseSchema.parse(paper);
  });
  await writeFile(input, JSON.stringify(parsedCases), "utf8");
  server = createServer((_req, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(html); });
  await new Promise<void>(resolveListen => server!.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing owned fixture listener");
  const environment: NodeJS.ProcessEnv = { TEMP: root, TMP: root, NODE_OPTIONS: "--max-old-space-size=512" };
  for (const name of ["PATH", "SystemRoot", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "COMSPEC", "HOME", "PLAYWRIGHT_BROWSERS_PATH"]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  // No copy-text cases: never invoke the local browser's native OS clipboard.
  const { stdout, stderr } = await run(process.execPath, [script, input, "http://127.0.0.1:" + address.port], {
    cwd: root, env: environment, timeout: sandboxBrowserCommandTimeoutMs(parsedCases as unknown as TestCase[]), maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  if (stderr.trim()) throw new Error("Synthetic browser runtime error: " + stderr.slice(0, 2000));
  results = JSON.parse(stdout).results;
  const evidenceDir = process.env.EVOLUTION_TYPED_BROWSER_EVIDENCE_DIR;
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(join(evidenceDir, "typed-browser-results.json"), JSON.stringify({
      scriptSha256: createHash("sha256").update(VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT).digest("hex"),
      fixtureSha256: createHash("sha256").update(html).digest("hex"), cases: parsedCases, results,
      scope: "Actual trusted script in local Chromium with synthetic HTML; no cloud, user file or native clipboard execution",
    }, null, 2), "utf8");
  }
}, 240000);
afterAll(async () => {
  if (server) await new Promise<void>((resolveClose, reject) => server!.close(error => error ? reject(error) : resolveClose()));
  if (root) {
    const target = resolve(root), child = relative(tempParent, target);
    if (!child || child.startsWith("..") || isAbsolute(child) || !basename(target).startsWith("evolution-sandbox-typed-")) throw new Error("Unsafe synthetic fixture cleanup");
    await unlink(join(target, "browser", "node_modules", "playwright")).catch(error => { if (error.code !== "ENOENT") throw error; });
    await rm(target, { recursive: true, force: true });
  }
}, 60000);
describe("typed source-grounded browser facts in synthetic local Chromium", () => {
  for (const item of cases) it(item.id, () => {
    const result = results.find(run => run.testCaseId === item.id)!;
    expect(result).toBeDefined();
    expect(result.verificationStatus, result.error).toBe(item.status);
    if (item.assertions !== undefined) expect(result.assertions).toBe(item.assertions);
    if (item.status === "failed") expect(result.trace.some(trace => trace.stage === "browser-step" && trace.status === "fail")).toBe(true);
    if (item.status === "unverified") expect(result.trace.some(trace => trace.stage === "browser-step" && trace.status === "warning")).toBe(true);
    if (item.id.startsWith("mobile-menu") || item.id === "viewport-only-is-not-an-assertion") expect(result.trace.filter(trace => trace.stage === "browser-step" && trace.summary === "viewport html")).toHaveLength(item.id === "mobile-menu-switch-back-to-desktop" ? 2 : 1);
    if (item.id.includes("navigation") || item.id.includes("to-top")) {
      expect(result.trace.filter(trace => trace.summary === "scroll-into-view #late")).toHaveLength(1);
    }
    if (item.id.startsWith("spoofed-") && item.status === "verified") expect(result.trace.find(trace => trace.stage === "browser-step" && trace.detail?.includes("chromium-cdp-isolated-v1"))).toBeDefined();
    if (item.id.startsWith("spoofed-") && item.status === "verified") expect(result.trace.filter(trace => trace.stage === "layout").map(trace => [trace.status, trace.detail])).toEqual([["pass", "Isolated synthetic browser"], ["pass", "Isolated synthetic browser"]]);
    if (item.id === "actual-card-reveal") expect(result.trace.find(trace => trace.summary === "computed-style #late")?.detail).toContain("effectiveOpacity");
  });
});
