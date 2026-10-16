import type {HtmlProtectionProofBinding,HtmlProtectionObligation,HtmlProtectionEvidence} from "@evolution/contracts";
import {assembleHtmlProtectionProof} from "./html-protection-proof-assembly";
import {HTML_PROTECTION_AUTHORITY_POLICY,createHtmlProtectionAuthority,bindHtmlProtectionAuthorities,htmlProtectionCriterionAuthority} from "./html-protection-authority";
import { describe, expect, it } from "vitest";
import { EvolveProjectSchema, HtmlProtectionOperationalScopeSchema } from "@evolution/contracts";
import { confirmHtmlProtectionOperationalScope, confirmedHtmlProtectionOperationalScope, operationalScopeTargetContract,
  assessHtmlProtectionOperationalAcceptance, HTML_PROTECTION_OPERATIONAL_RUNTIME_ID } from "./html-protection-operational-scope";
import { htmlProtectionInventory } from "./html-protection-inventory";
import { htmlProtectionObligationPlan } from "./html-protection-obligation-plan";
import { deriveHtmlProtectionSemanticRequirementScopes } from "./html-protection-static-observations";
import { AcceptanceCriterionSchema, TestCaseSchema, HtmlProtectionSemanticFrozenRequirementsSchema } from "@evolution/contracts";

const at="2026-10-16T08:00:00.000Z", original={sourceArtifactId:"source",sha256:"a".repeat(64),byteLength:100};
function fixture(){
  return EvolveProjectSchema.parse({id:"M",name:"Scoped",objectType:"document",department:"",version:"S0",stage:"target",goal:"Refine configuration",
    protectedItems:["Original structure, methods and interactions"],editableItems:["各章节内的配置细节描述"],metrics:[],
    sourceArtifacts:[{id:"source",name:"original.html",extension:"html",mimeType:"text/html",size:100,role:"target",parseStatus:"ready",createdAt:at,warnings:[]}],
    gates:[{id:"target-ready",label:"Target Ready",status:"approved",approvedAt:at}],problems:[],candidates:[],
    experimentPolicy:{},baselineRun:{id:"B",status:"idle",suiteName:"Visible",totalCases:0,runs:[]},
    experimentRun:{id:"E",status:"idle",candidateResults:[]},validationRun:{id:"H",status:"idle",checks:[],runs:[],baselineRuns:[]},
    release:{status:"idle",trafficPercent:0,kpis:[],history:[]},lessons:[],targetConnection:{adapter:"artifact"},updatedAt:at,
    acceptanceRubricState:{status:"ready",version:1,confirmedAt:at}
  });
}
function confirmed(){const p=fixture();return confirmHtmlProtectionOperationalScope(p,{original,confirmedAt:at,confirmedBy:{actorId:"human",actorSource:"browser-session"},humanReviewNote:"Human confirmed complete finite operational scope"});}
describe("separately confirmed finite protection scope",()=>{
  it("keeps old missions on legacy complete policy and binds the exact target contract",()=>{
    const p=fixture();expect(confirmedHtmlProtectionOperationalScope(p,original)).toBeUndefined();
    const q=confirmed();expect(confirmedHtmlProtectionOperationalScope(q,original)?.policy).toBe("original-finite-operational-v2");
    expect(q.htmlProtectionOperationalScope?.targetContract).toBe(operationalScopeTargetContract(q));
    expect(HtmlProtectionOperationalScopeSchema.safeParse({...q.htmlProtectionOperationalScope,outsideScope:"verified"}).success).toBe(false);
  });
  it.each(["goal","rubric","paper","source","gate","original"] as const)("refuses changed %s after confirmation",kind=>{
    const p=confirmed();let identity=original;
    if(kind==="goal")p.goal+=" altered";
    if(kind==="rubric")p.acceptanceRubric.push(AcceptanceCriterionSchema.parse({id:"new",title:"New",requirement:"Changed"}));
    if(kind==="paper")p.evalSuite.push(TestCaseSchema.parse({id:"new",title:"New",input:"Changed",expected:[]}));
    if(kind==="source")p.sourceArtifacts[0]!.size++;
    if(kind==="gate")p.gates[0]!.status="ready";
    if(kind==="original")identity={...original,sha256:"b".repeat(64)};
    expect(()=>confirmedHtmlProtectionOperationalScope(p,identity)).toThrow();
  });
  it("cannot reinterpret an already executed mission or choose a subset of targets",()=>{
    const p=fixture();p.candidates=[{id:"existing"} as never];expect(()=>confirmHtmlProtectionOperationalScope(p,{original,confirmedAt:at,confirmedBy:{actorId:"human",actorSource:"browser-session"},humanReviewNote:"Human review"})).toThrow();
    const q=fixture();q.sourceArtifacts.push({...q.sourceArtifacts[0]!,id:"another"});expect(()=>confirmHtmlProtectionOperationalScope(q,{original,confirmedAt:at,confirmedBy:{actorId:"human",actorSource:"browser-session"},humanReviewNote:"Human review"})).toThrow();
  });
  it("retains unknowns as unverified while requiring every measured obligation and the native sequence",()=>{
    const p=confirmed(), scope=p.htmlProtectionOperationalScope!;
    const required=[{id:"static",kind:"html-format"},{id:HTML_PROTECTION_OPERATIONAL_RUNTIME_ID,kind:"browser-behavior"},{id:"unknown",kind:"unknown-runtime"}] as never;
    const validation={valid:true,complete:false,passed:false,verificationStatus:"partial",verifiedObligationIds:["static",HTML_PROTECTION_OPERATIONAL_RUNTIME_ID],
      failedObligationIds:[],missingObligationIds:[],unresolvedObligationIds:["unknown"],gaps:["unknown remains"]} as const;
    const result=assessHtmlProtectionOperationalAcceptance({scope,validation,requiredObligations:required});
    expect(result).toMatchObject({passed:true,unverifiedOutsideScopeIds:["unknown"],universalProtectionProved:false});
    expect(validation.complete).toBe(false);
    expect(assessHtmlProtectionOperationalAcceptance({scope,validation:{...validation,verifiedObligationIds:["static"]},requiredObligations:required}).passed).toBe(false);
    expect(assessHtmlProtectionOperationalAcceptance({scope,validation:{...validation,failedObligationIds:["unknown"]},requiredObligations:required}).passed).toBe(false);
    expect(assessHtmlProtectionOperationalAcceptance({scope,validation:{...validation,valid:false},requiredObligations:required}).passed).toBe(false);
  });
  it("derives body permission from the confirmed policy without permitting headings, labels, outside text, attributes or new cards",()=>{
    const originalHtml='<!doctype html><html><head></head><body><p>Outside</p><article class="slide-card" id="one"><h2>Title</h2><p>Method</p><button>Control</button></article></body></html>';
    const p=confirmed(), scope=p.htmlProtectionOperationalScope!;
    const rubric=[AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"Protect",requirement:"Preserve Original methods",hardGate:true,protectedConstraint:true}),
      AcceptanceCriterionSchema.parse({id:"REFINE",title:"Refine",requirement:"各章节内的配置细节描述",hardGate:true,source:"user-command"})];
    const testCase=TestCaseSchema.parse({id:"H",title:"H",input:"Full",expected:[],criterionIds:["PROTECT-ALL"],hidden:true});
    const frozenRequirements=HtmlProtectionSemanticFrozenRequirementsSchema.parse({schemaVersion:"html-protection-semantic-frozen-requirements-v1",missionId:"M",sourceArtifactId:"source",criterionId:"PROTECT-ALL",paperSha256:"1".repeat(64),
      testCase,paper:[testCase],rubric,goal:p.goal,evolutionCommand:"",protectedItems:p.protectedItems,editableItems:p.editableItems,operationalScope:scope});
    const plan=htmlProtectionObligationPlan({originalInventory:htmlProtectionInventory({sourceArtifactId:"source",html:originalHtml}),frozenContentContract:{protectionCriterionId:"PROTECT-ALL",rubric,operationalScope:scope}});
    const run=(executedHtml:string)=>deriveHtmlProtectionSemanticRequirementScopes({plan,frozenRequirements,originalHtml,executedHtml});
    expect(run(originalHtml.replace("Method","Method with configuration detail")).scopes.every(x=>x.verificationStatus==="verified")).toBe(true);
    for(const [from,to] of [["Title","Changed title"],["Control","Changed control"],["Outside","Changed outside"],['id="one"','id="other"'],["</article>","<p>New structure</p></article>"]]){
      expect(run(originalHtml.replace(from!,to!)).scopes.some(x=>x.verificationStatus!=="verified")).toBe(true);
    }
    expect(plan.requiredObligations.filter(x=>x.kind==="unknown-runtime").every(x=>x.support==="unresolved")).toBe(true);
  });
});

describe("private finite-scope authority and unchanged full proof",()=>{
  it.each(["complete","missing-native","observed-failure","copied-token"] as const)("requires private complete measured evidence: %s",kind=>{
    let p=fixture();
    const criterion=AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"Protection",requirement:"Preserve all methods and structure",hardGate:true,protectedConstraint:true,minScore:95,artifactIds:["source"]});
    const test=TestCaseSchema.parse({id:"H",title:"Complete hidden",input:"All Original",expected:["Preserved"],hidden:true,criterionIds:[criterion.id]});
    p.acceptanceRubric=[criterion];p.hiddenEvalSuite=[test];
    p=confirmHtmlProtectionOperationalScope(p,{original,confirmedAt:at,confirmedBy:{actorId:"human",actorSource:"browser-session"},humanReviewNote:"Human confirms the complete measured policy"});
    const binding:HtmlProtectionProofBinding={missionId:p.id,testCaseId:test.id,criterionId:criterion.id,paperSha256:"b".repeat(64),original,executed:original,subject:{kind:"current",versionId:p.version}};
    const required:HtmlProtectionObligation[]=[
      {id:"literal",sourceArtifactId:"source",kind:"html-format",target:"document",description:"Complete source",evidenceKind:"static",support:"supported"},
      {id:HTML_PROTECTION_OPERATIONAL_RUNTIME_ID,sourceArtifactId:"source",kind:"browser-behavior",target:"document",description:"Every registered control, state and native viewport",evidenceKind:"browser",support:kind==="missing-native"?"unresolved":"supported"},
      {id:"outside",sourceArtifactId:"source",kind:"unknown-runtime",target:"document",description:"Unenumerated future sequences",evidenceKind:"browser",support:"unresolved"}];
    const evidence:HtmlProtectionEvidence[]=required.map((item,index)=>({schemaVersion:"html-protection-evidence-v1",id:"E"+index,binding,kind:item.evidenceKind,producer:item.evidenceKind==="static"?"core-static":"browser-runner",
      obligationIds:[item.id],verificationStatus:item.id==="outside"?(kind==="observed-failure"?"failed":"unverified"):item.id===HTML_PROTECTION_OPERATIONAL_RUNTIME_ID&&kind==="missing-native"?"unverified":"verified",observedAt:at}));
    const assembled=assembleHtmlProtectionProof({binding,requiredObligations:required,trustedEvidence:evidence});
    expect(assembled.validation.complete).toBe(false);expect(assembled.validation.passed).toBe(false);
    expect(assembled.proof.receipts.find(row=>row.obligationId==="outside")?.verificationStatus).not.toBe("verified");
    const run={testCaseId:test.id,artifactHash:original.sha256,output:"Actual unit observations",latencyMs:1,cost:0,trace:[],verificationStatus:"verified" as const,htmlProtectionProof:assembled.proof};
    const now=Date.parse(at)+1000;
    const token=createHtmlProtectionAuthority({project:p,testCase:test,proof:assembled.proof,expectedBinding:binding,requiredObligations:required,trustedEvidence:evidence,canonicalRun:run,
      policyVersion:HTML_PROTECTION_AUTHORITY_POLICY,observedAt:at,expiresAt:"2026-10-16T08:10:00.000Z",now})!;
    expect(token).toBeDefined();
    const bound=bindHtmlProtectionAuthorities(p,[kind==="copied-token"?JSON.parse(JSON.stringify(token)):token]);
    expect(bound).toBe(kind!=="copied-token");
    const result=htmlProtectionCriterionAuthority({project:p,criterion,testCases:[test],runs:[run],now});
    expect(result.passed).toBe(kind==="complete");
    if(kind==="observed-failure")expect(result.observedFailure).toBe(true);
    p.htmlProtectionOperationalScope!.humanReviewNote+=" changed";
    expect(htmlProtectionCriterionAuthority({project:p,criterion,testCases:[test],runs:[run],now}).passed).toBe(false);
  });
});
