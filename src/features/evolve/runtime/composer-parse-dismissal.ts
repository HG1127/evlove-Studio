import {z} from "zod";

const KEY="evolve-studio:composer-dismissed-parse:v1";
const MAX_DISMISSED=200;
const StoredDismissalsSchema=z.object({
  sessionId:z.string().min(1).max(200),
  artifactIds:z.array(z.string().min(1).max(200)).max(MAX_DISMISSED),
}).strict();

export function readDismissedParseArtifacts(sessionId:string,storage:Storage=window.sessionStorage){
  try{
    const raw=storage.getItem(KEY);
    if(!raw)return new Set<string>();
    const parsed=StoredDismissalsSchema.safeParse(JSON.parse(raw));
    return parsed.success&&parsed.data.sessionId===sessionId
      ?new Set(parsed.data.artifactIds):new Set<string>();
  }catch{return new Set<string>();}
}

export function dismissParseArtifact(sessionId:string,artifactId:string,storage:Storage=window.sessionStorage){
  const ids=readDismissedParseArtifacts(sessionId,storage);
  ids.add(artifactId);
  const bounded=[...ids].slice(-MAX_DISMISSED);
  try{storage.setItem(KEY,JSON.stringify(StoredDismissalsSchema.parse({sessionId,artifactIds:bounded})));}
  catch{/* The current tab still tracks dismissal in memory. */}
  return new Set(bounded);
}

export function clearDismissedParseArtifacts(storage:Storage=window.sessionStorage){
  try{storage.removeItem(KEY);}catch{/* Private browsing can deny session storage. */}
}
