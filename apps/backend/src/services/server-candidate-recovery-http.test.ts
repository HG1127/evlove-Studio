// @vitest-environment node
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {CandidateSchema,SourceArtifactSchema,type EvolveProject} from "@evolution/contracts";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {buildServerExperimentCandidate,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
const {blobs,writes}=vi.hoisted(()=>({blobs:new Map<string,Blob>(),writes:[] as string[]}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id),put:async(id:string,blob:Blob)=>{writes.push(id);blobs.set(id,blob);}})}));
const before='<p id="approval">主管确认退款后才执行。</p>';
const after='<p id="approval">主管确认退款后才执行，并记录审批编号。</p>';
const original='<html><body><p>literal &lt;think&gt; and ```json remain</p>'+"保留所有原文与空白。\r\n".repeat(7000)+before+'</body></html>';
const hash=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
describe("native direct-model Candidate recovery and frozen bytes",()=>{
 it.each(['chat-completions','responses'] as const)("replays one repaired blueprint into the complete parent through %s",async protocol=>{
  blobs.clear();writes.length=0;
  const source=SourceArtifactSchema.parse({id:"synthetic-source",name:"synthetic.html",extension:"html",mimeType:"text/html",artifactKind:"document",role:"target",inputMode:"upload",size:Buffer.byteLength(original),textContent:"STALE INDEX",createdAt:"2026-10-09T00:00:00Z"});
  const candidate=CandidateSchema.parse({id:"synthetic-candidate",name:"记录编号",change:"记录退款审批编号",designRationale:{sourceEvidence:[before]}});
  const project={id:"synthetic-mission",name:"Synthetic only",version:"V1",sourceArtifacts:[source],protectedItems:[],editableItems:[],acceptanceRubric:[],goal:"保留全文，增加审批编号",evolutionCommand:"增加审批编号"} as unknown as EvolveProject;
  blobs.set(source.id,new Blob([original],{type:source.mimeType}));
  const requests:string[]=[];const errors:string[]=[];const key="fictional-native-construction-key";
  const server=createServer(async(req,res)=>{
   try{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(req.headers.authorization).toBe("Bearer "+key);expect(body.model).toBe("x");expect(req.url).toBe(protocol==='responses'?'/v1/responses':'/v1/chat/completions');
    const content=protocol==='responses'?body.input[1].content[0].text:body.messages[1].content;const payload=JSON.parse(content);
    expect(payload.project.currentTargets[0].content).toContain(before);expect(payload.project.currentTargets[0].content).not.toContain("STALE INDEX");expect(payload.project.currentTargets[0].mutationMode).toBe("text-edits");
    const anchor=payload.project.currentTargets[0].verifiedAnchors[0];expect(original.slice(anchor.start,anchor.end)).toBe(anchor.text);
    if(requests.length){expect(writes).toEqual([]);expect(payload.recovery.attempt).toBe(1);expect(payload.recovery.candidateId).toBe(candidate.id);expect(payload.recovery.failure.code).toBe("text-edits");expect(payload.recovery.parentFingerprint).toMatch(/^[a-f0-9]{64}$/);expect(payload.recovery.generation).toMatch(/^[a-f0-9]{64}$/);}else expect(payload.recovery).toBeUndefined();
    const output={summary:"Synthetic repair",artifacts:[{sourceArtifactId:source.id,name:"synthetic-evolved.html",mimeType:source.mimeType,content:JSON.stringify({kind:"text-edits",edits:[{before:requests.length?before:"invented anchor",after}]}),notes:[]}]};
    requests.push(req.url!);const final='<think>Intermediate synthetic reasoning.</think>\n```json\n'+JSON.stringify(output)+'\n```';res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(protocol==='responses'?{status:"completed",output_text:final}:{choices:[{finish_reason:"stop",message:{content:final}}]}));
   }catch(error){errors.push(String(error));res.writeHead(500);res.end('{"error":{"message":"Synthetic fixture assertion failed"}}');}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw new Error('Invalid listener');
  try{
   const built=await withExplicitServerAiConnection({connectionId:"synthetic",label:"Synthetic",apiKey:key,model:"x",baseUrl:`http://127.0.0.1:${address.port}/v1`,protocol,responseFormat:"json-object"},()=>buildServerExperimentCandidate(project,candidate));
   const snapshot=built.artifactSnapshots[0]!;const expected=original.replace(before,after);expect(snapshot.content).toBe(expected);expect(hash(snapshot.content)).not.toBe(hash(original));expect(snapshot.frozenArtifact!.sha256).toBe(hash(expected));expect(await blobs.get(snapshot.frozenArtifact!.blobId)!.text()).toBe(expected);expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);expect(requests).toHaveLength(2);expect(writes).toHaveLength(1);expect(errors).toEqual([]);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 });
});
