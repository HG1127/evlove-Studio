import {expect,it} from "vitest";
import {MissionCatalogSnapshotSchema,MissionReadProgressSchema} from "./mission-catalog-contract";
import {MissionEnvelopeSchema} from "./production-contracts";
const header={missionId:"one",revision:8,title:"Only a directory title",updatedAt:"2026-11-03"};
it("keeps directory data distinct from a full Mission",()=>{const value=MissionCatalogSnapshotSchema.parse({schemaVersion:"mission-catalog-v1",workspaceId:"w",directoryComplete:true,entries:[header]});expect(MissionEnvelopeSchema.safeParse(value.entries[0]).success).toBe(false);});
it("rejects duplicate directory identity",()=>{expect(MissionCatalogSnapshotSchema.safeParse({schemaVersion:"mission-catalog-v1",workspaceId:"w",directoryComplete:true,entries:[header,header]}).success).toBe(false);});
it.each([{total:2,verified:3,complete:false},{total:2,verified:1,complete:true}])("rejects overstated progress",value=>{expect(MissionReadProgressSchema.safeParse({schemaVersion:"mission-read-progress-v1",workspaceId:"w",...value}).success).toBe(false);});
