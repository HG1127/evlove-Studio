import {afterEach,expect,it,vi} from "vitest";
import {CandidateSchema,EvolveProjectSchema} from "@evolution/contracts";
import {demoProject} from "../data/mock-project";
import {saveLocalProject} from "./local-store";
import {artifactSyncStatus} from "./artifact-blob-store";
import {localProductionPorts} from "./local-production-adapters";
import {configureProductionRuntime,resetProductionRuntime} from "./production-runtime";
import {initializeProductionSync,productionSyncStatus,stopProductionSync} from "./production-sync";
const blobs=vi.hoisted(()=>new Map<string,Blob>());
vi.mock("./local-artifact-blob-store",()=>({
  getLocalArtifactBlob:async(id:string)=>blobs.get(id),
  putLocalArtifactBlob:async(id:string,blob:Blob)=>{blobs.set(id,blob);},
  putLocalArtifactBlobs:async(entries:Array<{id:string;blob:Blob}>)=>{entries.forEach(({id,blob})=>blobs.set(id,blob));},
  deleteLocalArtifactBlob:async(id:string)=>{blobs.delete(id);},
}));
afterEach(async()=>{await stopProductionSync();resetProductionRuntime();window.localStorage.clear();blobs.clear();vi.useRealTimers();});
it("uploads historical Source and frozen Candidate bytes on first server bootstrap and retries an outage",async()=>{
  vi.useFakeTimers();window.localStorage.clear();
  const project=structuredClone(demoProject);
  project.id="historical-byte-migration";
  project.sourceArtifacts=[{...project.sourceArtifacts[0]!,id:"source-byte",storageRef:undefined}];
  project.candidates=[CandidateSchema.parse({id:"candidate",name:"Candidate",change:"Changed file",artifactSnapshots:[{
    id:"snapshot",sourceArtifactId:"source-byte",name:"source.html",mimeType:"text/html",content:"frozen",
    contentHash:"snapshot-hash",buildMode:"deterministic",notes:[],createdAt:"2026-10-08T00:00:00Z",
    frozenArtifact:{sourceArtifactId:"source-byte",snapshotHash:"snapshot-hash",blobId:"frozen-byte",name:"source.html",mimeType:"text/html",sha256:"byte-hash",size:6,verifiedAt:"2026-10-08T00:00:00Z",checks:[],limitations:[]},
  }]})];
  EvolveProjectSchema.parse(project);
  saveLocalProject(project);
  blobs.set("source-byte",new Blob(["source original"]));
  blobs.set("frozen-byte",new Blob(["frozen"]));
  blobs.set("unrelated-draft",new Blob(["unused"]));
  const stored=new Map<string,Blob>();
  let unavailable=true;
  const put=vi.fn(async(id:string,blob:Blob)=>{if(unavailable)throw new Error("HTTP 503");stored.set(id,blob);});
  configureProductionRuntime({...localProductionPorts,
    missions:{...localProductionPorts.missions,list:async()=>[project],save:async()=>undefined,delete:async()=>undefined},
    jobs:{...localProductionPorts.jobs,list:async()=>[],put:async()=>undefined},
    events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    artifacts:{put,get:async(id)=>stored.get(id),delete:async()=>undefined},
  },"http");
  await expect(initializeProductionSync()).rejects.toThrow("HTTP 503");
  expect(productionSyncStatus().realtimeStatus).toBe("http-error");
  unavailable=false;
  await vi.advanceTimersByTimeAsync(3000);
  expect(productionSyncStatus().realtimeStatus).toBe("http-polling");
  expect([...stored.keys()].sort()).toEqual(["frozen-byte","source-byte"]);
  expect(await stored.get("source-byte")!.text()).toBe("source original");
  expect(await stored.get("frozen-byte")!.text()).toBe("frozen");
});

it("only replays Artifact bytes referenced by a confirmed server Mission, retaining unrelated historic outbox rows",async()=>{
  vi.useFakeTimers();window.localStorage.clear();blobs.clear();
  const mission=structuredClone(demoProject);
  mission.id="confirmed-artifact-parent";
  mission.sourceArtifacts=[{...mission.sourceArtifacts[0]!,id:"owned-source",storageRef:undefined}];
  saveLocalProject(mission);
  blobs.set("owned-source",new Blob(["authorized original"],{type:"text/html"}));
  blobs.set("old-unowned",new Blob(["historical backup"],{type:"text/plain"}));
  window.localStorage.setItem("evolve-studio:artifact-sync:uploads:v1",JSON.stringify(["old-unowned","owned-source"]));
  const put=vi.fn(async()=>undefined);
  configureProductionRuntime({...localProductionPorts,
    missions:{...localProductionPorts.missions,list:async()=>[mission],save:async()=>undefined,delete:async()=>undefined},
    jobs:{...localProductionPorts.jobs,list:async()=>[],put:async()=>undefined},
    events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    artifacts:{put,get:async()=>undefined,delete:async()=>undefined},
  },"http");
  await initializeProductionSync();
  expect(put).toHaveBeenCalledWith("owned-source",expect.any(Blob));
  expect(put).not.toHaveBeenCalledWith("old-unowned",expect.any(Blob));
  expect(artifactSyncStatus()).toMatchObject({pendingUploads:1,pendingDeletes:0});
  await vi.advanceTimersByTimeAsync(3_000);
  expect(put).not.toHaveBeenCalledWith("old-unowned",expect.any(Blob));
  expect(blobs.has("old-unowned")).toBe(true);
});
