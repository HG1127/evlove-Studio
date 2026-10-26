// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {serverAiRepairContract} from "./server-ai-repair-contract";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";

const scope={failedCriteria:[{criterionId:"AC-REFINE-DETAIL",requirement:"完整细化配置"}]};
const result={summary:"细化配置",artifacts:[{sourceArtifactId:"source",name:"file.html",mimeType:"text/html",content:'{}',notes:[]}],repairedCriteria:["AC-REFINE-DETAIL"]};
const anchorId="t17qe_17qt-eb096af64ddfe3f2";
const bodyScope={...scope,project:{name:"Real repair payload shape"},candidate:{artifacts:[{sourceArtifactId:"source",mutationMode:"html-body-node-edits-v1",htmlTextNodes:[{anchorId}]}]}};
const bodyResult=(id=anchorId)=>({...result,artifacts:[{...result.artifacts[0]!,content:JSON.stringify({kind:"html-body-node-edits-v1",edits:[{anchorId:id,text:"完整配置说明"}]})}]});
afterEach(()=>vi.unstubAllGlobals());
describe("request-bound repair criteria",()=>{
  it("rejects a mistyped physical anchor inside otherwise valid repair JSON",()=>{
    const contract=serverAiRepairContract(bodyScope);
    expect(contract.parser.safeParse(bodyResult("t17qe_17qt-eb096af64dfe3f2")).success).toBe(false);
    expect(contract.parser.parse(bodyResult())).toEqual(bodyResult());
    const duplicated=bodyResult();const content=JSON.parse(duplicated.artifacts[0]!.content);content.edits.push(content.edits[0]);
    duplicated.artifacts[0]!.content=JSON.stringify(content);
    expect(contract.parser.safeParse(duplicated).success).toBe(false);
  });
  it("uses only the existing single schema correction for an unknown body anchor",async()=>{
    const requests:Array<{messages:Array<{content:string}>}>=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(requests.length===1?bodyResult("t17qe_17qt-eb096af64dfe3f2"):bodyResult())}}]}),{status:200});
    }));
    const actual=await withExplicitServerAiConnection({connectionId:"repair-test",label:"Test",apiKey:"test-private-key",baseUrl:"https://repair.example.test/v1",model:"test-model",protocol:"chat-completions",responseFormat:"json-object"},()=>runServerAi("repair-artifact",bodyScope));
    expect(actual).toEqual(bodyResult());expect(requests).toHaveLength(2);
    expect(requests[1]!.messages[0]!.content).toContain("anchor");
  });
  it("stops after the existing one correction and never accepts a guessed anchor",async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(bodyResult("guessed-anchor"))}}]}),{status:200}));
    vi.stubGlobal("fetch",fetch);
    await expect(withExplicitServerAiConnection({connectionId:"repair-test",label:"Test",apiKey:"test-private-key",baseUrl:"https://repair.example.test/v1",model:"test-model",protocol:"chat-completions",responseFormat:"json-object"},()=>runServerAi("repair-artifact",bodyScope))).rejects.toMatchObject({code:"AI_OUTPUT_SCHEMA_MISMATCH"});
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects descriptions and preserved criteria instead of normalizing them into permitted IDs",()=>{
    const contract=serverAiRepairContract(scope);
    expect(contract.schema.schema.properties.repairedCriteria.items.enum).toEqual(["AC-REFINE-DETAIL"]);
    for(const ids of [[],["AC-REFINE-DETAIL：补强配置"],["AC-REFINE-DETAIL","SEM-CROSS-CONSISTENCY"]]){
      expect(contract.parser.safeParse({...result,repairedCriteria:ids}).success).toBe(false);
    }
    expect(contract.parser.parse(result)).toEqual(result);
    expect(()=>serverAiRepairContract({failedCriteria:[{criterionId:"A"},{criterionId:"A"}]})).toThrow(/duplicate/);
  });
  it("uses the existing single pre-write schema correction when the provider returns descriptive IDs",async()=>{
    const requests:Array<{messages:Array<{content:string}>}>=[];
    const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      requests.push(JSON.parse(String(init?.body)));
      const response=requests.length===1?{...result,repairedCriteria:["AC-REFINE-DETAIL：补强配置","SEM-CROSS-CONSISTENCY"]}:result;
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(response)}}]}),{status:200});
    });
    vi.stubGlobal("fetch",fetch);
    const actual=await withExplicitServerAiConnection({connectionId:"repair-test",label:"Test",apiKey:"test-private-key",baseUrl:"https://repair.example.test/v1",model:"test-model",protocol:"chat-completions",responseFormat:"json-object"},()=>runServerAi("repair-artifact",scope));
    expect(actual).toEqual(result);expect(fetch).toHaveBeenCalledTimes(2);
    expect(requests[0]!.messages[0]!.content).toContain('"enum":["AC-REFINE-DETAIL"]');
    expect(requests[1]!.messages[0]!.content).toContain("repairedCriteria");
  });
});
