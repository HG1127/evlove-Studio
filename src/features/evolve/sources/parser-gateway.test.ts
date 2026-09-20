import { describe, expect, it } from "vitest";
import { parserRoutePlan, type ParserGatewayConfig } from "./parser-gateway";

const config: ParserGatewayConfig = {
  enabled:true, kind:"auto", endpoint:"", timeoutMs:90000, preferFor:[],
  services:{
    docling:{enabled:true,endpoint:"http://docling/v1/convert/file",timeoutMs:90000},
    unstructured:{enabled:true,endpoint:"http://unstructured/general/v0/general",timeoutMs:90000},
    tika:{enabled:true,endpoint:"http://tika:9998",timeoutMs:90000},
    custom:{enabled:false,endpoint:"",timeoutMs:90000},
  },
};
describe("parser router",()=>{
  it("keeps code and zip local",()=>{
    expect(parserRoutePlan("app.zip","application/zip",config)).toEqual([]);
    expect(parserRoutePlan("main.tsx","text/plain",config)).toEqual([]);
  });
  it("routes office through structured parsers before Tika",()=>{
    expect(parserRoutePlan("deck.pptx","application/vnd.openxmlformats-officedocument.presentationml.presentation",config)).toEqual(["docling","unstructured","tika"]);
  });
  it("routes scanned images to Unstructured before Tika",()=>{
    expect(parserRoutePlan("scan.png","image/png",config)).toEqual(["unstructured","tika"]);
  });
});
