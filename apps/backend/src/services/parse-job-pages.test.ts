// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {readRecentParseJobRows} from "./parse-job-pages";

const at="2026-09-25T00:00:00.000Z";
const row={id:"parse-a",created_at:at,updated_at:at,type:"parse",metadata:{sessionId:"s"}};
const args={since:at,limit:2,sessionId:"s"};

describe("Parse Job recovery pages",()=>{
  it("rejects repeated cursor rows",async()=>{
    const request=vi.fn(async()=>[row]);
    await expect(readRecentParseJobRows(request,args)).rejects.toThrow("did not advance");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects a row outside the requested session or recency window",async()=>{
    await expect(readRecentParseJobRows(async()=>[{...row,metadata:{sessionId:"other"}}],args))
      .rejects.toThrow("does not match");
    await expect(readRecentParseJobRows(async()=>[{...row,updated_at:"2026-09-24T00:00:00.000Z"}],args))
      .rejects.toThrow("does not match");
  });

  it("reads a recent Parse Job using the literal session and timestamp values",async()=>{
    const sessionId='session:一,()"\\&limit=100#%22';
    const stored={...row,metadata:{sessionId}};
    const request=vi.fn(async(path:string)=>{
      const query=new URL("https://db.test/"+path).searchParams;
      expect(query.get("updated_at")).toBe("gte."+at);
      return query.get("metadata->>sessionId")==="eq."+sessionId
        &&Date.parse(stored.updated_at)>=Date.parse(query.get("updated_at")!.slice(4))?[stored]:[];
    });
    expect(await readRecentParseJobRows(request,{since:at,limit:1,sessionId})).toEqual([stored]);
  });

  it("encodes the scalar session and checks the descending cursor filter",async()=>{
    const paths:string[]=[];
    const request=vi.fn(async(path:string)=>{paths.push(path);return [];});
    await readRecentParseJobRows(request,{
      since:at,limit:1,sessionId:"session/a,b",
      after:{createdAt:at,id:"parse-a"},
    });
    const url=new URL("https://example.supabase.co/rest/v1/"+paths[0]);
    expect(url.searchParams.get("metadata->>sessionId")).toBe('eq.session/a,b');
    expect(url.searchParams.get("or")).toContain('id.lt."parse-a"');
    expect(url.searchParams.get("order")).toBe("created_at.desc,id.desc");
  });
});
