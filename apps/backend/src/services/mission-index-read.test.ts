// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {readMissionIndexSnapshot} from "./mission-index-read";
describe("thin Mission index reads",()=>{
  it("follows short pages until empty without loading any payload",async()=>{
    const paths:string[]=[];
    const request=vi.fn(async(path:string)=>{
      paths.push(path);const url=new URL(path,"https://data.test/");
      expect(url.searchParams.get("select")).toBe("id,revision");
      expect(url.searchParams.get("limit")).toBe("500");
      expect(url.searchParams.get("order")).toBe("id.asc");
      return paths.length===1?[{id:"a/b",revision:0}]:paths.length===2?[{id:"c",revision:12}]:[];
    });
    expect(await readMissionIndexSnapshot(request,"workspace")).toEqual({schemaVersion:"mission-index-v1",workspaceId:"workspace",complete:true,items:[{missionId:"a/b",revision:0},{missionId:"c",revision:12}]});
    expect(paths[1]).toContain("id=gt.a%2Fb");expect(paths).toHaveLength(3);
  });
  it("never publishes a prefix after an upstream failure",async()=>{
    const request=vi.fn().mockResolvedValueOnce([{id:"a",revision:1}]).mockRejectedValueOnce(new Error("unavailable"));
    await expect(readMissionIndexSnapshot(request,"workspace")).rejects.toThrow("unavailable");expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([{rows:[{id:"a",revision:-1}]},{rows:[{id:"a",revision:"1"}]},{rows:Array.from({length:501},(_,i)=>({id:String(i),revision:0}))}])("rejects malformed or oversized storage responses",async({rows})=>{
    await expect(readMissionIndexSnapshot(async()=>rows,"workspace")).rejects.toThrow();
  });
  it("rejects a repeating cursor rather than looping",async()=>{
    const request=vi.fn(async()=>[{id:"a",revision:1}]);
    await expect(readMissionIndexSnapshot(request,"workspace")).rejects.toThrow("repeated");expect(request).toHaveBeenCalledTimes(2);
  });
  it("requires a workspace even for an empty response",async()=>{
    await expect(readMissionIndexSnapshot(async()=>[],undefined)).rejects.toThrow();
  });
});
