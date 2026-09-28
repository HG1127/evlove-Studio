import type { CandidateArtifactSnapshot, EvolveProject } from "../schemas";

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const retains = (original: string[], candidate: string[]) => { let index = 0; for (const token of candidate) if (token === original[index]) index++; return index === original.length; };
const protectsSlideStructure = (items: string[]) => items.some((item) => /slide.{0,16}(?:章节|结构|页面|页数|card)|(?:章节|结构|页面|页数).{0,16}slide/i.test(item));
const slideCardIds = (doc: Document) => [...doc.querySelectorAll("article.slide-card[id]")].map((node) => node.id);

/** Full-file checks ground named HTML protection scopes; generic protection stays with the judge. */
export function htmlCandidateGuard(project: EvolveProject, snapshots: CandidateArtifactSnapshot[]) {
  if (typeof DOMParser === "undefined") return [];
  const protectedIds = new Set<string>();
  for (const item of project.protectedItems) {
    for (const match of item.matchAll(/\bslide-(\d+)((?:\/\d+)*)/gi)) {
      protectedIds.add(`slide-${match[1]}`);
      for (const suffix of match[2].split("/").filter(Boolean)) protectedIds.add(`slide-${suffix}`);
    }
  }
  return snapshots.flatMap((snapshot) => {
    const source = project.sourceArtifacts.find((artifact) => artifact.id === snapshot.sourceArtifactId);
    if (!source || !(source.extension === "html" || source.mimeType === "text/html")) return [];
    const original = new DOMParser().parseFromString(source.textContent ?? "", "text/html");
    const candidate = new DOMParser().parseFromString(snapshot.content, "text/html");
    const counts = (doc: Document) => { const map = new Map<string, number>(); for (const node of doc.querySelectorAll("[id]")) map.set(node.id, (map.get(node.id) ?? 0) + 1); return map; };
    const originalIds = counts(original), candidateIds = counts(candidate);
    const newDuplicateIds = [...candidateIds].filter(([id, count]) => count > 1 && count > (originalIds.get(id) ?? 1)).map(([id]) => id);
    // Ground generic slide protection in source IDs: AI prose may guess the wrong page count.
    const originalSlideIds = protectsSlideStructure(project.protectedItems) ? slideCardIds(original) : [];
    const candidateSlideIds = new Set(slideCardIds(candidate));
    const missingSlideIds = [...new Set(originalSlideIds)].filter((id) => !candidateSlideIds.has(id));
    const protectedSections = [...protectedIds].flatMap((id) => {
      const before = original.getElementById(id);
      if (!before) return [];
      const after = candidate.getElementById(id);
      const beforeText = normalize(before.textContent ?? ""), afterText = normalize(after?.textContent ?? "");
      const beforeTags = [...before.querySelectorAll("*")].map((node) => node.tagName);
      const afterTags = after ? [...after.querySelectorAll("*")].map((node) => node.tagName) : [];
      const textNodes = (element: Element) => { const walker = element.ownerDocument.createTreeWalker(element, 4); const values: string[] = []; let node; while ((node = walker.nextNode())) { const value = normalize(node.textContent ?? ""); if (value) values.push(value); } return values; };
      const textRetained = Boolean(after) && retains(textNodes(before), after ? textNodes(after) : []);
      const structureRetained = Boolean(after) && retains(beforeTags, afterTags);
      const title = normalize(before.querySelector("h1,h2,h3,h4,h5,h6")?.textContent ?? "");
      const titleRetained = Boolean(after) && title === normalize(after?.querySelector("h1,h2,h3,h4,h5,h6")?.textContent ?? "");
      return [{ id, originalFound: true, candidateFound: Boolean(after), textRetained, structureRetained, titleRetained, originalCharacters: beforeText.length, candidateCharacters: afterText.length }];
    });
    const unresolvedProtectedIds = [...protectedIds].filter((id) => !original.getElementById(id));
    const issues = [...newDuplicateIds.map((id) => `新增重复 ID: ${id}`),
      ...(missingSlideIds.length ? [`保护的原始 slide-card 缺失 ${missingSlideIds.length}/${originalSlideIds.length}：${missingSlideIds.slice(0, 6).join("、")}`] : []),
      ...protectedSections.filter((section) => !section.textRetained || !section.structureRetained || !section.titleRetained).map((section) => `保护章节 ${section.id} 的原内容、标题或结构未完整保留`)];
    return [{ sourceArtifactId: source.id, readWholeFiles: true, newDuplicateIds, protectedSections, unresolvedProtectedIds, originalSlideCount: originalSlideIds.length, missingSlideIds, issues }];
  });
}
