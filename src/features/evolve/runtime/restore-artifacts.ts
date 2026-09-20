import type { EvolveProject, EvolvedVersion, SourceArtifact } from "../schemas";
import { extractSource } from "../sources/source-loader";
import { getArtifactBlob, putArtifactBlobs } from "./artifact-blob-store";
import { freezeArtifact, readFrozenArtifact } from "./frozen-artifact";

export async function restoreVersionArtifacts(project: EvolveProject, version: EvolvedVersion) {
  const restored = new Map<string,SourceArtifact>();
  const writes: Array<{id:string;blob:Blob}> = [];
  const backups: EvolvedVersion["artifacts"] = [];
  for (const source of project.sourceArtifacts.filter((a) => a.role === "target")) {
    const snapshot = version.artifacts.find((a) => a.sourceArtifactId === source.id);
    if (!snapshot) throw new Error(`${version.label} 缺少 ${source.name}，无法完整恢复。`);
    const blob = snapshot.frozenArtifact ? await readFrozenArtifact(snapshot.frozenArtifact,snapshot.content)
      : ["md","txt","html","json","yaml","yml","csv","tsv"].includes(source.extension.toLowerCase()) ? new Blob([snapshot.content],{type:source.mimeType}) : undefined;
    if (!blob) throw new Error(`${source.name} 的历史记录没有原格式文件，请下载并重新接入可验证的版本。`);
    const parsed = await extractSource({name:source.name,mimeType:source.mimeType,buffer:new Uint8Array(await blob.arrayBuffer())});
    if (!parsed.extractedText && !parsed.structuredContent) throw new Error(`无法重新读取恢复文件：${source.name}`);
    restored.set(source.id,{...source,artifactKind:parsed.artifactKind,artifactDescriptor:parsed.artifactDescriptor,
      parseStatus:"ready",textContent:parsed.extractedText,textExcerpt:parsed.excerpt,structure:parsed.structure,
      structuredContent:parsed.structuredContent,parsingProfile:parsed.parsingProfile,warnings:parsed.warnings,
      extension:parsed.extension || source.extension,size:blob.size,openaiFileId:undefined,storageRef:undefined});
    writes.push({id:source.id,blob});
    const original = await getArtifactBlob(source.id);
    if (!original) throw new Error(`原文件 ${source.name} 不可用，无法建立回滚前备份。`);
    const content = source.textContent || source.textExcerpt || "";
    const frozenArtifact = await freezeArtifact({sourceArtifactId:source.id,content,blob:original,name:source.name,checks:["回滚前原文件字节备份"],limitations:["这是恢复备份，不是新一轮效果验收。"]});
    backups.push({id:`backup-${source.id}-${Date.now()}`,name:source.name,sourceArtifactId:source.id,content,frozenArtifact});
  }
  // No source bytes are overwritten until every file was read and backed up.
  await putArtifactBlobs(writes);
  return {sources:project.sourceArtifacts.map((s) => restored.get(s.id) ?? s),backups};
}
