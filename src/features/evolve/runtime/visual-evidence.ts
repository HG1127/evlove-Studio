// 视觉 / UIUX 证据连接：浏览器截图 + Visual Judge 报告。
// 截图是用户提供的真实视觉证据；Judge 报告由已配置的视觉模型（或演示引擎，会显式标注）产出。
import type { VisualJudgeAiResult } from "../ai/schemas";
import { deleteArtifactBlob, getArtifactBlob, putArtifactBlob, putArtifactBlobs } from "./artifact-blob-store";

export type VisualEvidenceItem = {
  id: string;
  name: string;
  addedAt: string;
  dataUrl: string;
  artifactHash?:string;sourceArtifactId?:string;candidateId?:string;
  origin?: "upload" | "browser-auto";
};
export type VisualJudgeRecord = {
  report: VisualJudgeAiResult;
  engine: string;
  screenshotIds: string[];
  judgedAt: string;
  artifactHashes?:string[];
};
export type VisualEvidenceStore = {
  items: VisualEvidenceItem[];
  judge?: VisualJudgeRecord;
};

const KEY_PREFIX = "evolve-studio:visual-evidence:";
export const VISUAL_EVIDENCE_EVENT = "evolve-visual-evidence-changed";
const MAX_EDGE = 1280;
const MANIFEST_VERSION = 1;
const MEMORY = new Map<string, VisualEvidenceStore>();
const HYDRATING = new Map<string, Promise<VisualEvidenceStore>>();

type VisualEvidenceManifestItem = Omit<VisualEvidenceItem, "dataUrl"> & { blobId: string };
type VisualEvidenceManifest = {
  version: typeof MANIFEST_VERSION;
  savedAt: string;
  items: VisualEvidenceManifestItem[];
  judge?: VisualJudgeRecord;
};

function key(projectId: string) { return KEY_PREFIX + projectId; }
export function visualEvidenceManifestArtifactId(projectId: string) { return `visual-evidence:${projectId}:manifest:v1`; }
export function visualEvidenceScreenshotArtifactId(projectId: string, itemId: string) { return `visual-evidence:${projectId}:screenshot:${itemId}`; }
function cloneStore(store: VisualEvidenceStore) { return structuredClone(store); }

export function getVisualEvidence(projectId: string): VisualEvidenceStore {
  const memory = MEMORY.get(projectId);
  if (memory) return cloneStore(memory);
  try {
    const raw = window.localStorage.getItem(key(projectId));
    if (!raw) return { items: [] };
    const parsed = JSON.parse(raw) as VisualEvidenceStore;
    const store = { items: Array.isArray(parsed.items) ? parsed.items : [], judge: parsed.judge };
    MEMORY.set(projectId, cloneStore(store));
    return store;
  } catch { return { items: [] }; }
}

function saveLocalProjection(projectId: string, store: VisualEvidenceStore) {
  MEMORY.set(projectId, cloneStore(store));
  try { window.localStorage.setItem(key(projectId), JSON.stringify(store)); }
  catch { /* Artifact Store is authoritative; localStorage is only a synchronous browser projection. */ }
  window.dispatchEvent(new CustomEvent(VISUAL_EVIDENCE_EVENT, { detail: { projectId } }));
}

function manifestFor(projectId: string, store: VisualEvidenceStore): VisualEvidenceManifest {
  return {
    version: MANIFEST_VERSION,
    savedAt: new Date().toISOString(),
    items: store.items.map((item) => ({
      id:item.id,
      name:item.name,
      addedAt:item.addedAt,
      artifactHash:item.artifactHash,
      sourceArtifactId:item.sourceArtifactId,
      candidateId:item.candidateId,
      origin:item.origin,
      blobId: visualEvidenceScreenshotArtifactId(projectId, item.id),
    })),
    judge: store.judge,
  };
}

async function dataUrlBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error(`视觉证据图片读取失败：HTTP ${response.status}`);
  return response.blob();
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("视觉证据图片读取失败"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function persistVisualEvidence(projectId: string, store: VisualEvidenceStore, uploadScreenshots = true) {
  const manifest = manifestFor(projectId, store);
  if (uploadScreenshots) {
    const screenshots = await Promise.all(store.items.map(async (item) => ({
      id: visualEvidenceScreenshotArtifactId(projectId, item.id),
      blob: await dataUrlBlob(item.dataUrl),
    })));
    if (screenshots.length) await putArtifactBlobs(screenshots);
  }
  // Commit the manifest last so readers never observe references to screenshot blobs that have
  // not finished uploading yet. Removal paths can safely publish the smaller manifest first.
  await putArtifactBlob(
    visualEvidenceManifestArtifactId(projectId),
    new Blob([JSON.stringify(manifest)], { type: "application/json" }),
  );
}

async function readManifest(projectId: string): Promise<VisualEvidenceManifest | undefined> {
  const blob = await getArtifactBlob(visualEvidenceManifestArtifactId(projectId), { preferRemote: true });
  if (!blob) return undefined;
  try {
    const value = JSON.parse(await blob.text()) as VisualEvidenceManifest;
    if (value.version !== MANIFEST_VERSION || !Array.isArray(value.items)) return undefined;
    return value;
  } catch { return undefined; }
}

/**
 * Artifact Store is the durable source of truth. localStorage remains a synchronous UI projection.
 * Existing local-only screenshots are migrated once when no durable manifest exists.
 */
export async function hydrateVisualEvidence(projectId: string): Promise<VisualEvidenceStore> {
  const running = HYDRATING.get(projectId);
  if (running) return running;
  const task = (async () => {
    const local = getVisualEvidence(projectId);
    const manifest = await readManifest(projectId);
    if (!manifest) {
      if (local.items.length || local.judge) await persistVisualEvidence(projectId, local, true);
      return local;
    }
    const items = (await Promise.all(manifest.items.map(async (item): Promise<VisualEvidenceItem | undefined> => {
      const blob = await getArtifactBlob(item.blobId);
      if (!blob) return undefined;
      return {
        id:item.id,
        name:item.name,
        addedAt:item.addedAt,
        dataUrl:await blobDataUrl(blob),
        ...(item.artifactHash ? { artifactHash:item.artifactHash } : {}),
        ...(item.sourceArtifactId ? { sourceArtifactId:item.sourceArtifactId } : {}),
        ...(item.candidateId ? { candidateId:item.candidateId } : {}),
        ...(item.origin ? { origin:item.origin } : {}),
      };
    }))).filter((item): item is VisualEvidenceItem => item !== undefined);
    const ids = new Set(items.map((item) => item.id));
    const judge = manifest.judge && manifest.judge.screenshotIds.every((id) => ids.has(id)) ? manifest.judge : undefined;
    const restored: VisualEvidenceStore = { items, judge };
    saveLocalProjection(projectId, restored);
    return restored;
  })().finally(() => HYDRATING.delete(projectId));
  HYDRATING.set(projectId, task);
  return task;
}

/** 读入截图并压缩到可控尺寸，避免 localStorage 配额溢出。 */
function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(` ${file.name} 不是可识别的图片`));
      image.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(String(reader.result)); return; }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function addVisualEvidence(projectId: string, files: File[], binding?: {artifactHash:string;sourceArtifactId?:string;candidateId?:string;origin?:"upload"|"browser-auto"}): Promise<number> {
  const store = getVisualEvidence(projectId);
  const removedIds: string[] = [];
  // 后台浏览器复验同一成果时替换旧自动截图，避免每次进入页面都累计并触发 8 张上限。
  if (binding?.origin === "browser-auto") {
    store.items = store.items.filter((item) => {
      const remove = item.origin === "browser-auto" && item.sourceArtifactId === binding.sourceArtifactId && item.candidateId === binding.candidateId;
      if (remove) removedIds.push(item.id);
      return !remove;
    });
  }
  if(store.items.length+files.length>8) throw new Error("最多保存 8 张截图，请先移除不再使用的截图。");
  let added = 0;
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const dataUrl = await toDataUrl(file);
    store.items.push({ id: `${Date.now()}-${added}-${file.name}`, name: file.name, addedAt: new Date().toISOString(), dataUrl,...binding });
    added += 1;
  }
  if (added) {
    store.judge=undefined;
    await persistVisualEvidence(projectId, store, true);
    await Promise.all(removedIds.map((id) => deleteArtifactBlob(visualEvidenceScreenshotArtifactId(projectId, id))));
    saveLocalProjection(projectId, store);
  }
  return added;
}

export async function removeVisualEvidence(projectId: string, id: string) {
  const store = getVisualEvidence(projectId);
  store.items = store.items.filter((item) => item.id !== id);
  if (store.judge && store.judge.screenshotIds.includes(id)) store.judge = undefined;
  await persistVisualEvidence(projectId, store, false);
  await deleteArtifactBlob(visualEvidenceScreenshotArtifactId(projectId, id));
  saveLocalProjection(projectId, store);
}

export async function saveVisualJudge(projectId: string, record: VisualJudgeRecord) {
  const store = getVisualEvidence(projectId);
  if(record.screenshotIds.length!==store.items.length||record.screenshotIds.some(id=>!store.items.some(item=>item.id===id)))throw new Error("截图已变化，请重新评审");
  store.judge = record;
  await persistVisualEvidence(projectId, store, true);
  saveLocalProjection(projectId, store);
}
