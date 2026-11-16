# P3-AH · F03 实验页模型身份来源整改与 F04 验收边界

日期：2026-11-16
代码基线：`a43bf22ea1ef776b8145dc149e31743636f05c3d`
独立分支：`codex/artifact-evolution-governance-p0`

## 一、复验依据和判定

依据已授权 Chrome 的独立验收报告 `Evolve_a43bf22_F01-F07_Retest_2026-11-16(1).html`：

- F01、F02、F05、F06、F07：**有界通过**，仅指当前零 Mission、零真实问题的 UI 空态/说明及版本回读；不能替代非空业务链路的真实验收。
- F03：**失败**。后端模型设置已保存生成角色 Minimax / MiniMax-M3（版本 4）和独立 Judge Minimax / MiniMax-M3.1-Flash（版本 2），但 `#/experiments` 顶部仍显示 `生成：unavailable / unavailable` 与 `评测：unavailable / unavailable`，未解释不同来源或尚无实验。
- F04：**在线阻断**。真实问题中心为零问题、零分组，没有可供展开/折叠的批量按钮及 aria-expanded 状态。不得在零业务数据时宣称在线点击行为通过。

## 二、源码根因

`src/features/evolve/components/experiments-overview.tsx` 原本只依赖 `getAiProviderStatus("plan" / "evaluate")`。该函数使用浏览器本地 BYOK 环节路由或网页侧环境变量；在生产构建里未配置浏览器路由、且无网页侧 API Key 时，回退标为 `unavailable`。它不是后端 `GET /api/evolution/ai-connection`、`GET /api/evolution/ai-judge-connection` 加密 Vault 的状态来源，更不是某次实际实验的 Run、Trace 或 Judge 身份回执。

因此实验页旧标题混淆了三个不同维度：**已保存的后端配置、浏览器当前拟用路由、历史运行中真正调用的模型**。

## 三、最小实现

1. 新增 `src/features/evolve/components/experiment-model-provenance.tsx`，仅在 HTTP 服务端模式用已有 `readServerAiConnection("generation")` 和 `readServerAiConnection("judge")` 的 GET 只读端点分别读取配置；显示供应商名称、模型标识与保存版本，但明确标记“真实调用未验证”。不会请求 API Key 回传、POST/PUT 保存、运行测速、调用 `ai-health`、触发 MiniMax/Judge。
2. 每个角色支持独立的 loading、saved、not-configured、storage-unavailable、unverified 状态。回读失败不可反向推断为“没有配置”或“模型不可用”；前端不直接显示潜在含凭证的服务端异常内容。
3. 实验页顶端将两个“生成/评测模型”标签改为“生成运行/评测运行”。没有真实实验时明确显示“暂无实验记录”；存在实验数据时要求依据该轮 Run/Trace/Judge 证据核验历史模型身份，**不以当前 Vault 配置冒充历史模型**。
4. 保留 Local 浏览器原型此前的计划路由信息，并标明“本地预设（非运行证据）”，避免生产模式修复造成本地功能退化。
5. Candidate 实验的独立评测协议说明也明确区分本地预设、Vault 保存状态与实际 Judge 证据。
6. 提供“查看模型连接和独立验收配置”只读导航入口；不更改项目 Schema、模型配置、存储结构或后端 API。

## 四、已执行验证

- F03 provenance 新增六项测试：已保存的生成/Judge 独立回读、部分失败不伪报未配置、未配置状态、本地原型不读服务端、真实实验不混用保存配置、保留本地原型预设身份。
- 现有 F04 折叠/展开组件测试 2 项和后端模型连接面板 11 项：合计 **19/19 通过**。
- TypeScript `pnpm exec tsc -b --pretty false`：通过。
- P3 独立治理 `pnpm exec vitest run --config vitest.p3.config.ts`：**56 个文件、752/752 通过**。
- `pnpm architecture:check`、全项目 `pnpm lint`、`pnpm exec vite build`、`git diff --check`：全部通过；Vercel Sandbox 第三方 source map 缺失产生非阻断告警。
- 根仓库八分片测试：`pnpm exec vitest run --config vitest.config.ts --shard=N/8 --maxWorkers=2 --reporter=dot`；**517 个测试文件、4,650 项通过、3 项跳过、0 项失败、全部八组退出码为 0**。
- 分片明细：1/8：65 文件、654/654 通过；2/8：65 文件、571 项通过 / 1 项跳过；3/8：65 文件、452 项通过 / 1 项跳过；4/8：65 文件、601/601 通过；5/8：65 文件、573/573 通过；6/8：64 文件、591/591 通过；7/8：64 文件、616 项通过 / 1 项跳过；8/8：64 文件、592/592 通过。三项原有跳过项继续记录，不能算作已覆盖。
- 全量测试统计是本地代码回归证明，并非对准确部署版本的在线验收、MiniMax 调用、Judge Run/Trace 或真实工作流的替代。

## 五、剩余线上和业务 Gate

- **F03 尚未在线复验**。本阶段所有修复只在本地独立分支，不能将原 `a43bf22` Lab Preview 上的 F03 失败直接改为通过。仅经再次授权发布准确新 SHA 后，才能用已登录 Chrome 回读实验页及两角色模型元数据。
- **F04 在线仍阻断**。已存在的组件级行为测试不等于真实业务数据下的批量展开/折叠。待合法真实问题分组可用时只读点击验证；不创建、不注入真实 Lab 问题数据作为测试前提。
- F01/F02 的非空业务数据详情/搜索/下钻、Server API 原始响应、MiniMax 和独立 Judge 的实际调用与性能、Sandbox、Hidden/Final、Gate F 均不能由这次 UI 回归推定通过。
- 不修改主分支、生产环境、Supabase Lab 或生产数据、Vault Key、历史迁移，也不修改此前已删除的两条历史孤儿 Job。**无真实模型调用、无 GitHub 推送、无 Vercel 部署**。

下一步建议只在完整本地回归、精确代码审计通过后固定独立分支本地 SHA；之后另行进行隔离 Lab Preview 发布与 F03 登录态只读复验。
