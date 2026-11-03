// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {readMissionCatalog} from "./mission-catalog-read";
const row=(id:string)=>({id,payload_id:id,revision:8,title:"Title "+id,updated_at:"2026-11-03T00:00:00Z"});
describe("Mission directory boundary",()=>{
 it("reads display fields only and follows short pages until empty",async()=>{
  const paths:string[]=[];const request=vi.fn(async(path:string)=>{paths.push(path);return paths.length===1?[row("a/b")]:paths.length===2?[row("c")]:[];});
  const result=await readMissionCatalog(request,"workspace");
  expect(result.entries.map(value=>value.missionId)).toEqual(["a/b","c"]);expect(result.directoryComplete).toBe(true);expect(paths).toHaveLength(3);
  const select=new URL(paths[0],"https://data.test/").searchParams.get("select");
  expect(select).toBe("id,revision,payload_id:payload->>id,title:payload->>name,updated_at:payload->>updatedAt");expect(paths[1]).toContain("id=gt.a%2Fb");
  expect(JSON.stringify(result)).not.toContain('"payload":');
 });
 it("never returns a prefix on failure",async()=>{const request=vi.fn().mockResolvedValueOnce([row("a")]).mockRejectedValueOnce(new Error("timeout"));await expect(readMissionCatalog(request,"workspace")).rejects.toThrow("timeout");});
 it.each([[{...row("a"),payload_id:"wrong"}],[{...row("a"),revision:-1}],[{...row("a"),updated_at:null}]])("rejects corrupt identity and storage fields",async rows=>{await expect(readMissionCatalog(async()=>rows,"workspace")).rejects.toThrow();});
 it("rejects a repeated cursor",async()=>{await expect(readMissionCatalog(async()=>[row("a")],"workspace")).rejects.toThrow("repeated");});
 it("requires workspace identity",async()=>{await expect(readMissionCatalog(async()=>[],undefined)).rejects.toThrow();});
});
