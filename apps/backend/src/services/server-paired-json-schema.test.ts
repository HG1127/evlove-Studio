// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {z} from "zod";
import {pairedEvaluationJsonSchema} from "@evolution/contracts";
import {pairedJudgeRawEvaluation} from "@evolution/testkit";
import {serverAiPairedContract} from "./server-paired-ai-contract";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";

const payload=()=>({schemaVersion:"paired-judge-input-v1",requestFingerprint:"issued-request:0",
  acceptanceRubric:[{id:"GOAL"},{id:"CROSS"}],testCases:[{id:"V1",criterionIds:["GOAL"]},{id:"V2",criterionIds:["GOAL","CROSS"]}],
  issuedCriterionCaseBindings:[{criterionId:"GOAL",testCaseIds:["V1","V2"]},{criterionId:"CROSS",testCaseIds:["V2"]}]});
function reply(){
  const result=pairedJudgeRawEvaluation(80);result.criteria[0]!.testCaseIds=["V2","V1"];
  result.criteria.push({...structuredClone(result.criteria[0]!),criterionId:"CROSS",testCaseIds:["V2"]});
  return {schemaVersion:"paired-evaluation-v1",requestFingerprint:"issued-request:0",versions:["A","B","C"].map(slot=>({slot,result:structuredClone(result)}))};
}
const decode=(schema:unknown)=>z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
afterEach(()=>vi.unstubAllGlobals());

describe("issued paired generation schema",()=>{
  it("accepts all issued IDs in any order without changing valid negative scores or Safety",()=>{
    const contract=serverAiPairedContract(payload()),value=reply();
    value.versions[1]!.result.safety="FAIL";
    expect(decode(contract.schema.schema).safeParse(value).success).toBe(true);
    expect(contract.parser.parse(value)).toEqual(value);
    expect(value.versions[1]!.result.criteria[0]).toMatchObject({score:80,pass:false,testCaseIds:["V2","V1"]});
  });
  it.each(["invented-alias","wrong-criterion-case","missing-issued-case","wrong-fingerprint"])("rejects %s in generation guidance and still rejects it at the authoritative parser",kind=>{
    const value=reply(),contract=serverAiPairedContract(payload());
    if(kind==="invented-alias")value.versions[0]!.result.criteria[1]!.testCaseIds=["V2","INVENTED-CROSS-CASE"];
    if(kind==="wrong-criterion-case")value.versions[0]!.result.criteria[1]!.testCaseIds=["V1"];
    if(kind==="missing-issued-case")value.versions[0]!.result.criteria[0]!.testCaseIds=["V1"];
    if(kind==="wrong-fingerprint")value.requestFingerprint="other-request:0";
    expect(decode(pairedEvaluationJsonSchema.schema).safeParse(value).success).toBe(true);
    expect(decode(contract.schema.schema).safeParse(value).success).toBe(false);
    expect(contract.parser.safeParse(value).success).toBe(false);
  });
  it("keeps duplicate case IDs inadmissible even though the independent JSON Schema converter does not implement uniqueItems",()=>{
    const contract=serverAiPairedContract(payload()),value=reply();value.versions[0]!.result.criteria[0]!.testCaseIds=["V1","V1"];
    expect(contract.parser.safeParse(value).success).toBe(false);
  });
  it("does not mutate the shared legacy schema or another issued request",()=>{
    const original=JSON.stringify(pairedEvaluationJsonSchema),first=serverAiPairedContract(payload()),other=payload();
    other.requestFingerprint="different-request:1";other.testCases[0]!.id="H1";other.issuedCriterionCaseBindings[0]!.testCaseIds=["H1","V2"];
    const second=serverAiPairedContract(other);
    expect(decode(first.schema.schema).safeParse(reply()).success).toBe(true);
    expect(decode(second.schema.schema).safeParse(reply()).success).toBe(false);
    expect(JSON.stringify(pairedEvaluationJsonSchema)).toBe(original);
    expect(serverAiPairedContract({legacy:true}).schema).toBe(pairedEvaluationJsonSchema);
  });
  it.each(["chat-completions","responses"] as const)("sends the bound schema through all existing %s output modes with one physical request",async protocol=>{
    for(const responseFormat of ["prompt-json","json-object","json-schema"] as const){
      const value=reply(),input=payload(),before=JSON.stringify(input);
      const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
        const body=JSON.parse(String(init?.body));
        const system=protocol==="responses"?body.input[0].content[0].text:body.messages[0].content;
        expect(JSON.parse(protocol==="responses"?body.input[1].content[0].text:body.messages[1].content)).toEqual(input);
        const schema=responseFormat==="json-schema"?(protocol==="responses"?body.text.format.schema:body.response_format.json_schema.schema)
          :JSON.parse(system.split("Return JSON matching this exact schema:\n")[1]);
        const validator=decode(schema),bad=structuredClone(value);bad.versions[0]!.result.criteria[1]!.testCaseIds=["V1"];
        expect(validator.safeParse(value).success).toBe(true);expect(validator.safeParse(bad).success).toBe(false);
        return new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:JSON.stringify(value)}:{choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]}),{status:200});
      });vi.stubGlobal("fetch",fetch);
      const result=await withExplicitServerAiConnection({connectionId:"synthetic",label:"Synthetic",apiKey:"synthetic-key",baseUrl:"https://paired-schema.example.test/v1",model:"synthetic-model",protocol,responseFormat},()=>runServerAi("evaluate-paired",input));
      expect(result).toEqual(value);expect(fetch).toHaveBeenCalledOnce();expect(JSON.stringify(input)).toBe(before);
    }
  });
});
