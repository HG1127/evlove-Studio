import {inspectLabJobIntegrity} from "./lab-job-integrity";

type LabIntegritySummary={status:"clear"|"blocked"|"unknown"};

export class LabReconciliationBlockedError extends Error{
  readonly code="LAB_RECONCILIATION_BLOCKED";
  constructor(readonly state:"blocked"|"unknown"){
    super("隔离 Lab 任务完整性尚未通过验证，禁止自动修改任何任务或成果。");
    this.name="LabReconciliationBlockedError";
  }
}

/** Fail-closed before any *Lab-only* reconciliation side effects.
 * This is a point-in-time gate, not a replacement for per-Job CAS/parent checks.
 */
export async function assertLabReconciliationReady(
  inspect:()=>Promise<LabIntegritySummary>=inspectLabJobIntegrity,
){
  if(process.env.EVOLUTION_EXPERIMENT_MODE!=="isolated")return;
  const report=await inspect();
  if(report.status!=="clear")throw new LabReconciliationBlockedError(report.status);
}
