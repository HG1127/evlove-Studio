import JSZip, { type JSZipObject } from "jszip";

const MAX_ARCHIVE_BYTES = 25_000_000;
const MAX_ARCHIVE_FILES = 2_000;
const MAX_TEXT_FILE_BYTES = 250_000;
const MAX_INDEX_BYTES = 8_000_000;
const TEXT_PATH = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|php|vue|svelte|sql|css|json|ya?ml|md|mdx)$/i;
const CODE_PATH = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|php|vue|svelte|sql)$/i;
const IGNORED_PATH = /(^|\/)(?:node_modules|\.git|dist|build|coverage|vendor|\.next)\//i;

export type IndexedCodebaseFile = { path: string; content: string; code: boolean };
export type ServerCodebaseZipIndex = { fileCount: number; textFiles: IndexedCodebaseFile[] };
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safePath(path: string) {
  return Boolean(path) && !path.startsWith("/") && !/[\\:]/.test(path)
    && [...path].every((char) => char.charCodeAt(0) >= 32)
    && path.split("/").every((part) => Boolean(part) && part !== "." && part !== "..");
}

export function codebaseQueryTerms(query: string) {
  return [...new Set(query.toLowerCase().match(/[a-z][a-z0-9_-]{3,}|\p{Script=Han}{2,}/gu) ?? [])]
    .filter((term) => !["check", "implementation", "project", "source", "codebase", "candidate"].includes(term)).slice(0, 40);
}

/** Strict index of persisted ZIP bytes; every indexed file is fully decoded before selection. */
export async function indexServerCodebaseZip(bytes: Uint8Array): Promise<ServerCodebaseZipIndex> {
  if (!bytes.byteLength || bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("代码 ZIP 大小超出静态索引范围。");
  const zip = await JSZip.loadAsync(bytes);
  const files = (Object.values(zip.files) as JSZipObject[]).filter((entry) => !entry.dir);
  if (!files.length || files.length > MAX_ARCHIVE_FILES) throw new Error("代码包文件数量超出静态索引范围。");
  const textFiles: IndexedCodebaseFile[] = [];
  let totalBytes = 0;
  for (const entry of files) {
    const path = entry.name;
    const original = (entry as JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    if (!safePath(path) || (original && !safePath(original))) throw new Error("代码包含不安全的文件路径。");
    if (IGNORED_PATH.test(path) || !TEXT_PATH.test(path)) continue;
    const size = (entry as JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size! < 0 || size! > MAX_TEXT_FILE_BYTES || totalBytes + size! > MAX_INDEX_BYTES) {
      throw new Error("代码包文本索引超过安全大小上限，不能声称已检查完整源码。");
    }
    totalBytes += size!;
    const extracted = await entry.async("uint8array");
    if (extracted.byteLength !== size) throw new Error("代码包条目解压大小与索引元数据不一致。");
    const expectedCrc = (entry as JSZipObject & { _data?: { crc32?: number } })._data?.crc32;
    if (!Number.isInteger(expectedCrc) || crc32(extracted) !== (expectedCrc! >>> 0)) throw new Error("代码包文本条目 CRC32 不一致。");
    const content = new TextDecoder("utf-8", { fatal: true }).decode(extracted);
    const code = CODE_PATH.test(path) && !/(^|\/)(?:test|tests|e2e|fixtures|__tests__)(\/|$)|\.(?:test|spec)\.[^.]+$/i.test(path);
    textFiles.push({ path, content, code });
  }
  return { fileCount: files.length, textFiles };
}

export function rankServerCodebaseFiles(index: ServerCodebaseZipIndex, query: string) {
  const terms = codebaseQueryTerms(query);
  return index.textFiles.map((file) => {
    const path = file.path.toLowerCase();
    const content = file.content.toLowerCase();
    const score = terms.reduce((value, term) => value + (path.includes(term) ? 3 : 0) + (content.includes(term) ? 1 : 0), 0);
    return { ...file, score };
  }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}