export type DirectAiSchemaDiagnostic={path:string;code:string};
type Issue={path:readonly PropertyKey[];code:string};
const issueCodes=new Set(["invalid_type","too_big","too_small","invalid_format","invalid_value","unrecognized_keys","invalid_union","invalid_key","invalid_element","custom"]);
const failureCodes=new Set(["AI_REQUEST_TIMEOUT","AI_REQUEST_NETWORK_ERROR","AI_OUTPUT_INCOMPLETE","AI_OUTPUT_MISSING_FINAL","AI_OUTPUT_CORRECTION_CONTEXT_MISSING","AI_OUTPUT_CORRECTION_CONTEXT_TOO_LARGE","AI_OUTPUT_CORRECTION_REQUEST_TOO_LARGE","AI_OUTPUT_CORRECTION_SECRET_PRESENT","AI_OUTPUT_SCHEMA_MISMATCH","AI_OUTPUT_CORRECTION_FAILED"]);
/** Only schema-owned names are allowed; never retain rejected values, IDs or Zod messages. */
export function directAiSchemaDiagnostics(schema:Record<string,unknown>,issues:readonly Issue[]):DirectAiSchemaDiagnostic[]{
  const names=new Set<string>();const seen=new Set<object>();
  function visit(value:unknown){
    if(!value||typeof value!=="object"||seen.has(value))return;seen.add(value);
    if(Array.isArray(value)){value.forEach(visit);return;}
    const node=value as Record<string,unknown>;
    if(node.properties&&typeof node.properties==="object"){
      for(const [name,child] of Object.entries(node.properties)){names.add(name);visit(child);}
    }
    for(const key of ["items","anyOf","oneOf","allOf","additionalProperties"])visit(node[key]);
  }
  visit(schema);
  return issues.slice(0,4).map(issue=>({
    path:issue.path.length?issue.path.map(part=>typeof part==="number"?"[]":typeof part==="string"&&names.has(part)?part:"<field>").join("."):"<root>",
    code:issueCodes.has(issue.code)?issue.code:"schema-rejected",
  }));
}
/** Public diagnostics contain fixed local codes, HTTP integers and already schema-owned paths only. */
export function directAiCorrectionDiagnosticSuffix(args:{code:string;httpStatus?:number;schemaIssues?:readonly DirectAiSchemaDiagnostic[]}):string{
  const code=failureCodes.has(args.code)?args.code:"AI_OUTPUT_CORRECTION_FAILED";
  const parts=["phase=correction","code="+code];
  if(Number.isInteger(args.httpStatus)&&args.httpStatus!>=100&&args.httpStatus!<=599)parts.push("HTTP="+args.httpStatus);
  for(const issue of (args.schemaIssues??[]).slice(0,4))parts.push("schema="+issue.path+":"+issue.code);
  return " ["+parts.join("; ")+"]";
}
