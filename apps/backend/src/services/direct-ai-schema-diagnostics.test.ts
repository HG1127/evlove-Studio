import {describe,expect,it} from "vitest";
import {directAiSchemaDiagnostics,directAiCorrectionDiagnosticSuffix} from "./direct-ai-schema-diagnostics";
describe("bounded local schema diagnostic fields",()=>{
  const schema={properties:{criteria:{items:{properties:{score:{},criterionId:{}}}}}};
  it("preserves schema fields and removes indexes, messages and unknown keys",()=>{
    expect(directAiSchemaDiagnostics(schema,[{path:["criteria",123,"score"],code:"invalid_type"},{path:["private-user-id"],code:"private-error"}])).toEqual([{path:"criteria.[].score",code:"invalid_type"},{path:"<field>",code:"schema-rejected"}]);
  });
  it("limits issue records to four and retains no rejected values",()=>{
    const issues=Array.from({length:8},()=>({path:["criteria",0,"score"],code:"invalid_type",message:"private marker",received:"private value"}));
    const rows=directAiSchemaDiagnostics(schema,issues);expect(rows).toHaveLength(4);expect(JSON.stringify(rows)).not.toContain("private");
  });
  it.each([undefined,NaN,99,600,400.5])("does not include invalid HTTP status %s",httpStatus=>{
    expect(directAiCorrectionDiagnosticSuffix({code:"private-marker",httpStatus})).toBe(" [phase=correction; code=AI_OUTPUT_CORRECTION_FAILED]");
  });
  it("records HTTP 400 using the fixed schema code",()=>{
    expect(directAiCorrectionDiagnosticSuffix({code:"AI_OUTPUT_SCHEMA_MISMATCH",httpStatus:400,schemaIssues:[{path:"criteria.[].score",code:"invalid_type"}]})).toContain("HTTP=400; schema=criteria.[].score:invalid_type");
  });
});
