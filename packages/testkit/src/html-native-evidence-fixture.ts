import {TargetRunResultSchema,type TargetRunResult} from "@evolution/contracts";
import {fastHash} from "@evolution/core";

/** Synthetic complete receipt for binding/completeness tests, never real browser evidence. */
export function htmlNativeEvidenceFixture():TargetRunResult{
  const fixed=["initial-card-inventory","search-positive","search-negative","search-reset","mobile-menu-opens","mobile-menu-closes-on-navigation",
    "prompt-copy-preserves-internal-whitespace","complete-checklist-reaches-total-and-100-percent","reading-progress-at-end","return-to-top-and-progress-reset",
    "no-horizontal-overflow-1440","no-horizontal-overflow-390","no-unknown-interactive-controls","no-runtime-errors","no-external-resource-dependency","navigation-#c01"];
  const counted=["all-copy-controls-write-real-clipboard","copied-content-matches-current-dom-order","editable-prompts-copy-current-edited-content",
    "all-checklist-items-toggle-and-restore","all-checklist-counters-and-bars-track-state","all-details-toggle-and-restore"];
  const paragraphs=[1440,390].map(viewport=>({viewport,paragraphs:[{section:"slide-2",role:"introductory",chars:18,lineCount:2,height:44,cardCount:1,cardDetailChars:3}]}));
  const text="Synthetic readable document";
  const subject=(sha256:string,expectedMatched:boolean)=>({sha256,bodyTextFingerprint:fastHash(text),elapsedMs:123,renderedParagraphs:paragraphs,
    inventory:{cards:2,menu:1,top:1,progress:1,pageCopy:0,promptCopy:1,editablePrompts:1,checkItems:1,checkPanels:1,details:1,internalLinks:["#c01"],unknownControls:[]},
    checks:[...fixed.map(id=>({id,pass:true})),...counted.map(id=>({id,pass:true,tested:1,failed:0})),
      {id:"content-search-#slide-2",pass:true,query:"new_content",targetCardId:"slide-2",expectedMatched,matched:expectedMatched}],failures:[]});
  const sha="a".repeat(64);
  return TargetRunResultSchema.parse({testCaseId:"native-case",artifactHash:sha,output:"Synthetic native observations, no quality verdict",verificationStatus:"verified",latencyMs:123,cost:0,trace:[],
    nativeHtmlProof:{sourceArtifactId:"source-html",testCaseId:"native-case",subjectSha256:sha,producer:"native-html-observer-v1",observation:{
      schemaVersion:"html-native-observation-v1",profileId:"vibe-sop-browser-v1",isolation:"network-denied-ephemeral",observedAt:"2026-10-23T12:00:00.000Z",
      kernelSha256:"b".repeat(64),programSignature:"c".repeat(64),styleSignature:"d".repeat(64),originalCodeBlocksRetained:true,
      originalNamedElementsRetained:true,rawNamedAttributesRetained:true,derivedSearchMetadataUpdates:0,originalNamedElementCount:2,
      originalInteractiveSequenceRetained:true,originalSlideCardOrderRetained:true,original:subject("e".repeat(64),false),subject:subject(sha,true),
      contentSearchQueries:[{cardId:"slide-2",query:"new_content"}],
      styleComparison:[1440,390].map(width=>({width,propertyCount:50,namedElementsCompared:2,styleGroupsCompared:1,changedNamed:[],missingGroups:[],infiniteAnimations:0,pass:true})),
      billingStatus:"unavailable",limitations:["Synthetic fixture; never a real validation receipt"],
    }},renderedDocumentEvidence:{schemaVersion:"rendered-html-document-v1",sourceArtifactId:"source-html",artifactSha256:sha,textFingerprint:fastHash(text),text,
      paragraphs,complete:true,excludes:["scripts","styles","raw-attributes"]}});
}
