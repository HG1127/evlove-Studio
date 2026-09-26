/** Repeated identities are ambiguous, even when the repeated payloads agree. */
export function indexUniqueById<T>(items: readonly T[], idOf: (item: T) => string) {
  const byId = new Map<string, T>();
  const duplicateIds = new Set<string>();
  for (const item of items) {
    const id = idOf(item);
    if (duplicateIds.has(id)) continue;
    if (byId.has(id)) {
      byId.delete(id);
      duplicateIds.add(id);
    } else {
      byId.set(id, item);
    }
  }
  return { byId, duplicateIds };
}
