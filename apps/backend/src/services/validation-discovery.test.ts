// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {createEvolutionEvent,type ValidationResult} from "@evolution/contracts";
import {discoverValidations} from "./validation-discovery";

const result:ValidationResult={
  id:"validation:one",schemaVersion:"validation-v1",missionId:"mission-1",artifactId:"artifact-1",
  artifactSha256:"a".repeat(64),requestFingerprint:"b".repeat(64),status:"passed",
  checks:[],reason:"All requested checks passed",createdAt:"2026-09-25T00:00:00.000Z",
};
const validation=createEvolutionEvent({
  id:"validation-result:"+result.id,missionId:result.missionId,type:"ValidationPassed",
  source:"backend-validation-runtime",payload:{validationId:result.id,validation:result},at:result.createdAt,
});
const unrelated=createEvolutionEvent({
  id:"job-created:one",missionId:"mission-1",type:"JobQueued",source:"backend-job-lifecycle",payload:{},
});

describe("Validation discovery",()=>{
  it("advances the Event cursor across pages with no matching Validation",async()=>{
    const list=vi.fn()
      .mockResolvedValueOnce({events:[unrelated],nextCursor:unrelated.id})
      .mockResolvedValueOnce({events:[validation],nextCursor:validation.id});
    const first=await discoverValidations({missionId:"mission-1",artifactId:"artifact-1",limit:1},list);
    expect(first).toEqual({scanned:1,validations:[],nextCursor:unrelated.id});
    const second=await discoverValidations({missionId:"mission-1",artifactId:"artifact-1",afterId:first.nextCursor,limit:1},list);
    expect(second).toEqual({scanned:1,validations:[result],nextCursor:validation.id});
    expect(list).toHaveBeenNthCalledWith(2,{missionId:"mission-1",afterId:unrelated.id,limit:1});
  });

  it("filters by Artifact after validating authoritative Event identity",async()=>{
    const page=await discoverValidations({missionId:"mission-1",artifactId:"artifact-2"},
      async()=>({events:[validation],nextCursor:validation.id}));
    expect(page).toEqual({scanned:1,validations:[],nextCursor:validation.id});
    await expect(discoverValidations({missionId:"mission-1"},async()=>({
      events:[{...validation,source:"another-runtime"}],nextCursor:validation.id,
    }))).rejects.toThrow("binding is invalid");
  });

  it("rejects missing scope, oversized scans, and cross-Mission rows",async()=>{
    await expect(discoverValidations({},async()=>({events:[]}))).rejects.toThrow();
    await expect(discoverValidations({missionId:"mission-1",limit:51},async()=>({events:[]}))).rejects.toThrow();
    await expect(discoverValidations({missionId:"mission-1",limit:1},async()=>({
      events:[unrelated,validation],nextCursor:validation.id,
    }))).rejects.toThrow("exceeded");
    await expect(discoverValidations({missionId:"mission-2"},async()=>({
      events:[unrelated],nextCursor:unrelated.id,
    }))).rejects.toThrow("Mission scope");
  });
});
