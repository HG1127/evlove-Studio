import {expect,it} from "vitest";
import {selectUnloadedMissionHeaders} from "./mission-directory-projection";
it("does not resurrect removed cards or replace complete state with a header",()=>{const headers=["full","removed","pending"].map(missionId=>({missionId,revision:8,title:missionId,updatedAt:"2026-11-03"}));expect(selectUnloadedMissionHeaders(headers,new Set(["full"]),new Set(["removed"])).map(value=>value.missionId)).toEqual(["pending"]);});
