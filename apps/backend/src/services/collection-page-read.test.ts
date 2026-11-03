// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {readMissionRowById,readRowsByIdPage} from "./collection-page-read";
const timeout={statusCode:503,data:{code:"SERVER_DATA_PLANE_UNAVAILABLE",service:"production-runtime",upstreamStatus:500,upstreamCode:"57014"}};
describe("complete collection pages after query timeout",()=>{
  it("looks up the exact ID and preserves all state without accepting a neighboring Mission",async()=>{
    const row={id:"mission/a b",revision:8,payload:{files:[{content:"exact original"}]}};
    const read=vi.fn(async(path:string)=>{const url=new URL(path,"https://db.test");expect(url.pathname).toBe("/rpc/read_evolution_mission_envelope");expect(url.searchParams.get("p_mission_id")).toBe(row.id);return [row];});
    expect(await readMissionRowById(read,row.id)).toEqual(row);
    await expect(readMissionRowById(async()=>[{...row,id:"neighbor"}],row.id)).rejects.toThrow("identity mismatch");
    await expect(readMissionRowById(async()=>[row,row],row.id)).rejects.toThrow();
    expect(await readMissionRowById(async()=>[],row.id)).toBeUndefined();
  });
  it("reduces the page at the same cursor and retains every returned field",async()=>{
    const row={id:"mission-b",revision:17,payload:{files:[{content:"entire artifact"}],evidence:{hash:"frozen-hash"}}};
    const read=vi.fn(async(path:string)=>{const url=new URL(path,"https://db.test");expect(url.pathname).toBe("/rpc/read_evolution_mission_envelope_page");expect(url.searchParams.get("p_after_id")).toBe("mission-a");if(Number(url.searchParams.get("p_page_limit"))>1)throw timeout;return [row];});
    expect(await readRowsByIdPage(read,"missions","","mission-a",10)).toEqual({rows:[row],nextCursor:"mission-b"});
    expect(read.mock.calls.map(([path])=>new URL(path,"https://db.test").searchParams.get("p_page_limit"))).toEqual(["2","1"]);
  });
  it("stops at one row rather than retrying an unfulfillable query indefinitely",async()=>{
    const read=vi.fn().mockRejectedValue(timeout);
    await expect(readRowsByIdPage(read,"missions")).rejects.toBe(timeout);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it.each([
    {statusCode:503,data:{...timeout.data,upstreamCode:undefined}},
    {statusCode:503,data:{...timeout.data,upstreamCode:"42501"}},
    {statusCode:503,data:{...timeout.data,service:"another-service"}},
    {statusCode:403},
  ])("preserves unrelated failures without masking them by changing the query",async failure=>{
    const read=vi.fn().mockRejectedValue(failure);
    await expect(readRowsByIdPage(read,"missions")).rejects.toBe(failure);
    expect(read).toHaveBeenCalledOnce();
  });
  it("does not change Job pagination policy",async()=>{
    const read=vi.fn().mockRejectedValue(timeout);
    await expect(readRowsByIdPage(read,"jobs","&mission_id=eq.scope",undefined,100)).rejects.toBe(timeout);
    expect(read).toHaveBeenCalledOnce();
  });
});
