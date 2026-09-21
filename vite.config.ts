import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { builtinRunnerPlugin } from './runner-gateway/vite-plugin'

export default defineConfig({
  plugins: [nitro(), react(), builtinRunnerPlugin()],
  nitro: {
    preset: process.env.VERCEL ? 'vercel' : 'node-server',
    serverDir: './apps/backend/server',
    modules: ['workflow/nitro'],
  },
  build: {
    // 首屏与页面代码已经按路由拆分；保留更高的报告阈值给完全按需加载的 Office
    // 解析器与 Mermaid 图表引擎，避免把不影响首次加载的供应商包误报为主包回归。
    chunkSizeWarningLimit: 700,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@evolution/contracts': path.resolve(__dirname, './packages/contracts/src/index.ts'),
      '@evolution/core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@evolution/harness': path.resolve(__dirname, './packages/harness/src/index.ts'),
      '@evolution/adapters/sandbox': path.resolve(__dirname, './packages/adapters/src/vercel-sandbox-adapter.ts'),
      '@evolution/adapters': path.resolve(__dirname, './packages/adapters/src/index.ts'),
      '@evolution/ui': path.resolve(__dirname, './packages/ui/src/index.ts'),
      '@evolution/testkit': path.resolve(__dirname, './packages/testkit/src/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 8000,
    strictPort: true,
    // Runner 由 builtinRunnerPlugin 与应用共用 HTTP 服务。
  },
  preview: {
    host: '0.0.0.0',
    port: 8000,
  },
})
