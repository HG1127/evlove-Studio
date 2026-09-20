import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(root, 'runner-gateway/node_modules/playwright/package.json')) || !existsSync(path.join(root, 'runner-gateway/node_modules/jszip/package.json'))) {
  console.log('[Runner] 正在首次准备后台执行器依赖…');
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--prefix', 'runner-gateway'], { cwd: root, stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' });
  child.on('error', (error) => { console.error('[Runner] 准备失败：', error.message); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
}
