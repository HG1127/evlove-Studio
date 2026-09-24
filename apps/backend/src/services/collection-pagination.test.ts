// @vitest-environment node
import {describe,expect,it} from "vitest";
import {collectionPageQuery} from "./collection-pagination";

describe("collection page query",()=>{
  it("preserves the legacy full-list request and validates bounded pages",()=>{
    expect(collectionPageQuery({})).toBeUndefined();
    expect(collectionPageQuery({pageLimit:"25",cursor:"job-a"})).toEqual({pageLimit:25,cursor:"job-a"});
    expect(collectionPageQuery({cursor:"job-a"})).toEqual({pageLimit:100,cursor:"job-a"});
    expect(()=>collectionPageQuery({pageLimit:"0"})).toThrow();
    expect(()=>collectionPageQuery({pageLimit:"501"})).toThrow();
    expect(()=>collectionPageQuery({cursor:""})).toThrow();
  });
});
