import {describe,expect,it} from "vitest";
import type {SourceArtifact} from "@evolution/contracts";
import {sourceParseLabel,sourceParseState} from "./source-parse-presentation";

function artifact(parseStatus:SourceArtifact["parseStatus"],warnings:string[]=[],completeness?:number){
  return {parseStatus,warnings,parsingProfile:completeness===undefined?undefined:{completeness}} as SourceArtifact;
}

describe("Source parse presentation",()=>{
  it("shows unsupported, binary, and error results as failed",()=>{
    for(const status of ["unsupported","binary","error"] as const){
      expect(sourceParseState(artifact(status))).toBe("failed");
      expect(sourceParseLabel(artifact(status))).toBe("解析异常");
    }
  });
  it("shows bounded or approximate ready text as partial",()=>{
    expect(sourceParseState(artifact("ready",["仅建立有界文本预览"]))).toBe("partial");
    expect(sourceParseLabel(artifact("ready",[],0.5))).toBe("部分解析");
  });
  it("keeps complete text and accepted image states distinct",()=>{
    expect(sourceParseLabel(artifact("ready",[],1))).toBe("已解析");
    expect(sourceParseLabel(artifact("image"))).toBe("图片已接收");
  });
});