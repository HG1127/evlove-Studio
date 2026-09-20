// 行级差异：版本对比用的轻量 LCS diff。内容超长时降级为"整段旧 + 整段新"，避免大文本卡住页面。
export type DiffLine = { type: "same" | "add" | "del"; text: string };
export type FullDiffLine = { kind: "same" | "del" | "add"; text: string };

/**
 * Project a diff back into the two real documents without synthetic alignment rows.
 * The left side preserves only old-version lines; the right side preserves only new-version lines.
 * Diff metadata is kept solely for highlighting.
 */
export function projectFullDiffSides(lines: DiffLine[]) {
  const left: FullDiffLine[] = [];
  const right: FullDiffLine[] = [];
  for (const line of lines) {
    if (line.type === "same") {
      left.push({ kind: "same", text: line.text });
      right.push({ kind: "same", text: line.text });
    } else if (line.type === "del") {
      left.push({ kind: "del", text: line.text });
    } else {
      right.push({ kind: "add", text: line.text });
    }
  }
  return { left, right };
}
export type CompactDiffItem = DiffLine | { type: "skip"; count: number };

/**
 * Difference-first projection for the default version-comparison view.
 * Keep only changed lines plus a small amount of unchanged context; collapse long unchanged runs.
 * The full aligned document remains available separately for audit/review.
 */
export function compactDiffLines(lines: DiffLine[], contextLines = 1): CompactDiffItem[] {
  if (!lines.length) return [];
  const keep = new Uint8Array(lines.length);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.type === "same") continue;
    const start = Math.max(0, index - contextLines);
    const end = Math.min(lines.length - 1, index + contextLines);
    for (let cursor = start; cursor <= end; cursor += 1) keep[cursor] = 1;
  }
  // No changes: return one collapsed marker instead of echoing the same document twice.
  if (!keep.some((value) => value === 1)) return [{ type: "skip", count: lines.length }];

  const result: CompactDiffItem[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    if (keep[cursor]) {
      result.push(lines[cursor]!);
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < lines.length && !keep[cursor]) cursor += 1;
    result.push({ type: "skip", count: cursor - start });
  }
  return result;
}

const MAX_DIFF_CELLS = 1_500_000;

export function diffLines(oldLines: string[], newLines: string[]): { lines: DiffLine[]; added: number; deleted: number; truncated: boolean } {
  const n = oldLines.length;
  const m = newLines.length;
  if (n * m > MAX_DIFF_CELLS) {
    const lines: DiffLine[] = [
      ...oldLines.map((text) => ({ type: "del" as const, text })),
      ...newLines.map((text) => ({ type: "add" as const, text })),
    ];
    return { lines, added: m, deleted: n, truncated: true };
  }
  // LCS 动态规划 + 回溯，生成 unified 视图：del = 仅旧版本有，add = 仅新版本有。
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] = oldLines[i] === newLines[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      lines.push({ type: "same", text: oldLines[i]! });
      i += 1; j += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      lines.push({ type: "del", text: oldLines[i]! });
      i += 1;
    } else {
      lines.push({ type: "add", text: newLines[j]! });
      j += 1;
    }
  }
  while (i < n) { lines.push({ type: "del", text: oldLines[i]! }); i += 1; }
  while (j < m) { lines.push({ type: "add", text: newLines[j]! }); j += 1; }
  return { lines, added: lines.filter((line) => line.type === "add").length, deleted: lines.filter((line) => line.type === "del").length, truncated: false };
}

// 并排全文视图：把 unified 差异展开成左右逐行对齐的行。
// same 两侧同显；连续 del/add 块按序配对（左红右绿），短的一侧用占位行补齐，保证左右行号一一对应。
export type DiffCell = { kind: "same" | "del" | "add" | "none"; text: string };
export type AlignedDiffRow = { left: DiffCell; right: DiffCell };

export function alignDiffRows(lines: DiffLine[]): AlignedDiffRow[] {
  const rows: AlignedDiffRow[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor]!;
    if (line.type === "same") {
      rows.push({ left: { kind: "same", text: line.text }, right: { kind: "same", text: line.text } });
      cursor += 1;
      continue;
    }
    const deletes: string[] = [];
    const adds: string[] = [];
    while (cursor < lines.length && lines[cursor]!.type !== "same") {
      const item = lines[cursor]!;
      if (item.type === "del") deletes.push(item.text);
      else adds.push(item.text);
      cursor += 1;
    }
    for (let index = 0; index < Math.max(deletes.length, adds.length); index += 1) {
      rows.push({
        left: deletes[index] !== undefined ? { kind: "del", text: deletes[index]! } : { kind: "none", text: "" },
        right: adds[index] !== undefined ? { kind: "add", text: adds[index]! } : { kind: "none", text: "" },
      });
    }
  }
  return rows;
}
