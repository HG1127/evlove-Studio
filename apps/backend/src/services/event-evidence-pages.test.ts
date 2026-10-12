// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {createEvolutionEvent} from "@evolution/contracts";
import {eventRow} from "./event-persistence";
import {probeEventEvidencePage,readEventEvidencePage} from "./event-evidence-pages";

const first=createEvolutionEvent({id:"evt-a",missionId:"mission-1",type:"MissionUpdated",source:"test",payload:{}});
const second=createEvolutionEvent({id:"evt-b",missionId:"mission-1",type:"MissionUpdated",source:"test",payload:{}});

describe("Event Evidence scan pages",()=>{
  it("reads a bounded ID cursor page with a scoped Mission",async()=>{
    const paths:string[]=[];
    const request=vi.fn(async(path:string)=>{paths.push(path);return [eventRow(second)];});
    const page=await readEventEvidencePage(request,{missionId:"mission-1",afterId:"evt-a",limit:2});
    expect(page.events.map((event)=>event.id)).toEqual(["evt-b"]);
    expect(page.nextCursor).toBe("evt-b");
    const query=new URL("https://example.test/rest/v1/"+paths[0]).searchParams;
    expect(query.get("order")).toBe("id.asc");
    expect(query.get("mission_id")).toBe('eq.mission-1');
    expect(query.get("id")).toBe('gt.evt-a');
    expect(query.get("limit")).toBe("2");
  });

  it("advances using literal scalar IDs with punctuation",async()=>{
    const missionId='mission:一,()"\\&limit=50#%22';
    const afterId='evt:一,()"\\&or=(id.eq.x)#%22';
    const stored=[{...second,id:afterId+"z",missionId}];
    const request=vi.fn(async(path:string)=>{
      const query=new URL("https://db.test/"+path).searchParams;
      expect([...query.keys()]).toEqual(["select","order","limit","mission_id","id"]);
      expect(query.get("id")).toBe("gt."+afterId);
      return stored.filter((event)=>query.get("mission_id")==="eq."+event.missionId
        &&event.id>(query.get("id")?.slice(3)??"")).map(eventRow);
    });
    expect((await readEventEvidencePage(request,{missionId,afterId,limit:1})).events).toEqual(stored);
  });

  it("rejects replayed IDs and cross-Mission rows",async()=>{
    await expect(readEventEvidencePage(async()=>[eventRow(first),eventRow(first)],{limit:2}))
      .rejects.toThrow("cursor");
    await expect(readEventEvidencePage(async()=>[eventRow(first)],{missionId:"another",limit:1}))
      .rejects.toThrow("Mission scope");
  });

  it("probes the live query grammar without selecting user Events",async()=>{
    const paths:string[]=[];
    const request=vi.fn(async(path:string)=>{paths.push(path);return [];});
    await expect(probeEventEvidencePage(request)).resolves.toBe(true);
    const query=new URL("https://example.test/rest/v1/"+paths[0]).searchParams;
    expect(query.get("mission_id")).toBe('eq.health-probe-no-such-mission');
    expect(query.get("id")).toBe('gt.health-probe:no-such-event');
  });
});
