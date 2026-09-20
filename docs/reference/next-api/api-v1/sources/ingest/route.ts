import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { SourceArtifactSchema, type ArtifactRole, type SourceArtifact } from "@/features/evolve/schemas";
import { extractSource } from "@/features/evolve/sources/extract";
import { uploadOpenAIUserFile } from "@/features/evolve/ai/openai-provider";

export const runtime = "nodejs";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, "_").slice(0, 140);
}

async function persistLocal(id: string, file: File, buffer: Buffer) {
  if (process.env.EVOLVE_LOCAL_FILE_STORAGE === "0") return undefined;
  const dir = path.join(process.cwd(), ".evolve-data", "uploads", id);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, safeName(file.name));
  await writeFile(target, buffer);
  return `local:${path.relative(process.cwd(), target)}`;
}

async function maybeUploadToOpenAI(file: File, shouldUpload: boolean) {
  if (!shouldUpload || !process.env.OPENAI_API_KEY) return undefined;
  try {
    return await uploadOpenAIUserFile(file);
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File).slice(0, MAX_FILES);
    const pastedText = String(form.get("text") ?? "").trim();
    const requestedRole = String(form.get("role") ?? "target") as ArtifactRole;
    const artifacts: SourceArtifact[] = [];

    for (const [index, file] of files.entries()) {
      if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} 超过单文件 12MB 限制`);
      const id = `artifact-${randomUUID()}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const extracted = await extractSource({ name: file.name, mimeType: file.type || "application/octet-stream", buffer });
      const role: ArtifactRole = index === 0 ? requestedRole : "reference";
      const needsAiFile = file.type.startsWith("image/") || file.type === "application/pdf" || !extracted.extractedText;
      const openaiFileId = await maybeUploadToOpenAI(file, needsAiFile);
      const storageRef = await persistLocal(id, file, buffer);
      const warnings = [...extracted.warnings];
      if (needsAiFile && process.env.OPENAI_API_KEY && !openaiFileId) warnings.push("OpenAI 文件上传失败；AI 将只能使用已解析文本或附件元数据。");
      if (needsAiFile && !process.env.OPENAI_API_KEY) warnings.push("未配置 OPENAI_API_KEY；图片/复杂二进制附件只能保存元数据，无法进入 AI 文件理解通道。");

      artifacts.push(SourceArtifactSchema.parse({
        id,
        name: file.name,
        role,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        extension: extracted.extension,
        inputMode: "upload",
        parseStatus: file.type.startsWith("image/") ? "image" : openaiFileId ? "ai-file" : extracted.extractedText ? "ready" : "binary",
        textContent: extracted.extractedText,
        textExcerpt: extracted.excerpt,
        openaiFileId,
        storageRef,
        structure: extracted.structure,
        warnings,
        createdAt: new Date().toISOString(),
      }));
    }

    if (pastedText) {
      artifacts.push(SourceArtifactSchema.parse({
        id: `artifact-${randomUUID()}`,
        name: files.length ? "补充粘贴内容" : "粘贴内容",
        role: files.length ? "reference" : requestedRole,
        mimeType: "text/plain",
        size: Buffer.byteLength(pastedText, "utf8"),
        extension: "txt",
        inputMode: "paste",
        parseStatus: "ready",
        textContent: pastedText.slice(0, 60000),
        textExcerpt: pastedText.slice(0, 1200),
        warnings: pastedText.length > 60000 ? ["粘贴内容超过 60,000 字符，进入 AI 上下文的部分已截断。"] : [],
        createdAt: new Date().toISOString(),
      }));
    }

    if (artifacts.length === 0) throw new Error("请至少上传一个附件或粘贴一段待进化内容");
    return NextResponse.json({ ok: true, artifacts });
  } catch (error) {
    return NextResponse.json({ ok: false, error: { code: "SOURCE_INGEST_FAILED", message: error instanceof Error ? error.message : "Unknown ingest error" } }, { status: 400 });
  }
}
