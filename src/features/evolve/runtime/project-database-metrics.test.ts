import {afterEach,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
import {CandidateSchema} from "../schemas";
import {databaseProjects,saveDatabaseProjects,flushProjectDatabase,initializeProjectDatabase} from "./project-database";
afterEach(async()=>{saveDatabaseProjects([]);await flushProjectDatabase();vi.unstubAllGlobals();});
it("repairs an invalid in-memory projection left alive by HMR before the next sync",async()=>{
 const stored=new Map<string,unknown>();
 const db={transaction:()=>{
  const tx={oncomplete:undefined as undefined|(()=>void),objectStore:()=>({
   get:(key:string)=>{const request={result:stored.get(key),onsuccess:undefined as undefined|(()=>void)};queueMicrotask(()=>request.onsuccess?.());return request;},
   put:(value:unknown,key:string)=>{stored.set(key,structuredClone(value));queueMicrotask(()=>tx.oncomplete?.());},
  })};return tx;
 }};
 vi.stubGlobal("indexedDB",{open:()=>{const request={result:db,onsuccess:undefined as undefined|(()=>void)};queueMicrotask(()=>request.onsuccess?.());return request;}});
 const project={...structuredClone(demoProject),candidates:[CandidateSchema.parse({id:"C1",name:"C1",change:"x"})]};
 await initializeProjectDatabase([project]);
 databaseProjects()![0]!.candidates[0]!.costDelta=NaN;
 const recovered=databaseProjects()![0]!;
 expect(recovered.id).toBe(project.id);expect(Number.isFinite(recovered.candidates[0]!.costDelta)).toBe(true);
 expect(recovered.candidates[0]!.artifactSnapshots).toEqual(project.candidates[0]!.artifactSnapshots);
 await flushProjectDatabase();
 expect((stored.get("projects") as typeof project[])[0]!.candidates[0]!.costDelta).toBe(0);
});
