import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { IntakeAiResultSchema } from "@/features/evolve/ai/schemas";
import { getAiProviderStatus, runEvolveAi } from "@/features/evolve/ai/service";
import { uploadOpenAIUserFile } from "@/features/evolve/ai/openai-provider";
import { ArtifactRoleSchema, SourceArtifactSchema, type ArtifactRole, type SourceArtifact } from "@/features/evolve/schemas";
import { extractSource } from "@/features/evolve/sources/extract";

export const runtime = "nodejs";

const MAX_FILES = 12;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_TEXT_CHARS = 100_000;
const OPENAI_FILE_EXTENSIONS = new Set(["pdf","doc","docx","rtf","odt","ppt","pptx","xls","xlsx","csv","tsv","txt","md","json","html","xml"]);

function extension(name: string) {
  const value = name.split(".").pop()?.toLowerCase();
  return value && value !== name.toLowerCase() ? value : "";
}
function artifactId(index: number) { return `artifact-${Date.now()}-${index + 1}`; }
function isImage(file: File) { return file.type.startsWith("image/"); }
function imageDataUrl(file: File, buffer: Buffer) { return `data:${file.type || "image/png"};base64,${buffer.toString("base64")}`; }
function parseRoles(raw: FormDataEntryValue | null, count: number): ArtifactRole[] {
  try {
    const value = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(value)) throw new Error("invalid roles");
    return Array.from({ length: count }, (_, i) => ArtifactRoleSchema.catch("target").parse(value[i] ?? (i === 0 ? "target" : "reference")));
  } catch {
    return Array.from({ length: count }, (_, i) => i === 0 ? "target" : "reference");
  }
}
async function persistLocal(id: string, name: string, buffer: Buffer) {
  if (process.env.EVOLVE_LOCAL_FILE_STORAGE === "0") return undefined;
  const safe = name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, "_").slice(0, 150);
  const dir = path.join(process.cwd(), ".evolve-data", "uploads", id);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, safe);
  await writeFile(target, buffer);
  return `local:${path.relative(process.cwd(), target)}`;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const command = String(form.get("command") || "").trim();
    const pastedText = String(form.get("pastedText") || "").trim();
    const department = String(form.get("department") || "其他");
    const requestedObjectType = String(form.get("requestedObjectType") || "auto");
    const conversation = String(form.get("conversation") || "").trim();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);

    if (!command && !pastedText && files.length === 0) throw new Error("请上传需要进化的内容，并告诉 AI 你希望怎么进化");
    if (files.length > MAX_FILES) throw new Error(`单次最多上传 ${MAX_FILES} 个附件`);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("附件总大小不能超过 60MB");
    for (const file of files) if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} 超过单文件 25MB 限制`);

    const roles = parseRoles(form.get("roles"), files.length);
    const aiStatus = getAiProviderStatus();
    const artifacts: SourceArtifact[] = [];
    const fileIds: string[] = [];
    const imageDataUrls: string[] = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]!;
      const id = artifactId(i);
      const ext = extension(file.name);
      const role = roles[i] ?? (i === 0 ? "target" : "reference");
      const buffer = Buffer.from(await file.arrayBuffer());
      const extracted = await extractSource({ name: file.name, mimeType: file.type || "application/octet-stream", buffer });
      const storageRef = await persistLocal(id, file.name, buffer);
      let openaiFileId: string | undefined;
      const warnings = [...extracted.warnings];

      if (isImage(file) && file.size <= 8 * 1024 * 1024 && aiStatus.live) imageDataUrls.push(imageDataUrl(file, buffer));
      if ((OPENAI_FILE_EXTENSIONS.has(ext) || (!extracted.extractedText && !isImage(file))) && aiStatus.live) {
        try {
          openaiFileId = await uploadOpenAIUserFile(file);
          fileIds.push(openaiFileId);
        } catch (error) {
          warnings.push(`OpenAI 文件输入上传失败：${error instanceof Error ? error.message : "unknown error"}`);
        }
      }

      const parseStatus = isImage(file) ? "image" : extracted.extractedText ? "ready" : openaiFileId ? "ai-file" : "binary";
      artifacts.push(SourceArtifactSchema.parse({
        id, name: file.name, role, mimeType: file.type || "application/octet-stream", size: file.size,
        extension: ext, inputMode: "upload", parseStatus,
        textContent: extracted.extractedText?.slice(0, MAX_TEXT_CHARS),
        textExcerpt: extracted.excerpt || (isImage(file) ? `[图片附件] ${file.name}` : `[附件] ${file.name}`),
        openaiFileId, storageRef, structure: extracted.structure, warnings, createdAt: new Date().toISOString(),
      }));
    }

    if (pastedText) {
      artifacts.push(SourceArtifactSchema.parse({
        id: `artifact-paste-${Date.now()}`, name: "粘贴内容.txt",
        role: artifacts.some((a) => a.role === "target") ? "reference" : "target",
        mimeType: "text/plain", size: Buffer.byteLength(pastedText, "utf8"), extension: "txt", inputMode: "paste", parseStatus: "ready",
        textContent: pastedText.slice(0, MAX_TEXT_CHARS), textExcerpt: pastedText.slice(0, 2800), createdAt: new Date().toISOString(),
      }));
    }

    if (artifacts.length === 0) {
      artifacts.push(SourceArtifactSchema.parse({
        id: `artifact-command-${Date.now()}`, name: "用户命令.txt", role: "target", mimeType: "text/plain",
        size: Buffer.byteLength(command, "utf8"), extension: "txt", inputMode: "paste", parseStatus: "ready",
        textContent: command, textExcerpt: command, createdAt: new Date().toISOString(),
      }));
    }

    const result = IntakeAiResultSchema.parse(await runEvolveAi("intake", {
      command, pastedText: pastedText.slice(0, 20_000), department, requestedObjectType, conversation,
      artifacts: artifacts.map(({ textContent, ...artifact }) => ({ ...artifact, textExcerpt: artifact.textExcerpt || textContent?.slice(0, 2800) })),
    }, { fileIds, imageDataUrls }));

    const summaryMap = new Map(result.artifactSummaries.map((item) => [item.artifactId, item]));
    const enriched = artifacts.map((artifact) => {
      const summary = summaryMap.get(artifact.id);
      return SourceArtifactSchema.parse({ ...artifact, summary: summary?.summary, role: summary?.detectedRole ?? artifact.role });
    });

    return NextResponse.json({ ok: true, provider: aiStatus, artifacts: enriched, intake: result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: { code: "INTAKE_FAILED", message: error instanceof Error ? error.message : "Unknown intake error" } }, { status: 400 });
  }
}
