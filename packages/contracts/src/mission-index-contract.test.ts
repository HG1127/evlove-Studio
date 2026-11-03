import {describe,expect,it} from "vitest";
import {MissionIndexSnapshotSchema} from "./mission-index-contract";
const snapshot={schemaVersion:"mission-index-v1",workspaceId:"workspace",complete:true,items:[{missionId:"a",revision:0}]};
describe("Mission index boundary",()=>{
  it("accepts an explicitly complete empty or populated versioned index",()=>{
    expect(MissionIndexSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(MissionIndexSnapshotSchema.parse({...snapshot,items:[]}).items).toEqual([]);
  });
  it.each([{complete:false},{workspaceId:""},{schemaVersion:"mission-v1"},{items:[{missionId:"a",revision:-1}]},{items:[{missionId:"a",revision:1.1}]},{items:[{missionId:"a",revision:1},{missionId:"a",revision:2}]}])("rejects an incomplete or ambiguous index %j",change=>{
    expect(MissionIndexSnapshotSchema.safeParse({...snapshot,...change}).success).toBe(false);
  });
});
