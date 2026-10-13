// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const compile=vi.hoisted(()=>vi.fn());
vi.mock("vite",()=>({build:compile}));
import { buildOwnedHtmlProtectionRuntime, htmlProtectionRuntimePlugin, HTML_PROTECTION_RUNTIME_MODULE } from "../../build/html-protection-runtime-plugin";
const code='export async function runPrivateHtmlProtectionCloudRuntime(){throw new Error("synthetic-only")} export async function runPrivateHtmlProtectionSearchCloudRuntime(){throw new Error("synthetic-only")}';
function output(){return {output:[{type:"chunk",code,exports:["runPrivateHtmlProtectionCloudRuntime","runPrivateHtmlProtectionSearchCloudRuntime"],imports:["node:http","node:crypto"],dynamicImports:[]}]};}
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
