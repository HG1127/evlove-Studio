import {createHash} from "node:crypto";
import {evidenceFingerprint,materializeAcceptedCandidatePackage,materializeAcceptedChampionPackage,sourceGroundedHtmlProtectionSteps} from "@evolution/core";
import {acceptedPackageFixture} from "./accepted-package-fixture";

/** Synthetic stored acceptance from the prior generated paper, never live evidence. */
export function acceptedLegacyHtmlPaperFixture(withChampion=false){
 const f=acceptedPackageFixture(withChampion),p=f.project;
 const html='<!doctype html><html><meta name="viewport" content="width=device-width"><style>.search-hidden{display:none}</style><body><input id="search"><span id="searchCount">2 页</span><article class="slide-card" id="slide-2" data-search="intro">Intro</article><article class="slide-card" id="slide-3" data-search="intro end">End</article><script>const search=document.querySelector("#search");search.addEventListener("input",()=>{const query=search.value;setTimeout(()=>{let visible=0;document.querySelectorAll(".slide-card").forEach(card=>{const ok=!query||card.dataset.search.includes(query);card.classList.toggle("search-hidden",!ok);if(ok)visible++});document.querySelector("#searchCount").textContent=query?visible+" 页命中":"2 页";},180)});</script></body></html>';
 const snapshot=f.current.artifactSnapshots[0]!;
 snapshot.content=html.replace('card.dataset.search.includes(query)','false');
 const sha=createHash("sha256").update(snapshot.content,"utf8").digest("hex");
 const blob=new Blob([snapshot.content],{type:"text/html"});
 snapshot.contentHash=sha;
 snapshot.frozenArtifact={...snapshot.frozenArtifact!,snapshotHash:sha,sha256:sha,blobId:"server-candidate:"+sha,size:blob.size};
 p.artifactAcceptance.frozenArtifacts=[snapshot.frozenArtifact];
 f.blobs.set(snapshot.frozenArtifact.blobId,blob);
 p.sourceArtifacts[0]!.textContent=html;p.sourceArtifacts[0]!.size=new TextEncoder().encode(html).length;
 const criterion={id:"PROTECT-ALL",title:"保护搜索",requirement:"保留搜索",source:"user-command" as const,weight:10,hardGate:true,judgeType:"llm" as const,validationMethod:"semantic-judge" as const,minScore:80,evidenceExpected:["搜索"],protectedConstraint:true,artifactIds:["source"],category:"integrity" as const};
 p.acceptanceRubric=[{...criterion,id:"CONTENT",weight:90,protectedConstraint:false},criterion];
 const test={...p.hiddenEvalSuite[0]!,criterionIds:["CONTENT","PROTECT-ALL"],executionMode:"external-runner" as const};
 const next=sourceGroundedHtmlProtectionSteps(p,[criterion],test)!;
 const old=[...next.slice(0,3),...next.slice(6,8),...next.slice(3,6),...next.slice(11)];
 p.evalSuite=[{...test,id:"V1",hidden:false,browserSteps:old,tags:[]}];
 p.hiddenEvalSuite=[{...test,browserSteps:old,tags:[]}];
 const scores=p.acceptanceRubric.map(c=>({criterionId:c.id,score:100,pass:true,verificationStatus:"verified" as const,evidence:["synthetic stored prior observation"],gaps:[],testCaseIds:[test.id]}));
 const evaluation={...p.validationRun.evaluation!,accuracy:100,evidence:100,completeness:100,rubricScore:100,criterionScores:scores};
 p.validationRun.evaluation=evaluation;p.validationRun.baselineEvaluation=evaluation;
 p.artifactAcceptance.results=scores.map(c=>({...c,note:"synthetic persisted prior acceptance"}));
 p.artifactAcceptance.overallScore=100;p.artifactAcceptance.coverageScore=100;p.artifactAcceptance.integrityScore=100;
 const bind=()=>{
  const binding=evidenceFingerprint(p,f.current);p.validationRun.evidenceFingerprint=binding;p.artifactAcceptance.evidenceFingerprint=binding;
  if(p.searchChampion){
   p.searchChampion.validation!.evaluation=evaluation;p.searchChampion.validation!.baselineEvaluation=evaluation;
   const prior=evidenceFingerprint(p,f.prior);p.searchChampion.validation!.evidenceFingerprint=prior;
   p.searchChampion.artifactAcceptance!.evidenceFingerprint=prior;p.searchChampion.artifactAcceptance!.results=p.artifactAcceptance.results;
  }
 };
 bind();
 // Build canonical stored metadata as an explicit paper, then restore its prior
 // generated marker and rebind the stored fingerprints. This models persistence;
 // current materializers must reject it rather than generate new accepted output.
 const oldCurrent=evidenceFingerprint(p,f.current),oldPrior=evidenceFingerprint(p,f.prior);
 p.outputArtifacts=withChampion?materializeAcceptedChampionPackage(p):materializeAcceptedCandidatePackage(p,f.current,p.artifactAcceptance);
 p.evalSuite=p.evalSuite.map(t=>({...t,tags:["source-grounded-html-assertions"]}));
 p.hiddenEvalSuite=p.hiddenEvalSuite.map(t=>({...t,tags:["source-grounded-html-assertions"]}));
 bind();
 const newCurrent=evidenceFingerprint(p,f.current),newPrior=evidenceFingerprint(p,f.prior);
 p.outputArtifacts=p.outputArtifacts.map(a=>({...a,content:a.content.replaceAll(oldCurrent,newCurrent).replaceAll(oldPrior,newPrior)}));
 return {...f,next};
}
