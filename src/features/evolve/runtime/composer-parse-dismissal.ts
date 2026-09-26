import {z} from "zod";

const KEY="evolve-studio:composer-dismissed-parse:v1";
const PARSE_SESSION_KEY="evolve-studio:composer-parse-session:v1";
const MAX_DISMISSED=200;
let memorySessionId:string|undefined;
const memoryDismissals=new Map<string,Set<string>>();
const SessionIdSchema=z.string().min(1).max(200);
const StoredDismissalsSchema=z.object({
  sessionId:SessionIdSchema,
  artifactIds:z.array(z.string().min(1).max(200)).max(MAX_DISMISSED),
}).strict();

function browserSessionStorage():Storage|undefined{
  try{return typeof window==="undefined"?undefined:window.sessionStorage;}
  catch{return undefined;}
}

export function composerParseSessionId(storage:Storage|undefined=browserSessionStorage()){
  const created=`composer-${crypto.randomUUID()}`;
  try{
    const existing=storage?.getItem(PARSE_SESSION_KEY);
    if(SessionIdSchema.safeParse(existing).success)return existing!;
    storage?.setItem(PARSE_SESSION_KEY,created);
    if(storage)return created;
  }catch{/* Browser storage can be unavailable. */}
  return memorySessionId??=created;
}

export function clearComposerParseSessionId(storage:Storage|undefined=browserSessionStorage()){
  memorySessionId=undefined;
  try{storage?.removeItem(PARSE_SESSION_KEY);}catch{/* Browser storage can be unavailable. */}
}

export function readDismissedParseArtifacts(sessionId:string,storage:Storage|undefined=browserSessionStorage()){
  try{
    const raw=storage?.getItem(KEY);
    if(!raw)return new Set(memoryDismissals.get(sessionId));
    const parsed=StoredDismissalsSchema.safeParse(JSON.parse(raw));
    return parsed.success&&parsed.data.sessionId===sessionId
      ?new Set([...parsed.data.artifactIds,...(memoryDismissals.get(sessionId)??[])]):new Set(memoryDismissals.get(sessionId));
  }catch{return new Set(memoryDismissals.get(sessionId));}
}

export function dismissParseArtifact(sessionId:string,artifactId:string,storage:Storage|undefined=browserSessionStorage()){
  const ids=readDismissedParseArtifacts(sessionId,storage);
  ids.add(artifactId);
  const bounded=[...ids].slice(-MAX_DISMISSED);
  memoryDismissals.set(sessionId,new Set(bounded));
  try{storage?.setItem(KEY,JSON.stringify(StoredDismissalsSchema.parse({sessionId,artifactIds:bounded})));}
  catch{/* The current tab still tracks dismissal in memory. */}
  return new Set(bounded);
}

export function clearDismissedParseArtifacts(storage:Storage|undefined=browserSessionStorage()){
  memoryDismissals.clear();
  try{storage?.removeItem(KEY);}catch{/* Private browsing can deny session storage. */}
}
