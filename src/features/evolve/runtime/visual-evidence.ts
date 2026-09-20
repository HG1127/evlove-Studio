// 视觉 / UIUX 证据连接：浏览器截图 + Visual Judge 报告。
// 截图是用户提供的真实视觉证据；Judge 报告由已配置的视觉模型（或演示引擎，会显式标注）产出。
import type { VisualJudgeAiResult } from "../ai/schemas";

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

function key(projectId: string) { return KEY_PREFIX + projectId; }

export function getVisualEvidence(projectId: string): VisualEvidenceStore {
  try {
    const raw = window.localStorage.getItem(key(projectId));
    if (!raw) return { items: [] };
    const parsed = JSON.parse(raw) as VisualEvidenceStore;
    return { items: Array.isArray(parsed.items) ? parsed.items : [], judge: parsed.judge };
  } catch { return { items: [] }; }
}

function save(projectId: string, store: VisualEvidenceStore) {
  window.localStorage.setItem(key(projectId), JSON.stringify(store));
  window.dispatchEvent(new CustomEvent(VISUAL_EVIDENCE_EVENT, { detail: { projectId } }));
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
  // 后台浏览器复验同一成果时替换旧自动截图，避免每次进入页面都累计并触发 8 张上限。
  if (binding?.origin === "browser-auto") {
    store.items = store.items.filter((item) => !(item.origin === "browser-auto" && item.sourceArtifactId === binding.sourceArtifactId && item.candidateId === binding.candidateId));
  }
  if(store.items.length+files.length>8) throw new Error("最多保存 8 张截图，请先移除不再使用的截图。");
  let added = 0;
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const dataUrl = await toDataUrl(file);
    store.items.push({ id: `${Date.now()}-${added}-${file.name}`, name: file.name, addedAt: new Date().toISOString(), dataUrl,...binding });
    added += 1;
  }
  if (added) {store.judge=undefined;save(projectId, store);}
  return added;
}

export function removeVisualEvidence(projectId: string, id: string) {
  const store = getVisualEvidence(projectId);
  store.items = store.items.filter((item) => item.id !== id);
  if (store.judge && store.judge.screenshotIds.includes(id)) store.judge = undefined;
  save(projectId, store);
}

export function saveVisualJudge(projectId: string, record: VisualJudgeRecord) {
  const store = getVisualEvidence(projectId);
  if(record.screenshotIds.length!==store.items.length||record.screenshotIds.some(id=>!store.items.some(item=>item.id===id)))throw new Error("截图已变化，请重新评审");
  store.judge = record;
  save(projectId, store);
}
