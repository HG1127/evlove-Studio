import {createHash} from 'node:crypto';import {z} from 'zod';import {ArtifactOutcomeStudySchema,ArtifactTaskRecordBatchSchema,ArtifactOutcomeCollectionSchema,type EvolveProject,type ArtifactOutcomeStudy} from '@evolution/contracts';import {assertArtifactOutcomeStudyBinding,artifactStudyFingerprint,assessArtifactTaskBenefit} from '@evolution/core';import {artifactTaskTelemetrySamples} from '@evolution/adapters/outcome-telemetry';
import {getServerArtifactStore} from './artifact-runtime';import {getServerProductionRuntime} from './production-runtime';import {insertOutcomeSamples,readOutcomeSamples,OutcomeSampleIdConflictError} from './outcome-sample-store';
const sourceSchema=z.object({study:ArtifactOutcomeStudySchema,urlTemplate:z.string().max(2000),authEnv:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,119}$/).optional(),timeoutMs:z.number().int().min(500).max(30000).default(10000)}).strict();
function sourceFor(missionId:string,studyId:string){
 const raw=process.env.EVOLUTION_ARTIFACT_OUTCOME_STUDIES_JSON;if(!raw)throw Error('No native artifact outcome study is configured');
 const sources=z.array(sourceSchema).min(1).max(20).parse(JSON.parse(raw));if(new Set(sources.map(x=>x.study.id)).size!==sources.length)throw Error('Artifact study configuration has duplicated identities');
 const source=sources.find(s=>s.study.id===studyId&&s.study.missionId===missionId);if(!source)throw Error('Artifact study is not configured for this Mission');
 const tokens=[...source.urlTemplate.matchAll(/\{([^{}]+)\}/g)].map(m=>m[1]);if(!tokens.includes('arm')||tokens.some(x=>!['arm','missionId','studyId'].includes(x!)))throw Error('Artifact task source must isolate arms and use supported URL tokens');
 const probe=new URL(source.urlTemplate.replace(/\{[^{}]+\}/g,'probe'));if(probe.protocol!=='https:'||probe.username||probe.password||probe.hash)throw Error('Artifact task source must be an authenticated HTTPS endpoint without inline credentials');
 if(source.authEnv&&!process.env[source.authEnv]?.trim())throw Error('Artifact task source credential is unavailable');return source;
}
async function checkedMission(study:ArtifactOutcomeStudy){
 const project=await getServerProductionRuntime().missions.get(study.missionId);if(!project)throw Error('Artifact outcome Mission is unavailable');assertArtifactOutcomeStudyBinding(project,study,Date.now());
 await verifyArtifactOutcomeCustody(project,study);return project;
}
/** Validate exact original and accepted bytes through this workspace's private store before ingest or analysis. */
export async function verifyArtifactOutcomeCustody(project:EvolveProject,study:ArtifactOutcomeStudy){
 assertArtifactOutcomeStudyBinding(project,study,Date.now());const store=getServerArtifactStore();
 for(const ref of [...study.originalArtifacts,...study.candidateArtifacts]){const blob=await store.get(ref.blobId);if(!blob||blob.size!==ref.sizeBytes)throw Error('Artifact outcome source bytes are missing or incomplete');
  if(createHash('sha256').update(new Uint8Array(await blob.arrayBuffer())).digest('hex')!==ref.sha256)throw Error('Artifact outcome source bytes changed');
 }
}
async function readTaskSource(url:string,headers:Record<string,string>,timeoutMs:number){
 for(let attempt=0;attempt<2;attempt++){let completeBody=false;try{
  const response=await fetch(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  if(response.status!==200){await response.body?.cancel();if(attempt===0&&(response.status===429||response.status>=500))continue;throw Error('Artifact task source rejected the read');}
  const maximum=5*1024*1024;if(Number(response.headers.get('content-length'))>maximum){await response.body?.cancel();throw Error('Artifact task source exceeds the complete response boundary');}
  const reader=response.body?.getReader();if(!reader)throw Error('Artifact task source body is missing');const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum)throw Error('Artifact task source exceeds the complete response boundary');chunks.push(part.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  completeBody=true;return ArtifactTaskRecordBatchSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))).records;
 }catch(error){if(!completeBody&&attempt===0&&(error instanceof TypeError||(error as Error).name==='TimeoutError'))continue;throw error;}}
 throw Error('Artifact task source is unavailable');
}
export async function collectArtifactTaskOutcomes(input:{missionId:string;studyId:string}){
 const source=sourceFor(input.missionId,input.studyId),study=source.study;await checkedMission(study);
 const arms=['stable','candidate'] as const;const results=await Promise.allSettled(arms.map(async arm=>{
  const values={arm,missionId:study.missionId,studyId:study.id},url=source.urlTemplate.replace(/\{(arm|missionId|studyId)\}/g,(_,key:keyof typeof values)=>encodeURIComponent(values[key]));
  const headers:Record<string,string>={Accept:'application/json'};if(source.authEnv)headers.Authorization='Bearer '+process.env[source.authEnv]!.trim();
  const records=await readTaskSource(url,headers,source.timeoutMs);return {arm,samples:artifactTaskTelemetrySamples(study,arm,records,Date.now())};
 }));
 if(results.some(r=>r.status==='rejected'))throw Error('Complete artifact task sources are unavailable or conflict with the frozen study; no samples inserted');
 const samples=results.flatMap(r=>r.status==='fulfilled'?r.value.samples:[]);if(!samples.length)return ArtifactOutcomeCollectionSchema.parse({schemaVersion:'artifact-outcome-collection-v1',...input,studyFingerprint:artifactStudyFingerprint(study),reportedTasks:0,insertedMetricSamples:0,establishesRealUserBenefit:false});
 let result;
 try{result=await insertOutcomeSamples({missionId:study.missionId,candidateId:study.candidateId,samples});}
 catch(error){
  if(error instanceof OutcomeSampleIdConflictError){
   // Retain contradictory source reports as conflicting observations. Never silently select the first/best report.
   await insertOutcomeSamples({missionId:study.missionId,candidateId:study.candidateId,samples:samples.map(sample=>({...sample,id:sample.id+'-conflict-'+createHash('sha256').update(JSON.stringify(sample)).digest('hex')}))});
  }throw error;
 }
 return ArtifactOutcomeCollectionSchema.parse({schemaVersion:'artifact-outcome-collection-v1',...input,studyFingerprint:artifactStudyFingerprint(study),reportedTasks:samples.length/3,insertedMetricSamples:result.inserted,establishesRealUserBenefit:false});
}
export async function analyzeArtifactTaskOutcomes(input:{missionId:string;studyId:string}){
 const study=sourceFor(input.missionId,input.studyId).study;await checkedMission(study);const samples=await readOutcomeSamples({missionId:study.missionId,candidateId:study.candidateId,limit:20000,requireComplete:true});
 return assessArtifactTaskBenefit({study,samples,checkedAt:new Date().toISOString(),artifactCustodyVerified:true});
}
