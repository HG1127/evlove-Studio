/** A repeated Test Case ID is ambiguous evidence, regardless of response order. */
export function indexUniqueBatchResults<T extends { testCaseId: string }>(results: readonly T[]) {
  const byId = new Map<string, T>();
  const duplicateIds = new Set<string>();
  for (const result of results) {
    const id = result.testCaseId;
    if (duplicateIds.has(id)) continue;
    if (byId.has(id)) {
      byId.delete(id);
      duplicateIds.add(id);
    } else {
      byId.set(id, result);
    }
  }
  return { byId, duplicateIds };
}
