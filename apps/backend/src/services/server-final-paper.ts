import {IndependentFinalExecutionContractSchema,type EvalSuiteAiResult,type EvolveProject} from "@evolution/contracts";
import {assertIndependentFinalExecution,finalHoldoutPaperHash} from "@evolution/core";

/** These are bound HTML execution ports, not a promise that a future run passes. */
export function serverFinalPaperExecutionContract(project:EvolveProject){
  const targets=project.sourceArtifacts.filter(source=>source.role==="target");
  if(project.targetConnection.adapter!=="artifact"||!targets.length||targets.some(source=>!/^(html|htm)$/i.test(source.extension)))return undefined;
  return IndependentFinalExecutionContractSchema.parse({schemaVersion:"independent-final-execution-v1",
    supportedModes:["artifact-runtime","static-evidence","roundtrip","external-runner"],requireBrowserStepsForExternal:true,
    browserAssertionModes:["external-runner"],
    limitations:["Document text, native byte/structure checks and actual Sandbox DOM assertions are bound.",
      "No human trial or fully verified visual-review port is bound. Do not invent real external configuration, deployment or fault injection for a written-document criterion.",
      "Browser cases need selectors grounded in the supplied source and visible/text/count assertions in browserSteps. All original criteria and thresholds remain required.",
      "Declared browserSteps execute only in external-runner mode. artifact-runtime is a document semantic route and does not execute those steps. Preserve required interactions, assertions and thresholds by choosing external-runner; never silently drop them or replace them with semantic claims.",
      "evidenceScope must be exactly product-behavior, implementation, format, parser or cross-artifact. Document semantic/user-scenario review uses product-behavior; it is not a new document/content/semantic scope and does not imply real external operation."]});
}

/** Reuses the existing source payload and configured provider; adds no artifact reads or source enrichment. */
export async function reserveServerMissionFinalPaper(project:EvolveProject,payload:unknown,generate:(payload:unknown)=>Promise<EvalSuiteAiResult>){
  const execution=serverFinalPaperExecutionContract(project);
  const generated=await generate(payload);
  if(execution)assertIndependentFinalExecution(generated.hiddenCases,execution);
  const key=finalHoldoutPaperHash(generated.hiddenCases);
  return generated.hiddenCases.map((test,index)=>({...test,id:`FINAL-r${project.campaign.currentRound+1}-${key}-${index}-${test.id}`,hidden:true}));
}
