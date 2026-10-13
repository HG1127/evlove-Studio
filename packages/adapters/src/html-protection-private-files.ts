import { constants } from "node:fs";
import { open, rename } from "node:fs/promises";

export class HtmlProtectionPrivateFileGap extends Error {
  readonly code = "runtime-integrity";
  constructor() { super("runtime-integrity"); }
}
/** Trusted fixed path only. Callers never forward a user/AI path or follow a link. */
export async function readOwnedHtmlProtectionPrivateFile(path: string, maximum: number) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat();
    if (!before.isFile() || before.size <= 0 || before.size > maximum) throw new HtmlProtectionPrivateFileGap();
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await fd.read(bytes, offset, bytes.byteLength - offset, offset);
      if (!result.bytesRead) throw new HtmlProtectionPrivateFileGap(); offset += result.bytesRead;
    }
    const after = await fd.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new HtmlProtectionPrivateFileGap();
    return bytes;
  } finally { await fd.close(); }
}
export async function writeOwnedHtmlProtectionPrivateFile(path: string, bytes: Uint8Array) {
  const temporary = path + ".tmp", fd = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
  await rename(temporary, path);
}