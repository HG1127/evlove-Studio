import {Blob as NodeBlob} from "node:buffer";
import {describe,expect,it,vi} from "vitest";
import {SourceArtifactSchema,type CandidateArtifactSnapshot} from "@evolution/contracts";
import {describeArtifact} from "@evolution/core";
import {buildDownloadBlob,verifyGeneratedArtifact} from "./artifact-output-builders";

describe("single file browser materialization",()=>{
  it.each([
    ["ts","export const answer = 2;"],["py","answer = 2\n"],["css","body { color: blue; }"],
    ["jsonl",'{"answer":2}\n'],["toml","answer = 2\n"],["yaml","answer: 2\n"],
    ["xml","<answer>2</answer>"],["svg",'<svg xmlns="http://www.w3.org/2000/svg"><text>2</text></svg>'],
  ])("%s retains its extension and exact text instead of requiring ZIP",async(extension,content)=>{
    vi.stubGlobal("Blob",NodeBlob);
    try{
      const source=SourceArtifactSchema.parse({id:"source",name:"input."+extension,extension,
        role:"target",artifactKind:["ts","py","css"].includes(extension)?"codebase":"generic",
        mimeType:"text/plain",size:12,inputMode:"paste",parseStatus:"ready",textContent:"original",createdAt:new Date().toISOString()});
      source.artifactDescriptor=describeArtifact(source);
      const snapshot={sourceArtifactId:source.id,content,mimeType:source.mimeType} as CandidateArtifactSnapshot;
      const output=await buildDownloadBlob(source,snapshot);
      expect(output.name).toBe("input-evolved."+extension);
      expect(await output.blob.text()).toBe(content);
      await expect(verifyGeneratedArtifact(source,snapshot,output.blob)).resolves.toBeDefined();
    }finally{vi.unstubAllGlobals();}
  });
});
