// @vitest-environment node
import {describe,expect,it} from "vitest";
import {postgrestLogicValue,postgrestScalarValue} from "./postgrest-filter-values";

const values=["plain","event:one","one,two","a.b","a*b","(value)",'a"b',"a\\b",
  "&id=eq.foreign#one+two","事件:%22:一"," spaced "];

describe("PostgREST filter value contexts",()=>{
  it.each(values)("preserves standalone scalar value %s after URL decoding",(value)=>{
    const url=new URL("https://db.test/events?id=eq."+postgrestScalarValue(value)+"&limit=1");
    expect(url.searchParams.get("id")).toBe("eq."+value);
    expect([...url.searchParams.keys()]).toEqual(["id","limit"]);
    expect(url.hash).toBe("");
  });

  it.each(values)("quotes and escapes nested logic value %s",(value)=>{
    const url=new URL("https://db.test/events?or=(id.gt."+postgrestLogicValue(value)+")&limit=1");
    const escaped=value.replace(/\\/g,"\\\\").replace(/"/g,'\\"');
    expect(url.searchParams.get("or")).toBe('(id.gt."'+escaped+'")');
    expect([...url.searchParams.keys()]).toEqual(["or","limit"]);
    expect(url.hash).toBe("");
  });
});
