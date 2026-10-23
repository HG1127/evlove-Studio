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

  it("scans all Campaign keys when guarding a specific Mission",async()=>{
    const seen:string[]=[];
    const legacy={...row,id:"legacy-campaign",type:"campaign",status:"waiting",
      idempotency_key:"old-runtime:another-key"};
    const rows=await readActiveJobRows(async(path)=>{
      seen.push(path);
      return seen.length===1?[legacy]:[];
    },{status:"waiting",kind:"campaign",missionId:"mission-a",limit:2,campaignKeyScope:"all"});
    expect(rows.map(item=>item.id)).toEqual(["legacy-campaign"]);
    const params=new URL("https://example.supabase.co/rest/v1/"+seen[0]).searchParams;
    expect(params.get("type")).toBe("eq.campaign");
    expect(params.get("mission_id")).toBe("eq.mission-a");
    expect(params.has("idempotency_key")).toBe(false);
    await expect(readActiveJobRows(async()=>[{...legacy,mission_id:"other-mission"}],{
      status:"waiting",kind:"campaign",missionId:"mission-a",limit:1,campaignKeyScope:"all",
    })).rejects.toThrow("does not match");
  });
  it("keeps the existing workflow-control filter for global reconciliation",async()=>{
    let path="";
    await readActiveJobRows(async p=>{path=p;return [];},{
      status:"waiting",kind:"campaign",limit:1,
    });
    expect(new URL("https://example.supabase.co/rest/v1/"+path)
      .searchParams.get("idempotency_key")).toBe("like.workflow-control*");
  });
  it("probes the production cursor grammar against an empty Mission",async()=>{
    const paths:string[]=[];
    const request=vi.fn(async(path:string)=>{paths.push(path);return [];});
    expect(await probeActiveJobPage(request)).toBe(true);
    const url=new URL("https://example.supabase.co/rest/v1/"+paths[0]);
    expect(url.searchParams.get("mission_id")).toBe('eq.health-probe-no-such-mission');
    expect(url.searchParams.get("or")).toContain('id.gt."health-probe-no-such-job"');
    expect(url.searchParams.get("order")).toBe("updated_at.asc,id.asc");
  });
});
