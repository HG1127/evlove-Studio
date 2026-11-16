# P3-AB · 2026-11-16 Evolve Studio Lab Preview 只读验收问题 F01–F07 整改核验

## 基线、边界与结果

- 来源：用户提供的 `Evolve_Studio_Lab_Preview_Acceptance_2026-11-16.html`，9 个模块、F01–F07、E01–E20。
- 独立源码分支：`codex/artifact-evolution-governance-p0`；本轮修改起点为 `cb90e50f4ec3ccb56d344a9886e28b1f120ed832`。
- 范围：本地 React/UI 的 demo 来源、模型状态说明、折叠交互、旧文案、监控空态、构建身份；没有改变 Supabase 表/迁移、Mission 后端 API、MiniMax 配置或密钥。
- 验证：3 个新专项测试文件 **7/7 PASS**；`tsc -b` **PASS**，`pnpm architecture:check` **PASS**，`pnpm lint` **PASS**，`pnpm exec vite build` **PASS**，`git diff --check` **PASS**；P3 实验治理回归 **56 files / 752 tests PASS**。
- 完整根目录 `vitest.config.ts` 全仓库回归 **未通过**：在超时终止前已有失败。将其中已明确识别的三份失败测试独立复跑，`apps/backend/src/services/migration-security-invariants.test.ts` 13/13 FAILED、`src/features/evolve/artifacts/candidate-repair.test.ts` 3/3 FAILED、`apps/backend/src/services/server-html-candidate-protection.test.ts` 1/18 FAILED，合计 **17 FAILED / 17 PASS**。上述文件不在本次修改清单内，但尚未完成基线对照，因此不把失败归因写为“已证实历史遗留”。**全仓库绿灯和完整业务闭环均未取得**。
- 本阶段没有线上写入、模型/独立 Judge 真实调用、云 Sandbox、Mission/Artifact 注册、Preview/Production 部署，也未处理两条历史孤儿 Job。之前部署的 Preview `cb90e50` 仍是线上版本，本地补丁未上线。

## 逐项实现与保留边界

| 编号 | 处理结果 | 源码及验收 |
|---|---|---|
| F01 / P1 | 在 HTTP/Production 模式下，无论是否请求 includeDemo，都从项目集合剔除 ID=`demo` 的内置与本地旧副本；保留本地原型展示 demo 的能力，不删除现有用户数据 | `runtime/use-local-projects.ts`；3 个专项测试，涵盖本地模式和生产模式显式 includeDemo。项目管理、搜索和问题中心共用该入口。仍需在已登录新 Preview 上验证页面确无 demo 命中 |
| F02 / P1 | 问题中心的来源与系统洞察的真实模式口径在 demo 维度统一：不再把静态 `69/82`、`88%`、4 条问题当 Lab 真值 | `problems-overview.tsx` 现有 useLocalProjects() 使用上述共享入口；`system-insights-overview.tsx` 已明确 excludeDemo。注意：没有在本轮重做所有本地缓存与服务端目录一致性，真实非 demo 旧缓存仍需在线对照 |
| F03 / P1 | 在模型设置显式区分浏览器本地 BYOK/25 环节路由与后端加密 Vault 的生成/Judge 两个角色。后端已有配置通过 **只读回读**展示，不要求重复填写已保存的 Key；0/25 只表示本地路由，绝不当成后端模型缺失或真实调用失败 | `components/settings-panel.tsx`、`components/server-ai-connection-panel.tsx`；已有 `server-connection-sync.test.ts` 通过；没有更改已有模型存储、连接配置、密钥或真实路由分配。生成与 Judge 的实际连通性、执行分流仍未得到真实调用证据 |
| F04 / P2 | 问题中心以及同款经验中心的 `setAll` 展开/折叠布尔值方向修正；测试验证 `aria-expanded` 在两次切换后正确变化 | `problems-overview.tsx`、`learnings-overview.tsx` 和 React 交互测试 |
| F05 / P2 | 将“仅在页面打开才定时”的过期绝对描述改成 HTTP/本地两种运行模式；能力库、系统洞察和客户端 Harness 的 Ledger 文案明确区分代码接入与行为验证 | `campaigns-overview.tsx`、`capability-library.tsx`、`system-insights-overview.tsx`、`runtime/evolution-harness.ts`。只修正事实表达，不宣称真正的关页恢复、组织共享或 Ledger 入库已测通 |
| F06 / P2 | 当本地 AI 审计事件为空时，只显示“暂无 AI 运行或异常记录”，明确不代表模型成功；成功证明须有 Run/Trace | `settings-panel.tsx`；未产生或清理审计记录 |
| F07 / P2 | 复用后端现有 `GET /api/evolution/build-info`，Zod 校验构建身份；页面头部只读显示 Preview/Production 环境 + 8 位 SHA，完整 SHA、分支及域名可从标签说明核对；错误或缺 SHA 则显示“版本未确认” | `components/build-identity-badge.tsx`、`components/app-shell.tsx`；2 个组件测试：精确 SHA 显示和接口失败时 fail-closed。checkedAt 是回读时间，非部署时间，不应误标部署时间 |

## 禁止将本轮结果升级为真实端到端成功

- 原报告中的 B01：浏览器/Sandbox/Target Runtime 未进行物理执行，因此没有 HTML/E2E 的真实认证与性能证据。
- 原报告中的 B02：线上发布 Provider/Git Target 写能力未开展执行验收，离线交付不应被线上发布阻碍。
- Lab 历史两条孤儿活动 Job 仍须进行独立的非破坏性治理；没有绕过全局完整性 Gate。
- 本轮 UI 改动验证结果不等于可签署“23/23 业务节点已跑通”或 MiniMax 真实调用成功。

## 下一次 Preview 复验（需精确新源码版本）

1. 使用独立分支经核验的**新提交 SHA**部署仅 Lab Preview，保证不修改生产或其他项目。部署后从页面版本徽标回读，与 Vercel GitSource SHA 对照。
2. 用已登录 Chrome 验证 `#/projects`、`#/projects/manage`、`#/problems`、`#/insights`、全局搜索：无真实 Mission 时内置 `demo` 不得冒充真实项目，问题统计须能解释来源。
3. `#/problems` 以真实测试数据验证“展开全部”“折叠全部”的 `aria-expanded` 一致；没有真实问题时应保持正确空态，不创建虚假记录。
4. `#/settings` 查看后端生成与独立 Judge 已保存元数据，以及本地 25 路由数量的分层说明；**不得自动重新索取/保存 Key，也不得点击真实连接测试**。
5. `#/campaigns`、`#/capabilities`、`#/readiness`、`#/insights`、`#/settings` 的监控空态核对未验证说明与运行模式一致；任何实际执行及写入须另获专门授权。
6. 在完整仓库回归失败完成独立问题归因及复验前，保持“全仓库回归未通过”的发布阻断，不宣称完整 Evolve 闭环已经通过。
