import "@testing-library/jest-dom/vitest";

// vitest + Node ≥22 环境下，Node 的实验性全局 localStorage（未给 --localstorage-file 时恒为 undefined）
// 会盖住 jsdom 的实现，导致读 window.localStorage 的模块（连接注册表 / BYOK）在测试里直接崩。
// 测试环境补一个内存版替代，行为与 Web Storage 接口对齐。
if (typeof window !== "undefined" && !window.localStorage) {
  const store = new Map<string, string>();
  const memoryStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(window, "localStorage", { value: memoryStorage, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true });
}
