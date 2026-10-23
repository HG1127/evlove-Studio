import type { EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";

function exactOriginalPastedDocument(
  project:EvolveProject,
  artifactContext:Array<Record<string,unknown>>,
){
  if(project.targetConnection?.adapter!=="artifact"||project.searchChampion)return undefined;
  const targets=project.sourceArtifacts.filter(source=>source.role==="target");
  if(targets.length!==1)return undefined;
  const source=targets[0]!;
  if(source.inputMode!=="paste"||source.parseStatus!=="ready"
    ||!["md","markdown","txt"].includes(source.extension.toLowerCase())
    ||!source.textContent?.trim())return undefined;
  const complete=source.textContent;
  if(new TextEncoder().encode(complete).byteLength!==source.size)return undefined;
  const matching=artifactContext.filter(entry=>entry.id===source.id);
  if(matching.length!==1||matching[0]!.truncated!==false
    ||matching[0]!.content!==complete||matching[0]!.originalChars!==complete.length)return undefined;
  return {source,complete};
}



/**
 * A documented, explicitly quoted defect in the complete original text can prove
 * that the original document does not yet meet a citation-related user requirement.
 * This is a VERIFIED negative document observation, NOT a verified product pass.
 *
 * Fail closed for truncation, uploads/remote blobs, ambiguous Targets, stale source
 * sizes, ungrounded model statements and non-document/runtime scenarios.
 */
export function groundedOriginalCitationDefect(args:{
  project:EvolveProject;
  testCase:TestCase;
  output:string;
  artifactContext:Array<Record<string,unknown>>;
}):TargetRunResult|undefined {
  const {project,testCase,output,artifactContext}=args;
  if(project.targetConnection?.adapter!=="artifact"||project.searchChampion
    ||testCase.executionMode!=="artifact-runtime"
    ||!/^(?:\s*UNVERIFIED\b|\s*PARTIAL[-\s]?UNVERIFIED\b)/i.test(output))return undefined;
  const mapped=project.acceptanceRubric.filter(criterion=>testCase.criterionIds.includes(criterion.id));
  if(mapped.length!==1||!mapped[0]!.hardGate
    ||mapped[0]!.source!=="user-command"
    ||mapped[0]!.validationMethod!=="semantic-judge"
    ||!/(?:来源|出处|引用|证据)/.test(project.evolutionCommand+" "+mapped[0]!.requirement))return undefined;
  const direct=exactOriginalPastedDocument(project,artifactContext);
  if(!direct)return undefined;
  const {source,complete}=direct;
  const lines=complete.split(/\r?\n/).map(line=>line.trim());
  const headingIndex=lines.findIndex(line=>/^#{1,5}\s*(?:当前缺陷|当前问题|已知缺陷|已知问题)\s*$/.test(line));
  if(headingIndex<0)return undefined;
  const nextHeading=lines.findIndex((line,i)=>i>headingIndex&&/^#{1,5}\s/.test(line));
  const defectLines=lines.slice(headingIndex+1,nextHeading<0?undefined:nextHeading);
  const explicitQuote=defectLines.find(line=>
    line.length>=8&&line.length<=240
    &&/(?:没有|缺少|缺乏|尚未|未实现|未提供|不具备)[^。！？\n]{0,85}(?:来源|出处|引用|证据)/.test(line)
    &&/(?:来源|出处|引用|证据)/.test(line));
  if(!explicitQuote)return undefined;
  return {
    testCaseId:testCase.id,
    output:"VERIFIED DOCUMENTED BASELINE DEFECT (not product success)\n"+
      "Source: "+source.id+" · "+source.name+"\n"+
      "Exact original citation: "+explicitQuote+"\n"+
      "The complete original document explicitly records its citation deficiency. "+
      "This establishes failure of that required conjunct only; other product behaviors are not inferred.",
    latencyMs:0,cost:0,verificationStatus:"verified",
    trace:[{
      id:"explicit-defect-"+source.id+"-"+testCase.id,
      stage:"baseline-exact-source-negative-evidence",
      summary:"完整原版原文直接证实引用能力缺口（失败证据，而非成功声明）",
      status:"pass",
      detail:JSON.stringify({sourceArtifactId:source.id,testCaseId:testCase.id,quote:explicitQuote,originalChars:complete.length,bytes:source.size}),
    }],
  };
}

/**
 * For a single COMPLETE pasted text document, the existence of a specific,
 * original, user-protected instruction can be checked byte-for-byte without an
 * LLM. Only the instruction text is verified; no actual Agent/runtime behavior
 * is inferred. Every unrecognized case remains UNVERIFIED.
 */
export function groundedOriginalDocumentProtection(args:{
  project:EvolveProject;
  testCase:TestCase;
  artifactContext:Array<Record<string,unknown>>;
}):TargetRunResult|undefined{
  const {project,testCase,artifactContext}=args;
  if(testCase.executionMode!=="artifact-runtime"
    ||testCase.criterionIds.length!==1||testCase.criterionIds[0]!=="PROTECT-ALL"
    ||!project.acceptanceRubric.some(item=>item.id==="PROTECT-ALL"&&item.hardGate)
    ||!project.protectedItems?.length)return undefined;
  const direct=exactOriginalPastedDocument(project,artifactContext);
  if(!direct)return undefined;
  const {source,complete}=direct;
  const label=[testCase.id,testCase.title,testCase.input,...testCase.expected].join(" ");
  const lines=complete.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  let quoted:string|undefined;
  if(/(?:中文|CHINESE)/i.test(label)&&project.protectedItems.some(x=>/中文/.test(x))){
    quoted=lines.find(line=>line.includes("中文")&&line.length>8);
  }else if(/(?:四节|四章|章节|结构|FOUR|SECTION)/i.test(label)
    &&project.protectedItems.some(x=>/摘要.*核心论点.*风险.*下一步/.test(x))){
    quoted=lines.find(line=>/摘要.*核心论点.*风险.*下一步/.test(line));
  }else if(/(?:编造|虚构|FABRICATION)/i.test(label)
    &&project.protectedItems.some(x=>/(?:不虚构|禁止编造|不得编造)/.test(x))){
    quoted=lines.find(line=>/(?:禁止编造|不得编造|不能编造|不虚构|不得虚构)/.test(line));
  }
  if(!quoted||quoted.length>240)return undefined;
  return{
    testCaseId:testCase.id,
    output:"VERIFIED ORIGINAL DOCUMENT INSTRUCTION (not execution success)\n"+
      "Source: "+source.id+" · "+source.name+"\n"+
      "Exact original quotation: "+quoted+"\n"+
      "This verifies the presence of the user-protected instruction in complete original text only.",
    latencyMs:0,cost:0,verificationStatus:"verified",
    trace:[{
      id:"explicit-protection-"+source.id+"-"+testCase.id,
      stage:"baseline-exact-source-protection",
      summary:"完整原文直接核对原版保护条款存在性，不声称真实运行已通过",
      status:"pass",
      detail:JSON.stringify({sourceArtifactId:source.id,testCaseId:testCase.id,quote:quoted,originalChars:complete.length,bytes:source.size}),
    }],
  };
}
