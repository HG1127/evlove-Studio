// @vitest-environment node
import { createHash } from "node:crypto";
import {mkdtempSync,readFileSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
const compile=vi.hoisted(()=>vi.fn());
vi.mock("vite",()=>({build:compile}));
import { buildOwnedHtmlProtectionRuntime, htmlProtectionRuntimePlugin, HTML_PROTECTION_RUNTIME_MODULE } from "../../build/html-protection-runtime-plugin";
const code='export async function runPrivateHtmlProtectionCloudRuntime(){throw new Error("synthetic-only")} export async function runPrivateHtmlProtectionSearchCloudRuntime(){throw new Error("synthetic-only")} export async function runPrivateHtmlProtectionWholeCloudRuntime(){throw new Error("synthetic-only")}';
function output(){return {output:[{type:"chunk",code,exports:["runPrivateHtmlProtectionCloudRuntime","runPrivateHtmlProtectionSearchCloudRuntime","runPrivateHtmlProtectionWholeCloudRuntime"],imports:["node:http","node:crypto"],dynamicImports:[]}]};}
beforeEach(()=>compile.mockReset().mockResolvedValue(output()));
describe("deployment-owned private runtime compilation",()=>{
  it("binds the entire exact UTF8 chunk and compiles only repository runtime without env or config loading",async()=>{
    const built=await buildOwnedHtmlProtectionRuntime("D:/synthetic-repository");
    expect(built).toEqual({version:"html-protection-private-cloud-v1",sha256:createHash("sha256").update(code).digest("hex"),byteLength:Buffer.byteLength(code),text:code});
    expect(Object.isFrozen(built)).toBe(true);
    expect(compile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({configFile:false,envFile:false,ssr:{noExternal:true},build:expect.objectContaining({write:false,sourcemap:false,minify:false,target:"node24",ssr:expect.stringContaining("vercel-sandbox-html-protection-cloud-runtime.ts")})}));
  });
  it.each([
    {output:[]},{output:[{type:"asset",source:code}]},
    {output:[{...output().output[0],imports:["untrusted-runtime"]}]},
    {output:[{...output().output[0],dynamicImports:["untrusted.mjs"]}]},
    {output:[{...output().output[0],exports:[]}]},
    {output:[...output().output,...output().output]},
    {output:[{...output().output[0],code:""}]},
    {output:[{...output().output[0],code:"x".repeat(4*1024*1024+1)}]},
  ])("refuses incomplete/foreign/unbounded bundles: %j",async value=>{
    compile.mockResolvedValue(value);await expect(buildOwnedHtmlProtectionRuntime("D:/synthetic-repository")).rejects.toThrow();
  });
  it("does not package private code in a client module",()=>{
    const plugin=htmlProtectionRuntimePlugin();
    const resolveId=plugin.resolveId;
    if(typeof resolveId!=="function")throw Error("Unexpected resolver hook");
    expect(()=>resolveId.call({environment:{name:"client"}} as never,HTML_PROTECTION_RUNTIME_MODULE,undefined,{} as never)).toThrow("server-only");
  });
});


describe("private runtime compatibility with independent Workflow bundling",()=>{
  it("materializes the same owned module before downstream Workflow builders run",async()=>{
    const root=mkdtempSync(path.join(tmpdir(),"evolution-owned-runtime-")),plugin=htmlProtectionRuntimePlugin();
    if(typeof plugin.configResolved!=="function")throw Error("Missing configuration hook");
    await plugin.configResolved.call({} as never,{root} as never);
    const generated=path.join(root,"node_modules/.cache/evolution/owned-html-protection-runtime.mjs");
    expect(existsSync(generated)).toBe(true);
    const expected=await buildOwnedHtmlProtectionRuntime(root);
    const loaded=await import(/* @vite-ignore */ pathToFileURL(generated).href);
    expect(loaded.default).toEqual(expected);expect(Object.isFrozen(loaded.default)).toBe(true);
    if(typeof plugin.load!=="function")throw Error("Missing module load hook");
    const virtual=await plugin.load.call({environment:{name:"ssr"}} as never,"\0"+HTML_PROTECTION_RUNTIME_MODULE,{} as never);
    expect(virtual).toBe("export default Object.freeze("+JSON.stringify(expected)+");");
  });
  it("binds the SDK compiler alias to the same ignored server-only generated path",()=>{
    const config=JSON.parse(readFileSync(path.resolve("tsconfig.json"),"utf8"));
    expect(config.compilerOptions.paths[HTML_PROTECTION_RUNTIME_MODULE]).toEqual(["./node_modules/.cache/evolution/owned-html-protection-runtime.mjs"]);
  });
  it("rejects build preparation failure instead of proceeding with an unverified module",async()=>{
    const root=mkdtempSync(path.join(tmpdir(),"evolution-owned-runtime-failure-")),plugin=htmlProtectionRuntimePlugin();
    compile.mockRejectedValueOnce(Error("synthetic compile refusal"));
    if(typeof plugin.configResolved!=="function")throw Error("Missing configuration hook");
    await expect(plugin.configResolved.call({} as never,{root} as never)).rejects.toThrow("synthetic compile refusal");
    expect(existsSync(path.join(root,"node_modules/.cache/evolution/owned-html-protection-runtime.mjs"))).toBe(false);
  });
});
