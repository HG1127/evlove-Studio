import {timingSafeEqual} from "node:crypto";
import {reconcileWorkflowJobs} from "./job-reconciliation";

export function scheduledReconciliationAuthorized(header:string|undefined,secret:string|undefined){
  if(!secret||secret.length<16||!header?.startsWith("Bearer "))return false;
  const supplied=Buffer.from(header.slice("Bearer ".length));
  const expected=Buffer.from(secret);
  return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}

export function runScheduledJobReconciliation(){
  return reconcileWorkflowJobs({minAgeSeconds:900,limit:50,repair:true});
}
