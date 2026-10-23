import {describe,expect,it} from "vitest";
import {requiresIndependentFormatValidation} from "./format-roundtrip-policy";

describe("roundtrip proof policy",()=>{
  it("requires native checks for all structured binary and delimited formats",()=>{
    for(const ext of ["docx","pptx","xlsx","xls","ods","csv","tsv","zip","pdf","png","mp4","unknown"]){
      expect(requiresIndependentFormatValidation(ext),ext).toBe(true);
    }
  });
  it("only pure text can be proven by exact UTF-8 byte roundtrip",()=>{
    for(const ext of ["md","TXT","html","ts","tsx","css","py","sh"]){
      expect(requiresIndependentFormatValidation(ext),ext).toBe(false);
    }
    for(const ext of ["json","jsonl","yaml","yml","xml","svg"]){
      expect(requiresIndependentFormatValidation(ext),ext).toBe(true);
    }
  });
});
