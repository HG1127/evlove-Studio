import type { EvolveProject, TargetRunResult, TestCase } from "../schemas";
import { retrieveTextContext } from "./context-retrieval";

/** Parses the complete supplied file; this is file evidence, never a browser execution. */
export function htmlFileEvidence(project: EvolveProject, testCase: TestCase): TargetRunResult | undefined {
  const targets = project.sourceArtifacts.filter((artifact) => artifact.role === "target");
  if (!targets.length || !targets.every((artifact) => artifact.extension?.toLowerCase() === "html" || artifact.mimeType === "text/html")) return undefined;
  if (typeof DOMParser === "undefined") return undefined;
  const files = targets.map((artifact) => {
    const content = artifact.textContent || "";
    const doc = new DOMParser().parseFromString(content, "text/html");
    const problems: string[] = [];
    if (!content.trim()) problems.push("未取得完整文件内容");
    for (const tag of ["html", "head", "body"]) {
      if (!new RegExp(`<${tag}\\b[^>]*>`, "i").test(content) || !new RegExp(`</${tag}\\s*>`, "i").test(content)) problems.push(`源文件缺少完整 ${tag} 标签`);
    }
    const ids = [...doc.querySelectorAll("[id]")].map((node) => node.id);
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const headings = [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((node) => ({ tag: node.tagName, id: node.id, text: node.textContent?.trim().slice(0, 160) }));
    const sections = [...doc.querySelectorAll("section,article,[data-chapter],.slide-card")].map((node) => ({ id: node.id, chapter: node.getAttribute("data-chapter"), text: node.textContent?.trim().slice(0, 160) }));
    const brokenAnchors = [...doc.querySelectorAll('a[href^="#"]')].map((node) => node.getAttribute("href")!).filter((href) => href.length > 1 && !doc.getElementById(href.slice(1)));
    return { artifactId: artifact.id, name: artifact.name, charactersRead: content.length, readWholeFile: true,
      formatProblems: problems, duplicateIds: duplicates, headings, sections, brokenAnchors,
      sourceExcerpt: retrieveTextContext(content, `${testCase.title} ${testCase.input} ${testCase.expected.join(" ")}`, { maxChars: 9000, maxChunks: 5 }) };
  });
  if (files.some((file) => !file.charactersRead)) return undefined;
  return { testCaseId: testCase.id, latencyMs: 1, cost: 0, verificationStatus: "verified", trace: [{ id: `html-file-${testCase.id}`, stage: "full-html-file", summary: "读取完整 HTML 并解析格式、章节和锚点；未执行脚本或浏览器交互", status: "info" }],
    output: `HTML FILE EVIDENCE\n${JSON.stringify(files)}\nEvidence scope: complete-file format/DOM inventory plus literal retrieved content for semantic review. formatProblems are observed source defects; successful parsing does not prove visual quality or runtime behavior. sourceExcerpt is retrieved, not the entire content; do not infer absent prose from omitted excerpts. 标准是否通过由这些实际文件证据判断。` };
}
