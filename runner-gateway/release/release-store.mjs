import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const VERSION = 1;

function emptyStore() { return { version: VERSION, projects: {} }; }

/** Small durable ledger. It stores deployment ids/hashes/metrics only, never credentials or artifact bodies. */
export function createReleaseStore(file) {
  function read() {
    if (!file || !existsSync(file)) return emptyStore();
    let parsed;
    try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) { throw new Error(`Release state 无法读取，已停止生产操作：${error instanceof Error ? error.message : String(error)}`); }
    if (!parsed || parsed.version !== VERSION || typeof parsed.projects !== 'object' || Array.isArray(parsed.projects)) {
      throw new Error('Release state 格式不受支持，已停止生产操作。');
    }
    return parsed;
  }

  function write(document) {
    if (!file) throw new Error('RELEASE_STATE_FILE 未配置，无法持久保存生产发布状态。');
    mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(document, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, file);
  }

  return {
    get(key) { return read().projects[key]; },
    set(key, state) {
      const document = read();
      document.projects[key] = state;
      write(document);
      return state;
    },
  };
}
