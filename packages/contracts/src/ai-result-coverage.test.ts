import {describe,expect,it} from "vitest";
import {AiOperationSchema,AiResultSchemas} from "./ai-schemas";

describe("AI result contracts",()=>{
  it("covers every supported server AI operation",()=>{
    expect(Object.keys(AiResultSchemas).sort()).toEqual([...AiOperationSchema.options].sort());
  });
});