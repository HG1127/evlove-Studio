// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {probeActiveJobPage,readActiveJobRows} from "./active-job-pages";

const at="2026-09-25T00:00:00.000Z";
const row={id:"job-a",updated_at:at,status:"running",type:"parse",mission_id:"mission-a"};

describe("active Job pages",()=>{
  it("rejects a repeated cursor instead of looping or returning duplicate Jobs",async()=>{
    const request=vi.fn(async()=>[row]);
    await expect(readActiveJobRows(request,{
      status:"running",kind:"parse",limit:2,missionId:"mission-a",
    })).rejects.toThrow("did not advance");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects a row outside the requested Mission and Job kind",async()=>{
    await expect(readActiveJobRows(async()=>[{...row,mission_id:"mission-b"}],{
      status:"running",kind:"parse",limit:1,missionId:"mission-a",
    })).rejects.toThrow("does not match");
    await expect(readActiveJobRows(async()=>[{...row,type:"campaign"}],{
      status:"running",kind:"parse",limit:1,
    })).rejects.toThrow("does not match");
  });

  it("probes the production cursor grammar against an empty Mission",async()=>{
    const paths:string[]=[];
    const request=vi.fn(async(path:string)=>{paths.push(path);return [];});
    expect(await probeActiveJobPage(request)).toBe(true);
    const url=new URL("https://example.supabase.co/rest/v1/"+paths[0]);
    expect(url.searchParams.get("mission_id")).toBe('eq."health-probe-no-such-mission"');
    expect(url.searchParams.get("or")).toContain('id.gt."health-probe-no-such-job"');
    expect(url.searchParams.get("order")).toBe("updated_at.asc,id.asc");
  });
});
