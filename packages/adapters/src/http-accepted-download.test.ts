// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {createHttpProductionPorts} from "./http-production-adapter";
const bytes=new TextEncoder().encode("<html>exact accepted bytes</html>"),identity={missionId:"m",candidateId:"c",sourceArtifactId:"s",acceptanceId:"a",validationId:"v",blobId:"b",sha256:createHash("sha256").update(bytes).digest("hex"),size:bytes.length,name:"exact.html",mimeType:"text/html"};
function response(value=identity,body=bytes){return new Response(new Uint8Array(body).buffer,{headers:{"Content-Type":value.mimeType,"Content-Length":String(value.size),"X-Evolution-Accepted-Identity":encodeURIComponent(JSON.stringify(value))}});}
afterEach(()=>vi.unstubAllGlobals());
describe("governed accepted download HTTP port (synthetic, no real backend)",()=>{
  it("uses the configured adapter base and its cookie policy, validates all response identity and copied bytes",async()=>{
    const fetch=vi.fn(async()=>response());vi.stubGlobal("fetch",fetch);
    const ports=createHttpProductionPorts("https://configured.example.test/custom/evolution/");
    const result=await ports.acceptedDownloads!.file({missionId:"m",candidateId:"c",sourceArtifactId:"s"});
    expect(fetch).toHaveBeenCalledWith("https://configured.example.test/custom/evolution/accepted-file?missionId=m&candidateId=c&sourceArtifactId=s",{credentials:"same-origin",cache:"no-store"});
    expect(result.identity).toEqual(identity);const copy=result.bytes;copy[0]=0;expect(result.bytes).toEqual(bytes);
  });
  it.each(["missionId","candidateId","sourceArtifactId","sha256","size","mimeType"] as const)("refuses %s response drift",async key=>{
    const altered={...identity};if(key==="size")altered.size++;else altered[key]+="changed";
    vi.stubGlobal("fetch",vi.fn(async()=>{const result=response(key==="mimeType"?identity:altered);if(key==="mimeType")result.headers.set("Content-Type",altered.mimeType);return result;}));
    await expect(createHttpProductionPorts("/other-api").acceptedDownloads!.file({missionId:"m",candidateId:"c",sourceArtifactId:"s"})).rejects.toThrow();
  });
  it("does not fetch another origin when governed access or receipt is missing",async()=>{
    const fetch=vi.fn(async()=>new Response("denied",{status:403}));vi.stubGlobal("fetch",fetch);
    await expect(createHttpProductionPorts("/custom").acceptedDownloads!.file({missionId:"m",candidateId:"c",sourceArtifactId:"s"})).rejects.toThrow("HTTP 403");expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(async()=>new Response(bytes));await expect(createHttpProductionPorts("/custom").acceptedDownloads!.file({missionId:"m",candidateId:"c",sourceArtifactId:"s"})).rejects.toThrow("receipt is missing");expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("validates official package schema and request identity on the configured port",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({schemaVersion:"accepted-package-download-v1",missionId:"foreign",candidateId:"c",acceptanceId:"a",validationId:"v",artifacts:[]}))));
    await expect(createHttpProductionPorts("/custom").acceptedDownloads!.package({missionId:"m",candidateId:"c"})).rejects.toThrow();
  });
});
