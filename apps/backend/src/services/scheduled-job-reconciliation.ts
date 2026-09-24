import {timingSafeEqual} from "node:crypto";
import {reconcileWorkflowJobs} from "./job-reconciliation";
import {ActiveJobQueryError} from "./production-runtime";

const SAFE_UPSTREAM_REASONS=new Set([
  "credential-rejected","schema-unavailable","rate-limited-or-timeout",
  "upstream-unavailable","network-error","conflict","request-rejected",
]);

export function scheduledReconciliationFailureDiagnostic(error:unknown){
  const query=error instanceof ActiveJobQueryError?error.query:undefined;
  const source=error instanceof ActiveJobQueryError?error.cause:error;
  const data=source&&typeof source==="object"&&"data" in source
    ?(source as {data?:unknown}).data:undefined;
  const details=data&&typeof data==="object"&&!Array.isArray(data)
    ?data as Record<string,unknown>:{};
  const reason=typeof details.reason==="string"&&SAFE_UPSTREAM_REASONS.has(details.reason)
    ?details.reason:"unclassified";
  const upstreamStatus=typeof details.upstreamStatus==="number"
    &&Number.isInteger(details.upstreamStatus)
    &&details.upstreamStatus>=100&&details.upstreamStatus<=599
    ?details.upstreamStatus:undefined;
  const service=details.service==="production-runtime"?"production-runtime":undefined;
  return {reason,...(upstreamStatus?{upstreamStatus}:{}),...(service?{service}:{}),...(query?{query}:{})};
}

export function scheduledReconciliationAuthorized(header:string|undefined,secret:string|undefined){
  if(!secret||secret.length<16||!header?.startsWith("Bearer "))return false;
  const supplied=Buffer.from(header.slice("Bearer ".length));
  const expected=Buffer.from(secret);
  return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}

export function runScheduledJobReconciliation(){
  return reconcileWorkflowJobs({minAgeSeconds:900,limit:50,repair:true});
}
