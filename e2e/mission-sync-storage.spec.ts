import { expect, test } from "@playwright/test";

test("Mission sync delete intent persists in IndexedDB when localStorage is denied", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Storage denied", "SecurityError"); },
    });
  });
  await page.goto("/");
  await expect(page.getByText("正在加载此功能…")).toBeHidden();
  const modulePath = "/src/features/evolve/runtime/project-database.ts";
  await page.evaluate(async (path) => {
    const database = await import(/* @vite-ignore */ path) as typeof import("../src/features/evolve/runtime/project-database");
    await database.initializeProjectDatabase([]);
    database.updateMissionSyncJournal((current) => ({
      ...current,
      knownRemoteIds: ["mission-idb-persisted"],
      pendingDeleteIds: ["mission-idb-persisted"],
    }));
    await database.flushProjectDatabase();
  }, modulePath);
  await page.reload();
  await expect(page.getByText("正在加载此功能…")).toBeHidden();
  const journal = await page.evaluate(async (path) => {
    const database = await import(/* @vite-ignore */ path) as typeof import("../src/features/evolve/runtime/project-database");
    await database.initializeProjectDatabase([]);
    return database.missionSyncJournal();
  }, modulePath);
  expect(journal).toEqual({
    knownRemoteIds: ["mission-idb-persisted"],
    pendingDeleteIds: ["mission-idb-persisted"],
  });
});
