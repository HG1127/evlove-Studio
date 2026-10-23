// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {probeServerEventPage,readServerEventRows} from "./event-pages";

const at="2026-09-25T00:00:00.000Z";
function row(id:string,missionId="mission-1",time=at){
  return {id,mission_id:missionId,at:time};
}

describe("server Event pages",()=>{
  it("fills the requested limit across short pages with tied timestamps",async()=>{
    const stored=[row("z"),row("y"),row("x","mission-1","2026-09-24T23:59:00.000Z")];
    const paths:string[]=[];
    const request=vi.fn(async(path:string)=>{
      paths.push(path);
      const filter=new URL("https://db.test/"+path).searchParams.get("or");
      const cursor=filter?.match(/at\.eq\."([^"]+)",id\.lt\."([^"]+)"/);
      const remaining=cursor?stored.filter((event)=>event.at<cursor[1]
        ||event.at===cursor[1]&&event.id<cursor[2]):stored;
      return remaining.slice(0,1);
    });
    expect((await readServerEventRows(request,"mission-1",3)).map((event)=>event.id))
      .toEqual(["z","y","x"]);
    expect(paths).toHaveLength(3);
    expect(paths.every((path)=>new URL("https://db.test/"+path).searchParams.get("order")==="at.desc,id.desc"
      &&new URL("https://db.test/"+path).searchParams.get("mission_id")==='eq.mission-1')).toBe(true);
  });

  it("continues until an empty page when the server cap is below the request",async()=>{
    const stored=[row("b"),row("a")];
    const request=vi.fn(async(path:string)=>{
      const filter=new URL("https://db.test/"+path).searchParams.get("or");
      const cursor=filter?.match(/id\.lt\."([^"]+)"/);
      return (cursor?stored.filter((event)=>event.id<cursor[1]):stored).slice(0,1);
    });
    expect((await readServerEventRows(request,"mission-1",3)).map((event)=>event.id))
      .toEqual(["b","a"]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("rejects a replayed Event page",async()=>{
    await expect(readServerEventRows(async()=>[row("a")],"mission-1",3))
      .rejects.toThrow(/repeated an id/);
  });

  it("quotes punctuation in a cursor ID",async()=>{
    const unusual='a,(b)"\\';
    const request=vi.fn(async(path:string)=>{
      if(request.mock.calls.length===2){
        expect(new URL("https://db.test/"+path).searchParams.get("or"))
          .toContain('id.lt."a,(b)\\"\\\\"');
        return [];
      }
      return [row(unusual)];
    });
    expect(await readServerEventRows(request,"mission-1",2)).toHaveLength(1);
  });

  it("rejects invalid pages and cross-Mission rows",async()=>{
    await expect(readServerEventRows(async()=>({id:"a"}),"mission-1",2))
      .rejects.toThrow(/not an array/);
    await expect(readServerEventRows(async()=>[row("a","another")],"mission-1",2))
      .rejects.toThrow(/requested Mission/);
    await expect(readServerEventRows(async()=>[{at}],"mission-1",2))
      .rejects.toThrow(/cursor is invalid/);
  });

  it("probes the same cursor grammar without reading user Events",async()=>{
    const request=vi.fn(async(path:string)=>{
      const query=new URL("https://db.test/"+path).searchParams;
      expect(query.get("mission_id")).toBe('eq.health-probe-no-such-mission');
      expect(query.get("or")).toContain('id.lt."health-probe-no-such-event"');
      expect(query.get("limit")).toBe("1");
      return [];
    });
    await expect(probeServerEventPage(request)).resolves.toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });
});
