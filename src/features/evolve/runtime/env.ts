// Vite 浏览器端对原 Next 服务端 process.env 的等价替换。
// 原项目通过 EVOLVE_* / OPENAI_* 环境变量选择 AI 引擎与目标适配器；
// 浏览器里没有服务器密钥，这里统一从 import.meta.env（VITE_ 前缀）读取，
// Production 未配置真实 AI 时必须 fail-closed；Demo 只允许本地开发或显式 VITE_EVOLVE_AI_PROVIDER=demo。
const envs = import.meta.env as Record<string, string | undefined>;

export const serverEnv: Record<string, string | undefined> = {
  EVOLVE_AI_PROVIDER: envs.VITE_EVOLVE_AI_PROVIDER,
  EVOLVE_EVALUATOR: envs.VITE_EVOLVE_EVALUATOR,
  OPENAI_API_KEY: envs.VITE_OPENAI_API_KEY, // ⚠️ 真实密钥只应放服务器；Production 浏览器留空时不会自动走 Demo
  OPENAI_MODEL: envs.VITE_OPENAI_MODEL,
  OPENAI_REASONING_EFFORT: envs.VITE_OPENAI_REASONING_EFFORT,
  EVOLVE_AI_TIMEOUT_MS: envs.VITE_EVOLVE_AI_TIMEOUT_MS,
  EVOLUTION_API_URL: envs.VITE_EVOLUTION_API_URL,
  EVOLVE_TARGET_ADAPTER: envs.VITE_EVOLVE_TARGET_ADAPTER,
};
