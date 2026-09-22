import {createHash} from "node:crypto";
import JSZip from "jszip";
import {
  SourceArtifactSchema,
  type ArtifactStorePort,
  type EvolveProject,
  type GitRepositoryBinding,
  type GitTargetActionResponse,
} from "@evolution/contracts";
import {downloadExactGitRepositoryArchive,executeGitTargetAction} from "./github-target";
import {getServerArtifactStore} from "./artifact-runtime";
import {parseServerSource} from "./server-source-parser";

const MAX_FILES=5_000;
const MAX_UNCOMPRESSED_BYTES=120*1024*1024;
const MAX_NORMALIZED_ZIP_BYTES=25*1024*1024;
const FIXED_ZIP_DATE=new Date("2000-01-01T00:00:00.000Z");

type SnapshotExecutor=(input:{
  action:"snapshot";
  repository:GitRepositoryBinding;
  missionId:string;
})=>Promise<GitTargetActionResponse>;

type MaterializePorts={
  download:(repository:GitRepositoryBinding,commitSha:string)=>Promise<Uint8Array>;
  artifacts:ArtifactStorePort;
  parse:typeof parseServerSource;
};

function repoKey(repository:GitRepositoryBinding){
  return repository.owner+"/"+repository.repo;
}

function cleanPath(value:string){
  const clean=value.replace(/\\/g,"/").replace(/^\/+|\/+$/g,"");
  if(!clean)return "";
  const parts=clean.split("/");
  if(parts.some((part)=>!part||part==="."||part===".."||part.includes(":")||[...part].some((char)=>char.charCodeAt(0)<32))){
    throw new Error("Unsafe Git archive path: "+value);
  }
  return parts.join("/");
}

export function gitSnapshotArtifactId(repository:GitRepositoryBinding,commitSha:string){
  const digest=createHash("sha256")
    .update([repository.owner,repository.repo,repository.pathPrefix??"",commitSha].join("|"))
    .digest("hex")
    .slice(0,24);
  return "git-source-"+digest;
}

export async function normalizeGitRepositoryArchive(raw:Uint8Array,pathPrefix?:string){
  const archive=await JSZip.loadAsync(raw,{checkCRC32:true});
  const files=Object.values(archive.files).filter((entry)=>!entry.dir);
  if(!files.length)throw new Error("Git repository archive is empty");
  if(files.length>MAX_FILES)throw new Error(`Git repository archive exceeds ${MAX_FILES} files`);

  const safeNames=files.map((entry)=>({entry,path:cleanPath(entry.name)}));
  const first=safeNames[0]!.path.split("/")[0]!;
  const commonRoot=safeNames.every(({path})=>path.startsWith(first+"/"))?first:undefined;
  const scope=cleanPath(pathPrefix??"");
  const selected:Array<{path:string;entry:(typeof files)[number]}>= [];
  for(const item of safeNames){
    let relative=commonRoot?item.path.slice(commonRoot.length+1):item.path;
    if(!relative)continue;
    if(scope){
      if(!relative.startsWith(scope+"/"))continue;
      relative=relative.slice(scope.length+1);
    }
    relative=cleanPath(relative);
    if(relative)selected.push({path:relative,entry:item.entry});
  }
  if(!selected.length){
    throw new Error(scope
      ?`Git pathPrefix ${scope} did not match any files in the exact commit archive`
      :"Git repository archive did not contain materializable files");
  }
  selected.sort((a,b)=>a.path.localeCompare(b.path));

  const normalized=new JSZip();
  let uncompressedBytes=0;
  for(const item of selected){
    const bytes=await item.entry.async("uint8array");
    uncompressedBytes+=bytes.byteLength;
    if(uncompressedBytes>MAX_UNCOMPRESSED_BYTES){
      throw new Error("Git repository archive exceeds the 120MB uncompressed materialization limit");
    }
    normalized.file(item.path,bytes,{date:FIXED_ZIP_DATE,createFolders:true});
  }
  const bytes=await normalized.generateAsync({
    type:"uint8array",
    compression:"DEFLATE",
    compressionOptions:{level:6},
    platform:"UNIX",
  });
  if(bytes.byteLength>MAX_NORMALIZED_ZIP_BYTES){
    throw new Error("Normalized Git repository ZIP exceeds the 25MB Artifact Store materialization limit");
  }
  return bytes;
}

export async function lockGitTargetSnapshot(
  project:EvolveProject,
  snapshotExecutor:SnapshotExecutor=(input)=>executeGitTargetAction(input),
){
  if(project.targetConnection.adapter!=="git"||project.targetConnection.status!=="connected")return project;
  if(project.sourceArtifacts.some((artifact)=>artifact.role==="target"))return project;
  if(project.targetConnection.gitSnapshot)return project;
  const repository=project.targetConnection.git;
  if(!repository)throw new Error("Git Target 缺少 repository binding");
  const snapshot=await snapshotExecutor({action:"snapshot",repository,missionId:project.id});
  if(!snapshot.commitSha||!snapshot.treeSha)throw new Error("Git snapshot 缺少 exact commit/tree SHA");
  return{
    ...project,
    targetConnection:{
      ...project.targetConnection,
      gitSnapshot:{
        commitSha:snapshot.commitSha,
        treeSha:snapshot.treeSha,
        artifactId:gitSnapshotArtifactId(repository,snapshot.commitSha),
        observedAt:snapshot.observedAt,
      },
    },
    updatedAt:snapshot.observedAt,
  };
}

function assertNoDerivedTargetState(project:EvolveProject){
  const dirty=project.baselineRun.status!=="idle"
    ||project.experimentRun.status!=="idle"
    ||project.validationRun.status!=="idle"
    ||project.candidates.length>0
    ||Boolean(project.searchChampion)
    ||project.artifactAcceptance.status!=="idle"
    ||project.campaign.currentRound>0
    ||project.outputArtifacts.length>0
    ||project.release.status!=="idle"
    ||project.lessons.length>0
    ||project.roundHistory.length>0;
  if(dirty){
    throw new Error("Git Target 尚未物化 Source，但 Mission 已存在派生实验状态；禁止把新仓库快照静默混入旧证据。");
  }
}

export async function materializeLockedGitTargetSource(
  project:EvolveProject,
  ports:MaterializePorts={
    download:downloadExactGitRepositoryArchive,
    artifacts:getServerArtifactStore(),
    parse:parseServerSource,
  },
){
  if(project.targetConnection.adapter!=="git"||project.targetConnection.status!=="connected")return project;
  if(project.sourceArtifacts.some((artifact)=>artifact.role==="target"))return project;
  assertNoDerivedTargetState(project);
  const repository=project.targetConnection.git;
  const binding=project.targetConnection.gitSnapshot;
  if(!repository)throw new Error("Git Target 缺少 repository binding");
  if(!binding)throw new Error("Git Target 必须先锁定 exact commit snapshot");

  let blob=await ports.artifacts.get(binding.artifactId).catch(()=>undefined);
  if(!blob){
    const raw=await ports.download(repository,binding.commitSha);
    const normalized=await normalizeGitRepositoryArchive(raw,repository.pathPrefix);
    blob=new Blob([Uint8Array.from(normalized).buffer],{type:"application/zip"});
    await ports.artifacts.put(binding.artifactId,blob);
  }

  const sourceName=`${repository.repo}-${binding.commitSha.slice(0,12)}.zip`;
  const parsed=await ports.parse({
    artifactId:binding.artifactId,
    name:sourceName,
    mimeType:"application/zip",
    size:blob.size,
    role:"target",
    blob,
    storageRef:binding.artifactId,
  });
  const structured=parsed.structuredContent&&typeof parsed.structuredContent==="object"&&!Array.isArray(parsed.structuredContent)
    ?parsed.structuredContent as Record<string,unknown>
    :{};
  const source=SourceArtifactSchema.parse({
    ...parsed,
    inputMode:"remote",
    createdAt:binding.observedAt,
    structuredContent:{
      ...structured,
      gitSnapshot:{
        provider:"github",
        repository:repoKey(repository),
        baseBranch:repository.baseBranch,
        pathPrefix:repository.pathPrefix,
        commitSha:binding.commitSha,
        treeSha:binding.treeSha,
      },
    },
    warnings:[
      ...parsed.warnings,
      `Git Source 已锁定 ${repoKey(repository)}@${binding.commitSha}；后续 Workflow 不会跟随移动分支漂移。`,
    ],
  });
  return{
    ...project,
    sourceArtifacts:[...project.sourceArtifacts,source],
    artifactGraph:undefined,
    semanticEvolution:undefined,
    sourceUnderstanding:undefined,
    inputUnderstanding:undefined,
    inputClarifications:[],
    acceptanceRubric:[],
    acceptanceRubricState:{
      ...project.acceptanceRubricState,
      status:"idle" as const,
      summary:"Git exact commit 已物化，需要重新编译 Project-specific Acceptance Rubric",
      version:project.acceptanceRubricState.version+1,
      weightTotal:0,
      uncoveredCriterionIds:[],
      warnings:[],
    },
    evalSuite:[],
    hiddenEvalSuite:[],
    gates:project.gates.map((gate)=>gate.id==="target-ready"
      ?{
        ...gate,
        status:"ready" as const,
        approvedAt:undefined,
        note:"Git exact commit 已物化为新的进化输入，需要基于该 commit 重新确认 Target Ready。",
      }
      :{...gate,status:"pending" as const,approvedAt:undefined,note:undefined}),
    updatedAt:binding.observedAt,
  };
}
