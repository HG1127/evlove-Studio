// @vitest-environment node
import {createHash,webcrypto} from "node:crypto";
import {readFileSync} from "node:fs";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {EvolveProjectSchema,missionEnvelope, type MissionEnvelope} from "@evolution/contracts";
import {P3X_BLOB_ID,P3X_MISSION_ID,registerAndBindP3XSource} from "./p3x-source-binding";

const original=readFileSync("tests/fixtures/p3x-synthetic-task-board/original.html","utf8");
const fixture=EvolveProjectSchema.parse(JSON.parse(readFileSync("tests/fixtures/p3x-synthetic-task-board/mission.template.json","utf8")));
const digest=createHash("sha256").update(original).digest("hex");
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
type Scenario={remoteText?:string;prebound?:boolean;badReceipt?:boolean;rejectCas?:boolean;forbidden?:boolean;integrityBlocked?:boolean};
function server(scenario:Scenario={}){
  let envelope:MissionEnvelope=missionEnvelope(EvolveProjectSchema.parse({
    ...fixture,sourceArtifacts:[{...fixture.sourceArtifacts[0]!,
      ...(scenario.prebound?{storageRef:P3X_BLOB_ID}:{})}],
  }),1);
  let blob=scenario.remoteText??(scenario.prebound?original:undefined);
  const fetch=vi.fn(async(url:string,init:RequestInit={})=>{
    const method=init.method??"GET",body=init.body?JSON.parse(String(init.body)):undefined;
    if(url==="/api/evolution/lab-job-integrity"&&method==="GET"){
      return reply({mode:"read-only",status:scenario.integrityBlocked?"blocked":"clear",
        issues:scenario.integrityBlocked?[{reason:"mission-missing"}]:[]});
    }
    if(url==="/api/evolution/missions/"+P3X_MISSION_ID){
      if(scenario.forbidden)return reply({message:"forbidden"},403);
      if(method==="GET")return reply(envelope);
      if(method==="PUT"){
        if(scenario.rejectCas)return reply({message:"revision mismatch"},409);
        if(body?.revision!==envelope.revision||body?.missionId!==P3X_MISSION_ID)throw Error("CAS mismatch");
        envelope= {...body,revision:envelope.revision+1};
        return reply(envelope);
      }
    }
    if(url==="/api/evolution/artifacts/"+P3X_BLOB_ID&&method==="GET"){
      return blob===undefined?reply({message:"not found"},404)
        :new Response(blob,{status:200,headers:{"Content-Type":"text/html"}});
    }
    if(url==="/api/evolution/artifacts/register"&&method==="POST"){
      if(body.id!==P3X_BLOB_ID||body.missionId!==P3X_MISSION_ID||body.kind!=="source"
        ||body.mimeType!=="text/html"||body.content!==original)throw Error("registration payload drift");
      blob=original;
      return reply({id:P3X_BLOB_ID,missionId:P3X_MISSION_ID,kind:"source",
        sha256:scenario.badReceipt?"f".repeat(64):digest,size:2067});
    }
    throw Error("Unexpected "+method+" "+url);
  });
  vi.stubGlobal("fetch",fetch);
  return {fetch,getEnvelope:()=>envelope,getBlob:()=>blob};
}
beforeEach(()=>{
  vi.stubGlobal("crypto",webcrypto);
  expect(digest).toBe("192abea39d167d9c0f4310fc603905905de5fa44106685fc7d6ea3d2931da8dc");
});
afterEach(()=>vi.unstubAllGlobals());
describe("P3-X exact original authenticated physical custody & CAS binding",()=>{
  it("registers only the exact original via mission.write API then verifies physical bytes and CAS receipt",async()=>{
    const a=server();
    await expect(registerAndBindP3XSource()).resolves.toEqual({state:"bound",revision:2,blobId:P3X_BLOB_ID});
    expect(a.getEnvelope().payload.sourceArtifacts[0]?.storageRef).toBe(P3X_BLOB_ID);
    expect(a.fetch.mock.calls.map(([path,init])=>[(init?.method??"GET"),path])).toEqual([
      ["GET","/api/evolution/lab-job-integrity"],
      ["GET","/api/evolution/missions/"+P3X_MISSION_ID],
      ["GET","/api/evolution/artifacts/"+P3X_BLOB_ID],
      ["POST","/api/evolution/artifacts/register"],
      ["GET","/api/evolution/artifacts/"+P3X_BLOB_ID],
      ["PUT","/api/evolution/missions/"+P3X_MISSION_ID],
      ["GET","/api/evolution/missions/"+P3X_MISSION_ID],
      ["GET","/api/evolution/artifacts/"+P3X_BLOB_ID],
    ]);
    expect(JSON.stringify(a.fetch.mock.calls)).not.toMatch(/authorization|apiKey|secret|MiniMax-M3/i);
  });
  it("resumes registered-but-not-bound bytes without writing them twice",async()=>{
    const a=server({remoteText:original});
    const receipt=await registerAndBindP3XSource();
    expect(receipt.state).toBe("bound");
    expect(a.fetch.mock.calls.filter(([path])=>path.includes("/register"))).toHaveLength(0);
    expect(a.fetch.mock.calls.filter(([,init])=>init?.method==="PUT")).toHaveLength(1);
  });
  it("returns already-bound only after actual remote byte check and without another write",async()=>{
    const a=server({prebound:true});
    await expect(registerAndBindP3XSource()).resolves.toMatchObject({state:"already-bound",revision:1});
    expect(a.fetch.mock.calls.filter(([,init])=>init?.method==="PUT"||init?.method==="POST")).toHaveLength(0);
  });
  it("fails closed on global Lab integrity blockers before any Mission or Artifact access",async()=>{
    const a=server({integrityBlocked:true});
    await expect(registerAndBindP3XSource()).rejects.toThrow(/完整性未核验通过/);
    expect(a.fetch).toHaveBeenCalledTimes(1);
    expect(a.fetch.mock.calls[0]?.[0]).toBe("/api/evolution/lab-job-integrity");
  });
  it("does not overwrite another remote artifact with mismatched bytes",async()=>{
    const a=server({remoteText:"unexpected older blob"});
    await expect(registerAndBindP3XSource()).rejects.toThrow(/SHA-256/);
    expect(a.fetch.mock.calls.some(([,init])=>init?.method==="POST"||init?.method==="PUT")).toBe(false);
  });
  it("does not CAS-bind when registration receipt mismatches the expected SHA",async()=>{
    const a=server({badReceipt:true});
    await expect(registerAndBindP3XSource()).rejects.toThrow(/回执不匹配/);
    expect(a.fetch.mock.calls.filter(([,init])=>init?.method==="PUT")).toHaveLength(0);
    expect(a.getEnvelope().revision).toBe(1);
  });
  it("leaves the registered physical artifact recoverable on a Mission CAS conflict",async()=>{
    const a=server({rejectCas:true});
    await expect(registerAndBindP3XSource()).rejects.toThrow(/HTTP 409/);
    expect(a.getEnvelope().revision).toBe(1);
    expect(a.getBlob()).toBe(original);
    expect(a.fetch.mock.calls.filter(([,init])=>init?.method==="PUT")).toHaveLength(1);
  });
  it("does not send mutation on insufficient mission.write authorization",async()=>{
    const a=server({forbidden:true});
    await expect(registerAndBindP3XSource()).rejects.toThrow(/HTTP 403/);
    expect(a.fetch).toHaveBeenCalledTimes(2);
  });
  it("does not act on tampered inline original content",async()=>{
    const a=server();
    const envelope=a.getEnvelope();
    envelope.payload.sourceArtifacts[0]!.textContent="untrusted mutation";
    await expect(registerAndBindP3XSource()).rejects.toThrow(/冻结 SHA-256/);
    expect(a.fetch).toHaveBeenCalledTimes(2);
  });
});
