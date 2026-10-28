import {HtmlNativeRunProofSchema,HtmlRenderedDocumentEvidenceSchema,type EvolveProject,type TargetRunResult,type TestCase} from "@evolution/contracts";
import {fastHash} from "./stable-hash";
import {criterionCanUseLocalSnapshotEvidence} from "./criterion-evidence";
import {htmlNativeBrowserPlanKey,isSourceGroundedHtmlSearchPlan} from "./html-native-browser-assertions";

export const HTML_NATIVE_EVIDENCE_POLICY_VERSION="html-native-evidence-v4-source-navigation-style";

const protectedIds=new Set(["PROTECT-ALL","SYS-INTEGRITY","ART-1-STRUCTURE","SEM-CROSS-CONSISTENCY"]);
const fixedChecks=["initial-card-inventory","search-positive","search-negative","search-reset","mobile-menu-opens","mobile-menu-closes-on-navigation",
  "all-copy-controls-write-real-clipboard","copied-content-matches-current-dom-order","prompt-copy-preserves-internal-whitespace",
  "editable-prompts-copy-current-edited-content","all-checklist-items-toggle-and-restore","all-checklist-counters-and-bars-track-state",
  "complete-checklist-reaches-total-and-100-percent","all-details-toggle-and-restore","reading-progress-at-end","return-to-top-and-progress-reset",
  "no-horizontal-overflow-1440","no-horizontal-overflow-390","no-unknown-interactive-controls","no-runtime-errors","no-external-resource-dependency"];

export function htmlNativeCaseSource(project:EvolveProject,test:TestCase){
  if(project.targetConnection?.adapter!=="artifact"||!test.criterionIds.length
    ||!["artifact-runtime","external-runner","visual-review","static-evidence"].includes(test.executionMode))return undefined;
  const criteria=project.acceptanceRubric.filter(c=>test.criterionIds.includes(c.id));
  if(criteria.length!==new Set(test.criterionIds).size||criteria.some(c=>c.validationMethod==="manual-review"
    ||!protectedIds.has(c.id)&&!criterionCanUseLocalSnapshotEvidence(project,c)
    ||test.executionMode==="static-evidence"&&!protectedIds.has(c.id)))return undefined;
  const ids=new Set(criteria.flatMap(c=>c.artifactIds));
  const targets=project.sourceArtifacts.filter(source=>source.role==="target"&&(!ids.size||ids.has(source.id)));
  if(targets.length!==1||ids.size>1||!/^html?$/i.test(targets[0]!.extension)||!["document","knowledge","generic"].includes(targets[0]!.artifactKind))return undefined;
  if(test.browserSteps?.length&&(!test.tags.includes("source-grounded-html-assertions")||test.executionMode!=="external-runner"
    ||!isSourceGroundedHtmlSearchPlan(targets[0]!.textContent??"",test.browserSteps)))return undefined;
  return targets[0];
}

/** Verify observation completeness/binding, never infer semantic quality from passing tool checks. */
export function inspectHtmlNativeEvidence(run:TargetRunResult,testCaseId:string,sourceArtifactId?:string,subjectSha256?:string,browserSteps?:TestCase["browserSteps"]){
  const parsed=HtmlNativeRunProofSchema.safeParse(run.nativeHtmlProof),document=HtmlRenderedDocumentEvidenceSchema.safeParse(run.renderedDocumentEvidence);
  if(!parsed.success||!document.success||run.error)return undefined;
  const proof=parsed.data,observation=proof.observation,body=document.data;
  const plans=observation.browserAssertions?.plans??[];
  if(new Set(plans.map(htmlNativeBrowserPlanKey)).size!==plans.length
    ||browserSteps?.length&&(!htmlNativeBrowserPlanKey(browserSteps)||!plans.some(plan=>htmlNativeBrowserPlanKey(plan)===htmlNativeBrowserPlanKey(browserSteps))))return undefined;
  const retention=observation.codeBlockRetention;
  if(retention&&(retention.retainedCount!==retention.exactCount+retention.extendedInstructionCount
    ||retention.retainedCount>retention.originalCount||retention.retained!==(retention.retainedCount===retention.originalCount)
    ||retention.retained!==observation.originalCodeBlocksRetained))return undefined;
  if(proof.testCaseId!==testCaseId||run.testCaseId!==testCaseId||proof.subjectSha256!==run.artifactHash||observation.subject.sha256!==proof.subjectSha256
    ||sourceArtifactId!==undefined&&proof.sourceArtifactId!==sourceArtifactId||subjectSha256!==undefined&&proof.subjectSha256!==subjectSha256
    ||body.sourceArtifactId!==proof.sourceArtifactId||body.artifactSha256!==proof.subjectSha256
    ||body.textFingerprint!==observation.subject.bodyTextFingerprint||fastHash(body.text)!==body.textFingerprint
    ||fastHash(body.paragraphs)!==fastHash(observation.subject.renderedParagraphs))return undefined;
  const queries=observation.contentSearchQueries;
  if(new Set(queries.map(item=>item.cardId)).size!==queries.length)return undefined;
  const complete=(subject:typeof observation.subject,expectedMatched:boolean)=>{
    const inventory=subject.inventory,checks=new Map(subject.checks.map(check=>[check.id,check]));
    const expected=[...fixedChecks,...inventory.internalLinks.map(href=>"navigation-"+href),...queries.map(item=>"content-search-#"+item.cardId),
      ...plans.flatMap((plan,planIndex)=>plan.map((_,stepIndex)=>`declared-browser-${planIndex}-${stepIndex}`))];
    if(checks.size!==subject.checks.length||new Set(expected).size!==expected.length||expected.some(id=>!checks.has(id)))return false;
    if(plans.some((plan,planIndex)=>plan.some((_,stepIndex)=>checks.get(`declared-browser-${planIndex}-${stepIndex}`)?.tested!==1)))return false;
    if(subject.checks.some(check=>check.failed!==undefined&&(check.failed>0)===check.pass))return false;
    const observedFailures=subject.checks.filter(check=>!check.pass).map(check=>check.id).sort();
    if(fastHash(observedFailures)!==fastHash([...subject.failures].sort()))return false;
    const tested=(id:string,count:number)=>checks.get(id)?.tested===count;
    if(!tested("all-copy-controls-write-real-clipboard",inventory.pageCopy+inventory.promptCopy)
      ||!tested("copied-content-matches-current-dom-order",inventory.pageCopy+inventory.promptCopy)
      ||!tested("editable-prompts-copy-current-edited-content",inventory.editablePrompts)
      ||!tested("all-checklist-items-toggle-and-restore",inventory.checkItems)
      ||!tested("all-checklist-counters-and-bars-track-state",inventory.checkItems)
      ||!tested("all-details-toggle-and-restore",inventory.details))return false;
    for(const query of queries){const check=checks.get("content-search-#"+query.cardId);
      if(check?.query!==query.query||check.targetCardId!==query.cardId||check.expectedMatched!==expectedMatched||check.pass!==(check.matched===expectedMatched))return false;}
    return subject.renderedParagraphs.map(row=>row.viewport).sort((a,b)=>a-b).join(",")==="390,1440";
  };
  if(!complete(observation.original,false)||!complete(observation.subject,true))return undefined;
  const styles=observation.styleComparison;
  const navigationReady=(state:NonNullable<typeof styles[number]["state"]>["original"],target=state.requestedHref)=>state.requestedHref===target
    &&state.locationHref===target&&state.activeHref===target&&state.focusedHref===target&&!state.menuOpen;
  if(styles.map(row=>row.width).sort((a,b)=>a-b).join(",")!=="390,1440"
    ||styles.some(row=>row.namedElementsCompared<observation.originalNamedElementCount||!row.styleGroupsCompared
      ||row.pass!==(row.changedNamed.length===0&&row.missingGroups.length===0&&row.infiniteAnimations===0
        &&(!row.state||navigationReady(row.state.original)&&navigationReady(row.state.subject,row.state.original.requestedHref)))))return undefined;
  const originalHealthy=observation.original.checks.every(check=>check.pass)&&observation.original.inventory.unknownControls.length===0
    &&styles.every(row=>!row.state||navigationReady(row.state.original));
  const failures=[...observation.subject.failures,...styles.filter(row=>!row.pass).map(row=>"rendered-style-"+row.width),
    ...(!observation.originalCodeBlocksRetained?["original-code-block-loss"]:[]),
    ...(!observation.originalNamedElementsRetained?["original-named-identity-loss"]:[]),
    ...(!observation.originalInteractiveSequenceRetained?["original-interactive-sequence-loss"]:[]),
    ...(!observation.originalSlideCardOrderRetained?["original-slide-order-loss"]:[])];
  return {proof,document:body,originalHealthy,failures,
    // Valid counts can prove loss. Missing retention detail remains partial; a measured defect is not a missing capability.
    complete:originalHealthy&&observation.subject.inventory.unknownControls.length===0&&(observation.originalCodeBlocksRetained||retention!==undefined),
    pass:originalHealthy&&failures.length===0&&observation.originalCodeBlocksRetained};
}
