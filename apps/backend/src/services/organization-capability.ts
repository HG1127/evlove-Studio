import {createHash} from "node:crypto";
import {
  OrganizationCapabilityHealthSchema,
  OrganizationCapabilityRecordSchema,
  OrganizationCapabilitySearchRequestSchema,
  OrganizationCapabilitySearchResponseSchema,
  OrganizationCapabilitySyncResponseSchema,
  type EvolveProject,
  type Lesson,
  type OrganizationCapabilityRecord,
  type OrganizationCapabilitySearchRequest,
} from "@evolution/contracts";
import {
  capabilityEmbeddingConfigured,
  getCapabilityEmbeddingConfig,
  getEvolutionWorkspaceId,
  getServerSupabaseConfig,
  organizationCapabilityConfigured,
} from "../server-env";

type JsonRecord=Record<string,unknown>;

async function embedTexts(texts:string[]){
  const config=getCapabilityEmbeddingConfig();
  if(!config||!texts.length)return undefined;
  const response=await fetch(config.baseUrl+"/embeddings",{
    method:"POST",
    headers:{"Content-Type":"application/json",Authorization:"Bearer "+config.apiKey},
    signal:AbortSignal.timeout(config.timeoutMs),
    body:JSON.stringify({
      model:config.model,
      input:texts,
      ...(config.dimensions?{dimensions:config.dimensions}:{}),
    }),
  });
  if(!response.ok){
    const detail=await response.text().catch(()=>"");
    throw new Error("Capability Embedding HTTP "+response.status+": "+detail.slice(0,300));
  }
  const json=await response.json() as {data?:Array<{index?:number;embedding?:unknown}>};
  const rows=[...(json.data??[])].sort((a,b)=>(a.index??0)-(b.index??0));
  if(rows.length!==texts.length)throw new Error("Capability Embedding response count mismatch");
  return rows.map((row,index)=>{
    if(!Array.isArray(row.embedding)||!row.embedding.length||!row.embedding.every((value)=>typeof value==="number"&&Number.isFinite(value))){
      throw new Error("Capability Embedding response invalid at index "+index);
    }
    return row.embedding as number[];
  });
}

function embeddingFromRow(row:JsonRecord){
  const value=row.embedding;
  return Array.isArray(value)&&value.length&&value.every((item)=>typeof item==="number"&&Number.isFinite(item))
    ?value as number[]
    :undefined;
}

function cosine(a:number[]|undefined,b:number[]|undefined){
  if(!a||!b||a.length!==b.length||!a.length)return undefined;
  let dot=0,aa=0,bb=0;
  for(let i=0;i<a.length;i++){
    dot+=a[i]!*b[i]!;
    aa+=a[i]!*a[i]!;
    bb+=b[i]!*b[i]!;
  }
  if(!aa||!bb)return undefined;
  return dot/(Math.sqrt(aa)*Math.sqrt(bb));
}

function normalize(value:string){
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g," ").trim();
}

export function organizationCapabilityKey(lesson:Lesson){
  const identity=normalize([lesson.title,...lesson.trigger,...lesson.method].join("|"));
  return "cap-"+createHash("sha256").update(identity).digest("hex").slice(0,24);
}

function recordId(workspaceId:string,missionId:string,lessonId:string){
  return createHash("sha256").update(workspaceId+"\u0000"+missionId+"\u0000"+lessonId).digest("hex");
}

function searchText(lesson:Lesson){
  return normalize([
    lesson.title,lesson.summary,lesson.effect,lesson.limit,lesson.status,
    ...lesson.trigger,...lesson.method,...lesson.validatedOn,
    lesson.governance?.reason??"",
  ].join(" "));
}

function replicationEvidence(missionId:string,lesson:Lesson,now:string){
  return [{
    missionId,
    lessonId:lesson.id,
    candidateId:lesson.provenance?.candidateId,
    deploymentId:lesson.provenance?.deploymentId,
    validationRunId:lesson.provenance?.validationRunId,
    governanceStatus:lesson.governance?.status,
    outcomeTrend:lesson.governance?.outcomeTrend,
    observedAt:lesson.governance?.observedAt??lesson.provenance?.releaseObservedAt??lesson.provenance?.derivedAt??now,
    validatedOn:lesson.validatedOn,
  }];
}

function counterExamples(missionId:string,lesson:Lesson,now:string){
  const governance=lesson.governance;
  const negative=lesson.status==="anti-pattern"
    ||governance?.status==="degraded"
    ||governance?.status==="revoked"
    ||governance?.status==="superseded";
  if(!negative)return[];
  return [{
    missionId,
    lessonId:lesson.id,
    reason:governance?.reason??lesson.limit??"Observed counter-example",
    observedAt:governance?.observedAt??governance?.updatedAt??now,
    evidenceRefs:[
      ...(lesson.provenance?.artifactSnapshotIds??[]),
      ...(lesson.provenance?.artifactHashes??[]),
    ],
  }];
}

function lessonRow(workspaceId:string,missionId:string,lesson:Lesson,now:string){
  return {
    id:recordId(workspaceId,missionId,lesson.id),
    workspace_id:workspaceId,
    capability_key:organizationCapabilityKey(lesson),
    source_mission_id:missionId,
    lesson_id:lesson.id,
    lesson_status:lesson.status,
    governance_status:lesson.governance?.status??null,
    reusable:lesson.reusable,
    title:lesson.title,
    summary:lesson.summary,
    search_text:searchText(lesson),
    payload:lesson,
    replication_evidence:replicationEvidence(missionId,lesson,now),
    counter_examples:counterExamples(missionId,lesson,now),
    archived:false,
    updated_at:now,
  };
}

function rowRecord(row:JsonRecord):OrganizationCapabilityRecord{
  return OrganizationCapabilityRecordSchema.parse({
    id:row.id,
    workspaceId:row.workspace_id,
    capabilityKey:row.capability_key,
    sourceMissionId:row.source_mission_id,
    lessonId:row.lesson_id,
    lesson:row.payload,
    replicationEvidence:row.replication_evidence??[],
    counterExamples:row.counter_examples??[],
    archived:Boolean(row.archived),
    createdAt:row.created_at,
    updatedAt:row.updated_at,
  });
}

function restClient(){
  const config=getServerSupabaseConfig();
  const root=config.url.replace(/\/+$/,"")+"/rest/v1";
  const headers={
    apikey:config.anonKey,
    Authorization:"Bearer "+config.anonKey,
    "Content-Type":"application/json",
  };
  async function request(path:string,init:RequestInit={}){
    const response=await fetch(root+"/"+path,{...init,headers:{...headers,...(init.headers??{})}});
    if(!response.ok){
      const detail=await response.text().catch(()=>"");
      throw new Error("Organization Capability Supabase HTTP "+response.status+": "+detail.slice(0,500));
    }
    if(response.status===204)return undefined;
    const text=await response.text();
    return text?JSON.parse(text):undefined;
  }
  return {request};
}

export async function getOrganizationCapabilityHealth(){
  const checkedAt=new Date().toISOString();
  const workspaceId=getEvolutionWorkspaceId();
  if(!organizationCapabilityConfigured()){
    return OrganizationCapabilityHealthSchema.parse({
      codeReady:true,configured:false,databaseReady:false,workspaceId,
      matchingMode:"lexical-fuzzy",vectorSearch:false,
      vectorSearchReason:capabilityEmbeddingConfigured()
        ?"Embedding Provider 已配置，但 Registry Data Plane 尚未就绪。"
        :"未配置 EVOLUTION_CAPABILITY_EMBEDDING_MODEL/API KEY；当前使用 lexical/fuzzy。",
      checkedAt,
      message:"Organization Capability Service 代码已就绪；等待 Supabase + EVOLUTION_WORKSPACE_ID 配置。",
    });
  }
  try{
    const {request}=restClient();
    await request("organization_capabilities?select=id&limit=1");
    return OrganizationCapabilityHealthSchema.parse({
      codeReady:true,configured:true,databaseReady:true,workspaceId,
      matchingMode:capabilityEmbeddingConfigured()?"hybrid-vector":"lexical-fuzzy",
      vectorSearch:capabilityEmbeddingConfigured(),
      vectorSearchReason:capabilityEmbeddingConfigured()
        ?"真实 Server Embedding 已配置；搜索使用 cosine + lexical hybrid ranking。"
        :"未配置真实 Embedding Provider；当前使用确定性 lexical/fuzzy matching。",
      checkedAt,
      message:"Organization Capability Registry 已连接；跨 Mission Registry/Replication/Counter-example 可用。",
    });
  }catch(error){
    return OrganizationCapabilityHealthSchema.parse({
      codeReady:true,configured:true,databaseReady:false,workspaceId,
      matchingMode:"lexical-fuzzy",vectorSearch:false,
      vectorSearchReason:"Registry migration 未就绪时不启用 Vector Search。",
      checkedAt,
      message:error instanceof Error?error.message:String(error),
    });
  }
}

export async function syncMissionCapabilities(project:EvolveProject){
  const workspaceId=getEvolutionWorkspaceId();
  if(!organizationCapabilityConfigured()||!workspaceId){
    return OrganizationCapabilitySyncResponseSchema.parse({
      configured:false,workspaceId,missionId:project.id,synced:0,archived:0,
      message:"Capability Registry 未配置；Mission 学习结果仍保留在项目内。",
    });
  }
  const {request}=restClient();
  const now=new Date().toISOString();
  const baseFilter="workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&source_mission_id=eq."+encodeURIComponent(project.id);
  await request("organization_capabilities?"+baseFilter,{
    method:"PATCH",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify({archived:true,updated_at:now}),
  });
  const rows=project.lessons.map((lesson)=>lessonRow(workspaceId,project.id,lesson,now));
  if(rows.length&&capabilityEmbeddingConfigured()){
    try{
      const vectors=await embedTexts(project.lessons.map(searchText));
      const model=getCapabilityEmbeddingConfig()?.model;
      rows.forEach((row,index)=>{
        Object.assign(row,{embedding:vectors?.[index]??null,embedding_model:model??null});
      });
    }catch{
      rows.forEach((row)=>Object.assign(row,{embedding:null,embedding_model:null}));
    }
  }
  if(rows.length){
    await request("organization_capabilities?on_conflict=id",{
      method:"POST",
      headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify(rows),
    });
  }
  return OrganizationCapabilitySyncResponseSchema.parse({
    configured:true,workspaceId,missionId:project.id,synced:rows.length,archived:0,
    message:`已同步 ${rows.length} 条 Mission 学习资产到 Organization Capability Registry。`,
  });
}

function uniqueBy<T>(items:T[],key:(item:T)=>string){
  const seen=new Set<string>();
  return items.filter((item)=>{const id=key(item);if(seen.has(id))return false;seen.add(id);return true;});
}

function scoreRecord(record:OrganizationCapabilityRecord,query:string){
  if(!query)return {score:0.1,matchedTerms:[] as string[]};
  const q=normalize(query);
  const title=normalize(record.lesson.title);
  const body=searchText(record.lesson);
  const terms=uniqueBy(q.split(/[\s,，;；/]+/).filter((item)=>item.length>=2),(item)=>item);
  let score=0;
  const matched:string[]=[];
  if(title===q){score+=5;matched.push(q);}
  else if(title.includes(q)){score+=3;matched.push(q);}
  if(body.includes(q)){score+=2;if(!matched.includes(q))matched.push(q);}
  for(const term of terms){
    if(body.includes(term)){score+=0.5;matched.push(term);}
  }
  if(record.lesson.status==="verified-skill")score+=0.35;
  if(record.lesson.governance?.status==="active")score+=0.25;
  return {score,matchedTerms:uniqueBy(matched,(item)=>item)};
}

export async function searchOrganizationCapabilities(input:OrganizationCapabilitySearchRequest){
  const query=OrganizationCapabilitySearchRequestSchema.parse(input);
  const workspaceId=getEvolutionWorkspaceId();
  if(!organizationCapabilityConfigured()||!workspaceId){
    return OrganizationCapabilitySearchResponseSchema.parse({
      configured:false,workspaceId,matchingMode:"lexical-fuzzy",vectorSearch:false,hits:[],totalRows:0,
      message:"Organization Capability Registry 未配置。",
    });
  }
  const {request}=restClient();
  const rows=await request(
    "organization_capabilities?select=*&workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&archived=eq.false&order=updated_at.desc&limit=500",
  ) as JsonRecord[];
  let queryEmbedding:number[]|undefined;
  let vectorSearch=false;
  if(query.q&&capabilityEmbeddingConfigured()){
    try{
      queryEmbedding=(await embedTexts([query.q]))?.[0];
      vectorSearch=Boolean(queryEmbedding);
    }catch{
      queryEmbedding=undefined;
      vectorSearch=false;
    }
  }
  const rawById=new Map((rows??[]).map((row)=>[String(row.id),row]));
  const records=(rows??[]).map(rowRecord).filter((record)=>{
    if(query.reusableOnly&&!record.lesson.reusable)return false;
    if(query.statuses?.length&&!query.statuses.includes(record.lesson.status))return false;
    return true;
  });
  const grouped=new Map<string,{
    representative:OrganizationCapabilityRecord;
    score:number;
    lexicalScore:number;
    semanticScore?:number;
    matchedTerms:string[];
    replicationEvidence:OrganizationCapabilityRecord["replicationEvidence"];
    counterExamples:OrganizationCapabilityRecord["counterExamples"];
  }>();
  for(const record of records){
    const ranked=scoreRecord(record,query.q);
    const semantic=vectorSearch?cosine(queryEmbedding,embeddingFromRow(rawById.get(record.id)??{})):undefined;
    const semantic01=semantic===undefined?0:Math.max(0,Math.min(1,(semantic+1)/2));
    const combined=vectorSearch?ranked.score*0.65+semantic01*3.5:ranked.score;
    if(query.q&&combined<=0)continue;
    const existing=grouped.get(record.capabilityKey);
    if(!existing){
      grouped.set(record.capabilityKey,{
        representative:record,score:combined,lexicalScore:ranked.score,semanticScore:semantic,matchedTerms:ranked.matchedTerms,
        replicationEvidence:[...record.replicationEvidence],counterExamples:[...record.counterExamples],
      });
      continue;
    }
    existing.replicationEvidence=uniqueBy(
      [...existing.replicationEvidence,...record.replicationEvidence],
      (item)=>[item.missionId,item.lessonId,item.validationRunId??"",item.observedAt].join("|"),
    );
    existing.counterExamples=uniqueBy(
      [...existing.counterExamples,...record.counterExamples],
      (item)=>[item.missionId,item.lessonId,item.reason,item.observedAt].join("|"),
    );
    existing.matchedTerms=uniqueBy([...existing.matchedTerms,...ranked.matchedTerms],(item)=>item);
    if(combined>existing.score||(combined===existing.score&&record.updatedAt>existing.representative.updatedAt)){
      existing.representative=record;
      existing.score=combined;
      existing.lexicalScore=ranked.score;
      existing.semanticScore=semantic;
    }
  }
  const hits=[...grouped.entries()].map(([capabilityKey,value])=>({capabilityKey,...value}))
    .sort((a,b)=>b.score-a.score||b.representative.updatedAt.localeCompare(a.representative.updatedAt))
    .slice(0,query.limit);
  return OrganizationCapabilitySearchResponseSchema.parse({
    configured:true,workspaceId,matchingMode:vectorSearch?"hybrid-vector":"lexical-fuzzy",vectorSearch,hits,totalRows:records.length,
    message:vectorSearch
      ?`命中 ${hits.length} 个 Capability Group；使用真实 embedding cosine + lexical hybrid ranking。`
      :`命中 ${hits.length} 个 Capability Group；当前使用可审计 lexical/fuzzy matching。`,
  });
}
