import {beforeEach,describe,expect,it,vi} from "vitest";
import {Blob as NodeBlob} from "node:buffer";
import {webcrypto} from "node:crypto";
import JSZip from "jszip";
import {CandidateSchema,TestCaseSchema,type EvolveProject} from "@evolution/contracts";
import {demoProject} from "../data/mock-project";
import {freezeArtifact} from "../runtime/frozen-artifact";
import {artifactTargetAdapter} from "./artifact-adapter";

const blobs=vi.hoisted(()=>new Map<string,Blob>());
vi.mock("../runtime/artifact-blob-store",()=>({
  getArtifactBlob:async(id:string)=>blobs.get(id),
  putArtifactBlob:async(id:string,blob:Blob)=>{blobs.set(id,blob);},
}));

async function archive(text:string){
  const zip=new JSZip();
  zip.file("src/config.ts",`export function configureProject() { return "configuration setup ${text}"; }`);
  zip.file("src/setup.ts",`export function setupProject() { return "setup configuration ${text}"; }`);
  zip.file("README.md",`Configuration setup steps: ${text}`);
  zip.file("package.json",JSON.stringify({name:"candidate-config",version:"1.0.0"}));
  return new Blob([new Uint8Array(await zip.generateAsync({type:"uint8array"}))],{type:"application/zip"});
}

const testCase=TestCaseSchema.parse({
  id:"STATIC-CONFIG",title:"Configuration setup",input:"Check configuration setup implementation",
  expected:["configuration setup"],tags:[],hidden:true,criterionIds:["CONFIG"],
  executionMode:"static-evidence",evidenceScope:"implementation",
});

function project():EvolveProject{
  const source={...demoProject.sourceArtifacts[0]!,id:"repo",name:"app.zip",mimeType:"application/zip",
    extension:"zip",artifactKind:"codebase" as const,role:"target" as const,
    textContent:"OLD UPLOADED CONFIGURATION",textExcerpt:"OLD UPLOADED CONFIGURATION",
    structuredContent:{entries:[{path:"src/old.ts",content:"OLD UPLOADED CONFIGURATION"}]}};
  return {...demoProject,sourceArtifacts:[source],acceptanceRubric:[{
    id:"CONFIG",title:"Configuration setup",requirement:"Configuration setup implementation exists",
    source:"user-command",weight:100,hardGate:true,judgeType:"structural",validationMethod:"static-structure",
    minScore:85,evidenceExpected:["configuration setup"],protectedConstraint:false,artifactIds:["repo"],category:"outcome",
  }]} as EvolveProject;
}

beforeEach(()=>{
  blobs.clear();
  vi.stubGlobal("Blob",NodeBlob);
  vi.stubGlobal("crypto",webcrypto);
});

describe("frozen Candidate ZIP static evidence",()=>{
  it("reads and indexes the exact frozen ZIP instead of the original source or overlay text",async()=>{
    const content=JSON.stringify({kind:"codebase",overlay:true,files:[{path:"src/config.ts",content:"NEW CANDIDATE CONFIGURATION"}]});
    const frozen=await freezeArtifact({sourceArtifactId:"repo",content,blob:await archive("NEW CANDIDATE CONFIGURATION"),name:"app-evolved.zip",checks:["zip"],limitations:[]});
    const candidate=CandidateSchema.parse({id:"C1",name:"New config",change:"Improve setup",artifactSnapshots:[{
      id:"snapshot",sourceArtifactId:"repo",name:"app.zip",mimeType:"application/zip",content,createdAt:"2026-09-27T00:00:00.000Z",frozenArtifact:frozen,
    }]});
    const result=await artifactTargetAdapter.run({project:project(),testCase,variant:candidate});
    expect(result.verificationStatus, result.output).toBe("verified");
    expect(result.artifactHash).toBe(frozen.sha256);
    expect(result.output).toContain("NEW CANDIDATE CONFIGURATION");
    expect(result.output).not.toContain("OLD UPLOADED CONFIGURATION");
    expect(result.trace.some((step)=>step.stage==="candidate-static-evidence"&&step.status==="pass")).toBe(true);
  });

  it("keeps a missing or tampered frozen ZIP unverified",async()=>{
    const content=JSON.stringify({kind:"codebase",overlay:true,files:[{path:"src/config.ts",content:"NEW"}]});
    const frozen=await freezeArtifact({sourceArtifactId:"repo",content,blob:await archive("NEW"),name:"app-evolved.zip",checks:["zip"],limitations:[]});
    const candidate=CandidateSchema.parse({id:"C2",name:"New config",change:"Improve setup",artifactSnapshots:[{
      id:"snapshot",sourceArtifactId:"repo",name:"app.zip",mimeType:"application/zip",content,createdAt:"2026-09-27T00:00:00.000Z",frozenArtifact:frozen,
    }]});
    const missing=CandidateSchema.parse({...candidate,artifactSnapshots:[{...candidate.artifactSnapshots[0]!,frozenArtifact:undefined}]});
    expect((await artifactTargetAdapter.run({project:project(),testCase,variant:missing})).verificationStatus).toBe("unverified");
    blobs.set(frozen.blobId,await archive("TAMPERED"));
    const tampered=await artifactTargetAdapter.run({project:project(),testCase,variant:candidate});
    expect(tampered.verificationStatus).toBe("unverified");
    expect(tampered.output).toContain("校验不一致");
  });
});