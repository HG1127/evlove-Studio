// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {readRowsByIdPage} from "./collection-page-read";
const timeout={statusCode:503,data:{code:"SERVER_DATA_PLANE_UNAVAILABLE",service:"production-runtime",upstreamStatus:500,upstreamCode:"57014"}};
describe("complete collection pages after query timeout",()=>{
  it("reduces the page at the same cursor and retains every returned field",async()=>{
    const row={id:"mission-b",revision:17,payload:{files:[{content:"entire artifact"}],evidence:{hash:"frozen-hash"}}};
    const read=vi.fn(async(path:string)=>{const url=new URL(path,"https://db.test");expect(url.searchParams.get("id")).toBe("gt.mission-a");if(Number(url.searchParams.get("limit"))>2)throw timeout;return [row];});
    expect(await readRowsByIdPage(read,"missions","","mission-a",10)).toEqual({rows:[row],nextCursor:"mission-b"});
    expect(read.mock.calls.map(([path])=>new URL(path,"https://db.test").searchParams.get("limit"))).toEqual(["10","5","2"]);
  });
  it("stops at one row rather than retrying an unfulfillable query indefinitely",async()=>{
    const read=vi.fn().mockRejectedValue(timeout);
    await expect(readRowsByIdPage(read,"missions")).rejects.toBe(timeout);
    expect(read).toHaveBeenCalledTimes(4);
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
