import type {ReleaseOutcomeTelemetryStatus} from "@evolution/contracts";

export function skippedReleaseOutcomeTelemetry():ReleaseOutcomeTelemetryStatus{
  return {status:"skipped",inserted:0,warningCount:0,reason:"No valid release observation was available"};
}

export async function captureReleaseOutcomeTelemetry(
  record:()=>Promise<{recorded:boolean;inserted:number;reason:string;telemetry:{warnings:string[]}}>,
):Promise<ReleaseOutcomeTelemetryStatus>{
  try{
    const result=await record();
    return{
      status:result.recorded?"recorded":"skipped",
      inserted:result.inserted,
      warningCount:result.telemetry.warnings.length,
      reason:result.recorded?undefined:result.reason==="secure-data-plane-not-configured"
        ?"Outcome data plane is not configured"
        :"No bound Outcome samples were produced",
    };
  }catch(error){
    console.warn("[outcome-telemetry] Release observation samples were not persisted",{
      errorType:error instanceof Error?error.name:"unknown",
    });
    return{
      status:"failed",inserted:0,warningCount:0,
      reason:"Outcome samples were not persisted; retry Release reconciliation",
    };
  }
}
