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

const jsonTypes=new Set(["array","object","string","number","integer","boolean","null"]);
function expectedSchemaType(schema:Record<string,unknown>,path:readonly PropertyKey[]):string|undefined{
  if(path.length>16)return undefined;
  let node:unknown=schema;
  for(const part of path){
    if(!node||typeof node!=="object"||Array.isArray(node))return undefined;
    const current=node as Record<string,unknown>;
    if(typeof part==="number"){
      if(!Number.isInteger(part)||part<0||current.type!=="array")return undefined;
      node=current.items;
    }else if(typeof part==="string"){
      const properties=current.properties;
      if(!properties||typeof properties!=="object"||Array.isArray(properties)||!Object.hasOwn(properties,part))return undefined;
      node=(properties as Record<string,unknown>)[part];
    }else return undefined;
  }
  if(!node||typeof node!=="object"||Array.isArray(node))return undefined;
  const type=(node as Record<string,unknown>).type;
  return typeof type==="string"&&jsonTypes.has(type)?type:undefined;
}
/** Only local validation paths/codes and contract-owned JSON types enter the system prompt.
 * Rejected values, IDs and Zod messages remain in the separate quarantined data context. */
export function directAiSchemaCorrectionFeedback(schema:Record<string,unknown>,issues:readonly Issue[]):string{
  const rows=directAiSchemaDiagnostics(schema,issues).map((issue,index)=>{
    const expected=expectedSchemaType(schema,issues[index].path);
    return{path:issue.path.slice(0,192),code:issue.code,...(expected?{expected}:{})};
  });
  return "\nSchema shape errors (local, not evidence): "+JSON.stringify(rows)
    +"\nCorrect these shapes in the complete root result. These errors carry no artifact evidence or accepted scores; independently judge the unchanged original evidence.";
}
