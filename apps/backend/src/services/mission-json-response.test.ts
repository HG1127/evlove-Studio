// @vitest-environment node
import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {missionJsonResponse} from "./mission-json-response";
import {missionEnvelope,MissionEnvelopeSchema} from "@evolution/contracts";
import {demoProject} from "../../../../src/features/evolve/data/mock-project";
describe("full Mission JSON streaming",()=>{
  it("streams a greater-than-6MB valid full receipt without changing a byte or Unicode content",async()=>{
    const envelope=missionEnvelope({...demoProject,name:"完整项目".repeat(550_000)},8);
    const expected=JSON.stringify(envelope),response=missionJsonResponse(envelope);
    expect(Buffer.byteLength(expected)).toBeGreaterThan(6_000_000);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("content-length")).toBe(false);
    const reader=response.body!.getReader(),chunks:Uint8Array[]=[];
    for(;;){const {value,done}=await reader.read();if(done)break;expect(value.length).toBeLessThanOrEqual(64*1024);chunks.push(value);}
    expect(chunks.length).toBeGreaterThan(90);
    const actual=Buffer.concat(chunks).toString("utf8");
    const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
    expect(hash(actual)).toBe(hash(expected));
    expect(MissionEnvelopeSchema.parse(JSON.parse(actual))).toEqual(envelope);
  });
  it.each([[],{items:[]},null])("preserves empty compatibility JSON %j",async value=>{
    expect(await missionJsonResponse(value).json()).toEqual(value);
  });
});
