import {expect,it} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {missionBlobReferences} from "./mission-blob-references";
it("covers source, champion, holdout, versions, archive and accepted output byte references without prose ids",()=>{
  const frozen=(blobId:string)=>({frozenArtifact:{blobId}});
  const candidate=(id:string)=>({artifactSnapshots:[frozen(id)]});
  const project={
    sourceArtifacts:[{id:"source-original"},{id:"source-model-id",storageRef:"actual-upload"}],
    candidates:[candidate("candidate-byte")],evolutionArchive:[{candidate:candidate("archived-byte")}],
    searchChampion:{candidate:candidate("champion-byte"),artifactAcceptance:{frozenArtifacts:[{blobId:"accepted-byte"}]},validation:{runs:[],baselineRuns:[],versionSnapshot:{artifacts:[frozen("champion-version")]}}},
    artifactAcceptance:{frozenArtifacts:[{blobId:"accepted-byte"}]},versions:[{artifacts:[frozen("version-byte")]}],
    validationRun:{runs:[{visualEvidenceRefs:[{blobId:"screenshot-byte"}]}],baselineRuns:[]},
    baselineRun:{runs:[]},experimentRun:{candidateResults:[{artifactSnapshots:[frozen("experiment-byte")],runs:[]}]},
    outputArtifacts:[{...frozen("accepted-byte"),renderedArtifactRef:"rendered-byte",content:"{\"blobId\":\"not-a-file\"}"}],archivedOutputs:[frozen("old-output")],
  } as unknown as EvolveProject;
  expect(missionBlobReferences(project).sort()).toEqual(["source-original","actual-upload","candidate-byte","archived-byte","champion-byte","accepted-byte","version-byte","champion-version","screenshot-byte","experiment-byte","rendered-byte","old-output"].sort());
});
