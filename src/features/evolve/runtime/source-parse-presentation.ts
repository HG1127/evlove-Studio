import type { SourceArtifact } from "@evolution/contracts";

type ParsePresentationArtifact = Pick<SourceArtifact,"parseStatus"|"warnings"|"parsingProfile">;

export type SourceParseState = "ready" | "partial" | "failed";

export function sourceParseState(artifact: ParsePresentationArtifact): SourceParseState {
  if (["binary", "unsupported", "error"].includes(artifact.parseStatus)) return "failed";
  if (artifact.warnings.length > 0) return "partial";
  if (artifact.parseStatus !== "image" && artifact.parsingProfile && artifact.parsingProfile.completeness < 0.999) return "partial";
  return "ready";
}

export function sourceParseLabel(artifact: ParsePresentationArtifact): string {
  const state=sourceParseState(artifact);
  if(state==="failed")return "解析异常";
  if(state==="partial")return "部分解析";
  if(artifact.parseStatus==="image")return "图片已接收";
  if(artifact.parseStatus==="ai-file")return "文件已接收";
  return "已解析";
}