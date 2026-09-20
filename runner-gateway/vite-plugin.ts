import type { Plugin, Connect } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** 内置执行器与应用共用 HTTP 服务，开发和 preview 均无需额外端口。 */
export function builtinRunnerPlugin(): Plugin {
  let root = process.cwd()
  let handler: Promise<(req: IncomingMessage, res: ServerResponse) => Promise<void>> | undefined
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const route = (req.url ?? '').match(/(?:^|\/)__runner(\/[^?]*)?(\?.*)?$/)
    if (!route) return next()
    req.url = `${route[1] || '/'}${route[2] || ''}`
    handler ??= import(pathToFileURL(path.resolve(root, 'runner-gateway/server.mjs')).href)
      .then((module) => module.createRunnerHandler({ token: '' }))
      .catch((error) => { handler = undefined; throw error })
    void handler.then((run) => run(req, res)).catch((error) => {
      if (res.headersSent) return
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: '内置 Runner 加载失败，请运行 npm run runner:setup 后重试。', detail: String(error.message ?? error) }))
    })
  }
  return {
    name: 'evolve-builtin-runner',
    configResolved(config) { root = config.root },
    configureServer(server) {
      server.middlewares.use(middleware)
      server.httpServer?.once('close', () => {
        void import(pathToFileURL(path.resolve(root, 'runner-gateway/server.mjs')).href).then((module) => module.closeRunner()).catch(() => {})
      })
    },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}
