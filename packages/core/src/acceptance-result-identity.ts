/** Index only results requested by their own batch; repeated identities remain unverified. */
export function indexScopedAcceptanceResults<T extends { criterionId: string }>(
  batches: readonly { requestedCriterionIds: readonly string[]; results: readonly T[] }[],
) {
  const byId = new Map<string, T>();
  const duplicateIds = new Set<string>();
  for (const batch of batches) {
    const requested = new Set(batch.requestedCriterionIds);
    for (const result of batch.results) {
      const id = result.criterionId;
      if (!requested.has(id) || duplicateIds.has(id)) continue;
      if (byId.has(id)) {
        byId.delete(id);
        duplicateIds.add(id);
      } else {
        byId.set(id, result);
      }
    }
  }
  return { byId, duplicateIds };
}
