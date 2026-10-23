// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {CandidateSchema,TestCaseSchema,type EvolveProject} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {executeServerExperimentCandidate} from "@evolution/harness";
import {parseServerSource,SERVER_SOURCE_PARSE_EXTENSIONS} from "./server-source-parser";
import {buildServerCandidateTargetContext} from "./server-candidate-context";
import {materializeServerCandidateArtifacts,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
import {verifyServerCandidateNativeFormats} from "./server-candidate-native-roundtrip";
import {runServerCurrentStoredEvidence} from "./server-current-stored-evidence";
import {runServerFrozenArtifactStaticEvidence} from "./server-static-artifact-evidence";
import * as XLSX from "xlsx";

const blobs=vi.hoisted(()=>new Map<string,Blob>());
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id),
  put:async(id:string,blob:Blob)=>{blobs.set(id,blob);}})}));
beforeEach(()=>blobs.clear());

const formats=["txt","md","markdown","mdx","css","scss","less","js","jsx","ts","tsx","mjs","cjs",
  "py","go","rs","java","kt","php","vue","svelte","toml","ini","conf","log","graphql","gql",
  "sh","bash","zsh","env","rb","kts","sql","json","jsonl","yaml","yml","xml","svg"];
function content(ext:string,revision:number){
  if(ext==="json"||ext==="jsonl")return JSON.stringify({revision})+"\n";
  if(ext==="yaml"||ext==="yml")return "revision: "+revision+"\n";
  if(ext==="xml")return "<root><revision>"+revision+"</revision></root>";
  if(ext==="svg")return '<svg xmlns="http://www.w3.org/2000/svg"><text>'+revision+'</text></svg>';
  return "original preserved text\nrevision="+revision+"\n";
}
const formatCase=()=>TestCaseSchema.parse({id:"FORMAT",title:"Native format",input:"Reopen exact file",expected:["same format"],
  criterionIds:["FORMAT"],executionMode:"roundtrip",evidenceScope:"format"});
function rubric(project:EvolveProject,id:string){
  project.acceptanceRubric=[{id:"FORMAT",title:"Native format",requirement:"same format",source:"system-integrity",
    weight:100,hardGate:true,judgeType:"integrity",validationMethod:"format-roundtrip",minScore:100,
    evidenceExpected:["actual bytes"],protectedConstraint:false,artifactIds:[id],category:"integrity"}];
}

describe("all advertised text formats use actual same-format bytes",()=>{
  it.each(formats)("%s upload → context → mutation → frozen format/static evidence",async ext=>{
    const project=acceptedPackageFixture(false).project;
    const before=content(ext,1),after=content(ext,2),name="source."+ext;
    expect(SERVER_SOURCE_PARSE_EXTENSIONS).toContain(ext);
    const mimeType=ext==="svg"?"image/svg+xml":"text/plain";
    const blob=new Blob([before],{type:mimeType});blobs.set("raw",blob);
    const source=await parseServerSource({artifactId:"source",name,mimeType,size:blob.size,role:"target",blob,storageRef:"raw"});
    expect(source.parseStatus).toBe("ready");expect(source.artifactDescriptor?.capabilities.materialize).toBe(true);
    project.sourceArtifacts=[source];project.searchChampion=undefined;rubric(project,source.id);
    const planned=CandidateSchema.parse({id:"new-candidate",name:"Actual changed text",change:"change revision only"});
    const contexts=await buildServerCandidateTargetContext(project,planned,async()=>before);
    expect(contexts[0]?.content).toBe(before);
    const candidate=await materializeServerCandidateArtifacts(project,planned,[{sourceArtifactId:source.id,name,mimeType,content:after}],"Real text bytes");
    const snapshot=candidate.artifactSnapshots[0]!;
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
    expect(await blobs.get(snapshot.frozenArtifact!.blobId)!.text()).toBe(after);
    const original=await runServerCurrentStoredEvidence({project,testCase:formatCase()});
    expect(original.verificationStatus,original.output).toBe("verified");
    const runs=await executeServerExperimentCandidate(project,candidate,{
      executeSemanticBatch:async()=>{throw Error("format proof must not call AI");},judge:async()=>{throw Error("not judging");},
      verifyFrozenArtifact:verifyServerCandidateFrozenArtifact,verifyNativeFormat:verifyServerCandidateNativeFormats,
    },[formatCase()]);
    expect(runs[0]?.verificationStatus,runs[0]?.output).toBe("verified");
    const staticCase={...formatCase(),executionMode:"static-evidence" as const,evidenceScope:"implementation" as const};
    const staticRun=await runServerFrozenArtifactStaticEvidence({project,candidate,testCase:staticCase});
    expect(staticRun.verificationStatus,staticRun.output).toBe("verified");
    expect(staticRun.output).toContain(after.trim());
    const behavior=await runServerCurrentStoredEvidence({project,testCase:{...formatCase(),evidenceScope:"product-behavior"}});
    expect(behavior.verificationStatus).toBe("unverified");
    const tampered=new Blob([after.replace("2","3")],{type:mimeType});
    blobs.set(snapshot.frozenArtifact!.blobId,tampered);
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(false);
  });
});

describe("legacy and OpenDocument spreadsheet native evidence",()=>{
  it.each(["xls","ods"] as const)("%s upload preserves coordinates, cells and exact frozen bytes",async ext=>{
    const project=acceptedPackageFixture(false).project;
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([["Code","Value"],["000123",5],["000124",9]]),"Sales");
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([["Protected"],["unchanged"]]),"Notes");
    const blob=new Blob([XLSX.write(workbook,{type:"array",bookType:ext})],{type:"application/octet-stream"});
    blobs.set("raw",blob);
    const source=await parseServerSource({artifactId:"sheet",name:"data."+ext,mimeType:blob.type,size:blob.size,role:"target",blob,storageRef:"raw"});
    expect(source.parseStatus,source.warnings.join(";")).toBe("ready");
    project.sourceArtifacts=[source];project.searchChampion=undefined;rubric(project,source.id);
    const planned=CandidateSchema.parse({id:"sheet-change",name:"Sheet change",change:"B2 becomes 15"});
    const contexts=await buildServerCandidateTargetContext(project,planned,async()=>{throw Error("native context required");});
    expect(contexts[0]?.structuredContext).toMatchObject({kind:"spreadsheet"});
    const candidate=await materializeServerCandidateArtifacts(project,planned,[{sourceArtifactId:source.id,name:source.name,mimeType:source.mimeType,
      content:JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sales",cells:[{address:"B2",value:15}]}]})}],"Real native workbook");
    const frozen=candidate.artifactSnapshots[0]!.frozenArtifact!;
    const bytes=await blobs.get(frozen.blobId)!.arrayBuffer();
    const reopened=XLSX.read(bytes,{type:"array"});
    expect(reopened.Sheets.Sales!.B2.v).toBe(15);expect(reopened.Sheets.Sales!.A2.v).toBe("000123");
    expect(reopened.Sheets.Notes!.A2.v).toBe("unchanged");
    const runs=await executeServerExperimentCandidate(project,candidate,{executeSemanticBatch:async()=>({results:[]}),judge:async()=>({} as never),
      verifyFrozenArtifact:verifyServerCandidateFrozenArtifact,verifyNativeFormat:verifyServerCandidateNativeFormats},[formatCase()]);
    expect(runs[0]?.verificationStatus,runs[0]?.output).toBe("verified");
  });
});
