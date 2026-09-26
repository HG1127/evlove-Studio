import {
  ArtifactValidationChecksSchema,
  type ArtifactValidationChecks,type ValidationResult,
} from "@evolution/contracts";

type ValidationCheckResult=ValidationResult["checks"][number];

export function evaluateArtifactValidationChecks(
  checks:ArtifactValidationChecks,bytes:ArrayBuffer,mimeType:string,digest:string,
):{checks:ValidationCheckResult[];unsupported:string[]}{
  const output:ValidationCheckResult[]=[];
  const unsupported:string[]=[];
  const size=bytes.byteLength;
  if(checks.expectedSha256){
    output.push({name:"expectedSha256",passed:digest===checks.expectedSha256,
      expected:checks.expectedSha256,actual:digest,
      detail:digest===checks.expectedSha256?"Artifact hash matches":"Artifact hash does not match"});
  }
  if(checks.minBytes!==undefined){
    output.push({name:"minBytes",passed:size>=checks.minBytes,expected:checks.minBytes,actual:size,
      detail:size>=checks.minBytes?"Artifact meets minimum size":"Artifact is smaller than the required minimum"});
  }
  if(checks.maxBytes!==undefined){
    output.push({name:"maxBytes",passed:size<=checks.maxBytes,expected:checks.maxBytes,actual:size,
      detail:size<=checks.maxBytes?"Artifact is within maximum size":"Artifact exceeds the allowed maximum size"});
  }
  if(checks.containsText!==undefined){
    const textual=mimeType.startsWith("text/")||/json|xml|yaml|javascript|typescript/.test(mimeType);
    if(!textual){
      unsupported.push("containsText (non-text Artifact)");
    }else{
      try{
        const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
        const passed=text.includes(checks.containsText);
        output.push({name:"containsText",passed,expected:checks.containsText,actual:passed,
          detail:passed?"Required text was found":"Required text was not found"});
      }catch{
        unsupported.push("containsText (Artifact is not valid UTF-8 text)");
      }
    }
  }
  return {checks:output,unsupported};
}

export function passedArtifactValidationChecksMatch(
  checks:ValidationResult["checks"],bytes:ArrayBuffer,mimeType:string,digest:string,
){
  if(!checks.length||checks.some((check)=>!check.passed))return false;
  const requested:Record<string,unknown>={};
  for(const check of checks){
    if(Object.hasOwn(requested,check.name))return false;
    requested[check.name]=check.expected;
  }
  const parsed=ArtifactValidationChecksSchema.safeParse(requested);
  if(!parsed.success)return false;
  const rerun=evaluateArtifactValidationChecks(parsed.data,bytes,mimeType,digest);
  if(rerun.unsupported.length||rerun.checks.length!==checks.length)return false;
  return checks.every((check)=>{
    const observed=rerun.checks.find((item)=>item.name===check.name);
    return observed?.passed===true&&Object.is(observed.expected,check.expected)
      &&Object.is(observed.actual,check.actual);
  });
}

export function canAcceptValidatedArtifact(validation:Pick<ValidationResult,
  "status"|"artifactId"|"artifactSha256"|"checks">){
  return validation.status==="passed"&&Boolean(validation.artifactId&&validation.artifactSha256)
    &&validation.checks.length>0&&validation.checks.every((check)=>check.passed);
}
