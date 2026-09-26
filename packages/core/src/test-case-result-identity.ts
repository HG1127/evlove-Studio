import { indexUniqueById } from "./identity-index";

/** A batch may only supply results for its own requested Test Cases. */
export function indexScopedTestCaseResults<T extends { testCaseId: string }>(
  batches: readonly { requestedTestCaseIds: readonly string[]; results: readonly T[] }[],
) {
  const scoped = batches.flatMap((batch) => {
    const requested = new Set(batch.requestedTestCaseIds);
    return batch.results.filter((result) => requested.has(result.testCaseId));
  });
  return indexUniqueById(scoped, (result) => result.testCaseId);
}
