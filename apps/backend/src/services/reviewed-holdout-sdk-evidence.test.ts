// @vitest-environment node
import {afterEach,expect,it,vi} from "vitest";
import {importKey} from "@workflow/core/encryption";
import {dehydrateStepArguments,dehydrateStepReturnValue} from "@workflow/core/serialization";
import {reviewedHoldoutFixture} from "@evolution/testkit";
import {ReviewedHoldoutRunInputSchema} from "@evolution/contracts";
import {reviewedBinding} from "./reviewed-holdout-identity";
import {readReviewedSdkEvidence,assertReviewedSdkEvidence,REVIEWED_WORKFLOW_ID,REVIEWED_EXECUTE_STEP_ID} from "./reviewed-holdout-sdk-evidence";
const live=vi.hoisted(()=>({world:vi.fn()}));
vi.mock("workflow/runtime",()=>({getWorld:live.world}));
afterEach(()=>vi.clearAllMocks());
function fixture(){
 const p=reviewedHoldoutFixture().project,input=ReviewedHoldoutRunInputSchema.parse({missionId:p.id,controlJobId:"old-job",controlOwnerKey:"key",requestedAt:p.updatedAt,approval:{schemaVersion:"reviewed-holdout-approval-v1",request:{binding:reviewedBinding(p,"a".repeat(64),"b".repeat(64),"old-route"),idempotencyKey:"old",humanReviewNote:"Human confirms exact Original REVIEW",preserveReview:true,preserveAcceptanceGates:true},actorId:"operator",actorSource:"browser-session",confirmedAt:p.updatedAt}});
 const step={runId:"old-run",stepId:"step-private",stepName:REVIEWED_EXECUTE_STEP_ID,status:"completed",attempt:1};
 const output={result:{missionId:p.id,controlJobId:"old-job",status:"waiting-human",iterations:1,reason:"Retain failed result"}};
 const r={run:vi.fn(async()=>({runId:"old-run",workflowName:REVIEWED_WORKFLOW_ID,deploymentId:"old-deployment",status:"completed"})),page:vi.fn(async()=>({data:[step],hasMore:false,cursor:null})),step:vi.fn(async()=>({...step,input:[input],output}))};return {r,step,input,output};
}
it("reads complete private World observations and validates the exact completed first step",async()=>{
 const {r,input}=fixture();expect(await readReviewedSdkEvidence("old-run",r)).toMatchObject({runId:"old-run",stepId:"step-private",input});expect(r.step).toHaveBeenCalledWith("old-run","step-private");
});
it.each(["pending","running","failed","cancelled"])("rejects old Run status %s",async status=>{const {r}=fixture();r.run.mockResolvedValueOnce({runId:"old-run",workflowName:REVIEWED_WORKFLOW_ID,deploymentId:"old-deployment",status});await expect(readReviewedSdkEvidence("old-run",r)).rejects.toThrow();expect(r.step).not.toHaveBeenCalled();});
it.each(["attempt","status","missing","duplicate","gate-f","wrong-run","workflow","output","continuation","input-output"])("rejects private evidence mismatch %s",async kind=>{
 const {r,step,input,output}=fixture();
 if(kind==="attempt")step.attempt=2;if(kind==="status")step.status="running";
 if(kind==="missing")r.page.mockResolvedValueOnce({data:[],hasMore:false,cursor:null});
 if(kind==="duplicate")r.page.mockResolvedValueOnce({data:[step,{...step,stepId:"second"}],hasMore:false,cursor:null});
 if(kind==="gate-f")r.page.mockResolvedValueOnce({data:[step,{...step,stepId:"gate",stepName:"step//./workflows/evolution-reviewed-holdout/steps//acceptReviewedHoldoutStep"}],hasMore:false,cursor:null});
 if(kind==="wrong-run")step.runId="other";
 if(kind==="workflow")r.run.mockResolvedValueOnce({runId:"old-run",workflowName:"ordinary",deploymentId:"old-deployment",status:"completed"});
 if(kind==="output")output.result.status="completed";
 if(kind==="continuation")r.step.mockResolvedValueOnce({...step,input:[input],output:{...output,continuation:{grant:true}}} as never);
 if(kind==="input-output")output.result.controlJobId="other";
 await expect(readReviewedSdkEvidence("old-run",r)).rejects.toThrow();
});
it("reads all metadata pages before selecting the one execution",async()=>{const {r,step}=fixture();r.page.mockResolvedValueOnce({data:[],hasMore:true,cursor:"next"} as never).mockResolvedValueOnce({data:[step],hasMore:false,cursor:null});expect((await readReviewedSdkEvidence("old-run",r)).stepId).toBe(step.stepId);expect(r.page).toHaveBeenNthCalledWith(2,"old-run","next");});
it("rejects incomplete or cycling pages rather than treating them as absence",async()=>{const {r}=fixture();r.page.mockResolvedValue({data:[],hasMore:true,cursor:"same"} as never);await expect(readReviewedSdkEvidence("old-run",r)).rejects.toThrow();expect(r.step).not.toHaveBeenCalled();});

it("requires a minted receipt even for objects whose JSON serialization is undefined",()=>{const forged=Object.assign(()=>undefined,{input:{},output:{}});expect(()=>assertReviewedSdkEvidence(forged as never)).toThrow("私有 SDK 证据");expect(()=>assertReviewedSdkEvidence({toJSON:()=>undefined} as never)).toThrow("私有 SDK 证据");});

it("decodes SDK-encrypted private step I/O using only a backend key bound to the original Run deployment",async()=>{
 const {step,input,output}=fixture(),rawKey=new Uint8Array(32).fill(9),key=await importKey(rawKey);
 const encrypted={...step,input:await dehydrateStepArguments([input],step.runId,key),output:await dehydrateStepReturnValue(output,step.runId,key)};
 const getKey=vi.fn(async()=>rawKey);live.world.mockReturnValue({runs:{get:async()=>({runId:step.runId,workflowName:REVIEWED_WORKFLOW_ID,deploymentId:"old-deployment",status:"completed"})},steps:{list:async()=>({data:[step],hasMore:false,cursor:null}),get:async()=>encrypted},getEncryptionKeyForRun:getKey});
 expect(await readReviewedSdkEvidence(step.runId)).toMatchObject({runId:step.runId,input,output});expect(getKey).toHaveBeenCalledExactlyOnceWith(step.runId,{deploymentId:"old-deployment"});
});

it.each(["nonfinal-run","wrong-step","missing-key"])("does not mint private authority for backend decode failure %s",async kind=>{
 const {step,input,output}=fixture(),rawKey=new Uint8Array(32).fill(9),key=await importKey(rawKey),getKey=vi.fn(async()=>rawKey);
 const encrypted={...step,input:await dehydrateStepArguments([input],step.runId,key),output:await dehydrateStepReturnValue(output,step.runId,key)};
 const get=vi.fn(async()=>({...encrypted,...(kind==="wrong-step"?{runId:"other-run"}:{})}));live.world.mockReturnValue({runs:{get:async()=>({runId:step.runId,workflowName:REVIEWED_WORKFLOW_ID,deploymentId:"old-deployment",status:kind==="nonfinal-run"?"running":"completed"})},steps:{list:async()=>({data:[step],hasMore:false,cursor:null}),get},...(kind==="missing-key"?{}:{getEncryptionKeyForRun:getKey})});
 await expect(readReviewedSdkEvidence(step.runId)).rejects.toThrow("无法核验");expect(getKey).not.toHaveBeenCalled();if(kind==="nonfinal-run")expect(get).not.toHaveBeenCalled();
});
