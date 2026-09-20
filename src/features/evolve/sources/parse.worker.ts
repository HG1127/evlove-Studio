import { extractSource, setPdfTextBridge } from "./extract";

let nextPdf = 0;
const pdfJobs = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
setPdfTextBridge(buffer => new Promise((resolve, reject) => {
  const id = ++nextPdf;
  pdfJobs.set(id, { resolve, reject });
  const bytes = new Uint8Array(buffer);
  self.postMessage({ kind: "pdf", id, buffer: bytes }, { transfer: [bytes.buffer] });
}));

self.onmessage = async (event: MessageEvent<({ kind: "parse" } & Parameters<typeof extractSource>[0]) | {kind:"pdf-result";id:number;text?:string;error?:string}>) => {
  if (event.data.kind === "pdf-result") {
    const job = pdfJobs.get(event.data.id); pdfJobs.delete(event.data.id);
    if (event.data.error) job?.reject(new Error(event.data.error)); else job?.resolve(event.data.text ?? "");
    return;
  }
  try {
    const parsed = await extractSource(event.data);
    // Measure off the UI thread. Huge derived indexes remain usable, but are not cached.
    const cacheable = Boolean(parsed.extractedText) && !parsed.warnings.some(warning => /失败|超时|未能|损坏/.test(warning)) && JSON.stringify(parsed).length <= 4_000_000;
    self.postMessage({ kind: "done", ok: true, parsed, cacheable });
  } catch (error) {
    self.postMessage({ kind: "done", ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
