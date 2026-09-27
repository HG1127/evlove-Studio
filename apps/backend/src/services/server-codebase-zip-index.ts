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
export function serverZipCrc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function safeServerZipPath(path: string) {
  return Boolean(path) && !path.startsWith("/") && !/[\\:]/.test(path)
    && [...path].every((char) => char.charCodeAt(0) >= 32)
    && path.split("/").every((part) => Boolean(part) && part !== "." && part !== "..");
}

/** Reject oversized or unsupported central directories before JSZip allocates entries. */
export function assertServerZipEntryBudget(bytes: Uint8Array, maxEntries = MAX_ARCHIVE_FILES) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const earliest = Math.max(0, bytes.byteLength - 22 - 65_535);
  for (let offset = bytes.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    if (offset + 22 + view.getUint16(offset + 20, true) !== bytes.byteLength) continue;
    const disk = view.getUint16(offset + 4, true);
    const startDisk = view.getUint16(offset + 6, true);
    const onDisk = view.getUint16(offset + 8, true);
    const total = view.getUint16(offset + 10, true);
    const centralSize = view.getUint32(offset + 12, true);
    const centralOffset = view.getUint32(offset + 16, true);
    if (disk || startDisk || total === 0xffff || onDisk !== total
      || !total || total > maxEntries || centralOffset + centralSize > offset) {
      throw new Error("ZIP 文件数量或中央目录超出安全索引范围。");
    }
    return total;
  }
  throw new Error("ZIP 中央目录不存在或不完整。");
}
export function codebaseQueryTerms(query: string) {
  return [...new Set(query.toLowerCase().match(/[a-z][a-z0-9_-]{3,}|\p{Script=Han}{2,}/gu) ?? [])]
    .filter((term) => !["check", "implementation", "project", "source", "codebase", "candidate"].includes(term)).slice(0, 40);
}

/** Strict index of persisted ZIP bytes; every indexed file is fully decoded before selection. */
export async function indexServerCodebaseZip(bytes: Uint8Array): Promise<ServerCodebaseZipIndex> {
  if (!bytes.byteLength || bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("代码 ZIP 大小超出静态索引范围。");
  assertServerZipEntryBudget(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const files = (Object.values(zip.files) as JSZipObject[]).filter((entry) => !entry.dir);
  if (!files.length || files.length > MAX_ARCHIVE_FILES) throw new Error("代码包文件数量超出静态索引范围。");
  const textFiles: IndexedCodebaseFile[] = [];
  let totalBytes = 0;
  for (const entry of files) {
    const path = entry.name;
    const original = (entry as JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    if (!safeServerZipPath(path) || (original && !safeServerZipPath(original))) throw new Error("代码包含不安全的文件路径。");
    if (IGNORED_PATH.test(path) || !TEXT_PATH.test(path)) continue;
    const size = (entry as JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size! < 0 || size! > MAX_TEXT_FILE_BYTES || totalBytes + size! > MAX_INDEX_BYTES) {
      throw new Error("代码包文本索引超过安全大小上限，不能声称已检查完整源码。");
    }
    totalBytes += size!;
    const extracted = await entry.async("uint8array");
    if (extracted.byteLength !== size) throw new Error("代码包条目解压大小与索引元数据不一致。");
    const expectedCrc = (entry as JSZipObject & { _data?: { crc32?: number } })._data?.crc32;
    if (!Number.isInteger(expectedCrc) || serverZipCrc32(extracted) !== (expectedCrc! >>> 0)) throw new Error("代码包文本条目 CRC32 不一致。");
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