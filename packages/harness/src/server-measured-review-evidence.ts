import {DOCUMENT_TEXT_OBSERVATION_MAX_CHARS,type TargetRunResult} from "@evolution/contracts";
import {inspectHtmlNativeEvidence} from "@evolution/core";

export const SERVER_MEASURED_REVIEW_VERSION = "server-measured-document-review-v2";

/** Reuse only existing document observations. No Artifact/Source reads or raw HTML reconstruction. */
export function measuredDocumentObservations(runs: TargetRunResult[], budget = DOCUMENT_TEXT_OBSERVATION_MAX_CHARS) {
  const observations: Array<{testCaseId:string;artifactHash?:string;output:string}> = [];
  const omittedTestCaseIds: string[] = [];
  const seen = new Set<string>();
  let remaining = budget;
  for (const run of runs) {
    if (run.error || run.verificationStatus !== "verified") continue;
    const native=inspectHtmlNativeEvidence(run,run.testCaseId);
    if(native?.complete){
      const key=`rendered:${native.document.artifactSha256}:${native.document.textFingerprint}`;
      if(seen.has(key))continue;
      seen.add(key);
      const output="COMPLETE RENDERED DOCUMENT OBSERVATION\n"+native.document.text
        +"\n\nMEASURED PARAGRAPH FACTS (observations, no automatic quality verdict):\n"+JSON.stringify(native.document.paragraphs);
      if(output.length>remaining){omittedTestCaseIds.push(run.testCaseId);continue;}
      observations.push({testCaseId:run.testCaseId,artifactHash:run.artifactHash,output});
      remaining-=output.length;
      continue;
    }
    const current = run.output.startsWith("COMPLETE CURRENT DOCUMENT TEXT OBSERVATION")
      && run.trace.some(step => step.stage === "current-document-text-evidence" && step.status === "pass");
    const candidate = run.output.startsWith("CURRENT CANDIDATE SNAPSHOT EVIDENCE")
      && run.output.includes("complete text projection")
      && run.trace.some(step => step.id === `candidate-semantic-snapshot-${run.testCaseId}` && step.status === "pass");
    if (!current && !candidate) continue;
    // Per-case wrappers vary, but their measured document block is identical.
    const largestBlock = run.output.split("\n\n").sort((a,b) => b.length-a.length)[0] ?? run.output;
    const key = largestBlock;
    if (seen.has(key)) continue;
    seen.add(key);
    if (run.output.length > remaining) { omittedTestCaseIds.push(run.testCaseId); continue; }
    observations.push({testCaseId:run.testCaseId,artifactHash:run.artifactHash,output:run.output});
    remaining -= run.output.length;
  }
  return {observations,omittedTestCaseIds,
    limitations:["Existing measured document observations only; rendered text/paragraph facts require a bound native observer receipt. Raw scripts/styles are excluded.",
      "A document observation is not a quality verdict. Judge the unchanged rubric independently."]};
}
