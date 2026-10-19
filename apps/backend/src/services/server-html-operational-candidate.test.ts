// @vitest-environment node
import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {AcceptanceCriterionSchema,EvolveProjectSchema,TestCaseSchema} from "@evolution/contracts";
import {confirmHtmlProtectionOperationalScope} from "@evolution/core";
import {checkServerHtmlCandidateProtection} from "./server-html-candidate-protection";
import {assertClientControlOwnerMutationSafe,assertClientMissionMutationSafe} from "./mission-mutation-policy";
const at="2026-10-16T08:00:00.000Z";
function fixture(){
  const html='<!doctype html><html><head><style>p{color:red}</style><script>const unchanged=1</script></head><body><p>Outside</p>'+
    Array.from({length:111},(_,index)=>'<article class="slide-card" id="card-'+index+'"><h2>Title '+index+'</h2><p>Original method '+index+'</p><button>Copy '+index+'</button></article>').join("")+'</body></html>';
  const original={sourceArtifactId:"source",sha256:createHash("sha256").update(html).digest("hex"),byteLength:Buffer.byteLength(html)};
  const criterion=AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"Protection",requirement:"Preserve Original methods, structure and controls",protectedConstraint:true,hardGate:true,minScore:95});
  const test=TestCaseSchema.parse({id:"H",title:"Full",input:"Full Original",expected:["Preserved"],hidden:true,criterionIds:[criterion.id]});
  let project=EvolveProjectSchema.parse({id:"M",name:"Operational",objectType:"document",department:"",version:"S0",stage:"target",goal:"Refine configuration",
    protectedItems:["83个slide章节结构","HTML/CSS/JS交互功能"],editableItems:["各章节内的配置细节描述"],metrics:[],
    sourceArtifacts:[{id:"source",name:"original.html",extension:"html",mimeType:"text/html",size:original.byteLength,role:"target",parseStatus:"ready",createdAt:at}],
    gates:[{id:"target-ready",label:"Ready",status:"approved",approvedAt:at}],problems:[],candidates:[],experimentPolicy:{},
    baselineRun:{id:"B",status:"idle",suiteName:"Visible",totalCases:0,runs:[]},experimentRun:{id:"E",status:"idle",candidateResults:[]},
    validationRun:{id:"H",status:"idle",checks:[],runs:[],baselineRuns:[]},release:{status:"idle",trafficPercent:0,kpis:[],history:[]},
    lessons:[],targetConnection:{adapter:"artifact"},updatedAt:at,acceptanceRubric:[criterion],hiddenEvalSuite:[test],
    acceptanceRubricState:{status:"ready",version:1,confirmedAt:at}});
  project=confirmHtmlProtectionOperationalScope(project,{original,confirmedAt:at,confirmedBy:{actorId:"human",actorSource:"browser-session"},humanReviewNote:"Human confirmed the exact complete operational policy"});
  return {project,html,source:project.sourceArtifacts[0]!};
}
describe("confirmed whole Original body edit construction boundary",()=>{
  it("retains all actual 111 cards and allows only existing body wording before frozen writes",async()=>{
    const f=fixture(),readOriginal=vi.fn(async()=>f.html);
    const report=await checkServerHtmlCandidateProtection({...f,candidateContent:f.html.replace("Original method 110","Original method 110 with concrete configuration steps"),parentText:f.html,hasParent:false,readOriginal});
    expect(report.checks.join(" ")).toContain("111");expect(readOriginal).toHaveBeenCalledOnce();
    expect(report.limitations.join(" ")).toContain("独立验收");
  });
  it.each(["last-card","title","control-label","attribute","css","script","outside","new-element"] as const)("refuses %s modification",async kind=>{
    const f=fixture();let changed=f.html;
    if(kind==="last-card")changed=changed.replace(/<article class="slide-card" id="card-110">.*?<\/article>/,"");
    if(kind==="title")changed=changed.replace("Title 110","Changed heading");
    if(kind==="control-label")changed=changed.replace("Copy 110","Changed control");
    if(kind==="attribute")changed=changed.replace('id="card-110"','id="other"');
    if(kind==="css")changed=changed.replace("color:red","color:blue");
    if(kind==="script")changed=changed.replace("unchanged=1","unchanged=2");
    if(kind==="outside")changed=changed.replace("Outside","Changed outside");
    if(kind==="new-element")changed=changed.replace("</body>","<p>Additional node</p></body>");
    await expect(checkServerHtmlCandidateProtection({...f,candidateContent:changed,parentText:f.html,hasParent:false,readOriginal:async()=>f.html})).rejects.toThrow();
  });
  it("does not let a normal Mission create/PUT enable, remove or replace human confirmation",()=>{
    const f=fixture(),legacy={...f.project,htmlProtectionOperationalScope:undefined};
    expect(()=>assertClientControlOwnerMutationSafe(undefined,f.project)).toThrow(/专用人工保护范围/);
    expect(()=>assertClientMissionMutationSafe(legacy,f.project)).toThrow();
    expect(()=>assertClientMissionMutationSafe(f.project,legacy)).toThrow();
    expect(()=>assertClientMissionMutationSafe(f.project,structuredClone(f.project))).not.toThrow();
  });
});
