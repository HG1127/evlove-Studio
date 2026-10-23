// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {serverAiRepairContract} from "./server-ai-repair-contract";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";

const scope={failedCriteria:[{criterionId:"AC-REFINE-DETAIL",requirement:"完整细化配置"}]};
const result={summary:"细化配置",artifacts:[{sourceArtifactId:"source",name:"file.html",mimeType:"text/html",content:'{}',notes:[]}],repairedCriteria:["AC-REFINE-DETAIL"]};
afterEach(()=>vi.unstubAllGlobals());
describe("request-bound repair criteria",()=>{
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
