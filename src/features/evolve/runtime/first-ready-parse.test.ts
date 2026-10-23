import {describe,expect,it} from "vitest";
import {firstReadyParse} from "./first-ready-parse";

describe("first usable parsed Artifact",()=>{
  it("waits for a real result after an earlier parser rejects or returns undefined",async()=>{
    const first=Promise.reject(new Error("parse failed"));
    const second=Promise.resolve(undefined);
    const third=Promise.resolve({id:"real-source",role:"target"});
    await expect(firstReadyParse([first,second,third])).resolves.toMatchObject({id:"real-source"});
  });
  it("returns undefined only if every parser is unsuccessful",async()=>{
    await expect(firstReadyParse([Promise.resolve(undefined),Promise.reject(new Error("cancelled"))])).resolves.toBeUndefined();
    await expect(firstReadyParse([])).resolves.toBeUndefined();
  });
  it("does not wait for unrelated slower attachments once one real Artifact is ready",async()=>{
    const never=new Promise<{id:string}>(()=>{});
    await expect(firstReadyParse([never,Promise.resolve({id:"ready"})])).resolves.toEqual({id:"ready"});
  });
});
