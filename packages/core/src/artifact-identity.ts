import type {ArtifactAcceptance,Candidate,EvolveProject,FrozenArtifact} from "@evolution/contracts";
import {indexUniqueById} from "./identity-index";
import {hasSourceTextArtifactFileFormat} from "./artifact-file-format";

function sameFrozenIdentity(left:FrozenArtifact,right:FrozenArtifact){
  return left.sourceArtifactId===right.sourceArtifactId
    &&left.snapshotHash===right.snapshotHash
    &&left.blobId===right.blobId
    &&left.sha256===right.sha256
    &&left.size===right.size
    &&left.name===right.name
    &&left.mimeType===right.mimeType;
}

/** A passed Gate F must cover every target exactly once before any output is marked deliverable. */
export function hasExactFrozenArtifactSet(project:EvolveProject,candidate:Candidate,acceptance:ArtifactAcceptance){
  const targetIds=project.sourceArtifacts.filter((source)=>source.role==="target").map((source)=>source.id);
  const snapshots=candidate.artifactSnapshots;
  const frozen=acceptance.frozenArtifacts??[];
  const targetsById=indexUniqueById(targetIds,(id)=>id);
  const snapshotsById=indexUniqueById(snapshots,(item)=>item.sourceArtifactId);
  const frozenById=indexUniqueById(frozen,(item)=>item.sourceArtifactId);
  return targetIds.length>0
    &&targetsById.duplicateIds.size===0
    &&snapshotsById.duplicateIds.size===0
    &&frozenById.duplicateIds.size===0
    &&snapshots.length===targetIds.length
    &&frozen.length===targetIds.length
    &&targetIds.every((id)=>{
      const snapshot=snapshotsById.byId.get(id);
      const receipt=frozenById.byId.get(id);
      const source=project.sourceArtifacts.find((item)=>item.id===id)!;
      return Boolean(snapshot&&receipt
        &&hasSourceTextArtifactFileFormat(source,snapshot.name)
        &&hasSourceTextArtifactFileFormat(source,receipt.name)
        &&(!snapshot.frozenArtifact||sameFrozenIdentity(snapshot.frozenArtifact,receipt)));
    });
}