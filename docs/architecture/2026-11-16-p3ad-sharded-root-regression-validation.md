# P3-AD · Evolve Studio 全仓库八分片回归与测试契约修复报告

日期：2026-11-16
分支：`codex/artifact-evolution-governance-p0`
变更起点：`46e02a3a55d330d29e1a82d412972313dac63310`

## 1. 判定范围与结论

本阶段继续处理 P3-AB / P3-AC 对 Evolve Studio Lab Preview F01–F07 只读验收后的全仓库测试超时问题。保留完整 Vitest 测试清单、全部原有安全断言及独立的 P3 测试配置，未跳过新增失败测试，也未更改任何业务运行代码。

仓库根 Vitest 配置匹配 **514 个测试文件**。旧方式按 2 分片每组约 257 个测试文件，各运行到 250 秒上限仍无最终汇总；改为 8 个文件级分片，每分片最多 2 个 Vitest worker，同时最多运行 2 分片。全部分片均取得终态成功退出码 0。结果合并为 **4,624 项通过、3 项跳过、0 项失败，共 4,627 项测试**。3 个跳过项仍是未执行覆盖，不能算通过。

独立 P3 治理回归：**56 个测试文件，752/752 通过，退出码 0**。此外 TypeScript `tsc -b`、`pnpm architecture:check`、全项目 `pnpm lint`、`pnpm exec vite build`、`git diff --check` 均退出码 0。Vercel Sandbox 第三方包 source map 缺失告警仍存在，但未导致构建失败。

## 2. 8 个分片的真实结果

| 分片 | 文件数 | 通过 | 跳过 | 失败 | 退出码 | 单组用时 |
|---|---:|---:|---:|---:|---:|---:|
| 1/8 | 65 | 687 | 0 | 0 | 0 | 73.15 秒 |
| 2/8 | 65 | 535 | 1 | 0 | 0 | 76.67 秒 |
| 3/8 | 64 | 450 | 1 | 0 | 0 | 75.83 秒 |
| 4/8 | 64 | 595 | 0 | 0 | 0 | 75.28 秒 |
| 5/8 | 64 | 567 | 0 | 0 | 0 | 74.15 秒 |
| 6/8 | 64 | 553 | 0 | 0 | 0 | 90.44 秒 |
| 7/8 | 64 | 650 | 1 | 0 | 0 | 74.64 秒 |
| 8/8 | 64 | 587 | 0 | 0 | 0 | 75.16 秒 |
| **合计** | **514** | **4,624** | **3** | **0** | **全部 0** | **各组均少于 100 秒** |

执行命令模板（将 N 替换为 1 至 8，并保持同一源代码基线）：

```powershell
pnpm exec vitest run --config vitest.config.ts --shard=N/8 --maxWorkers=2 --reporter=dot
```

单台 6 逻辑 CPU、约 16 GB 内存的验证设备，每次仅并行启动两个上述命令。8 组分片的 514 个文件与 root vitest 配置匹配数相等；2、3、7 组的三项跳过继续如实报告。2、3、4、6 组在其他不相交测试夹具修复之前已通过；之后没有修改这些分片的测试文件和业务代码，1、5、7、8 组在各自失败夹具修复后全部重跑，最终都通过。要建立对精确不可变提交的逐组 CI 凭证，后续 CI 仍可完整重跑同一命令组合。

## 3. 初次执行暴露 17 项失败及本阶段最小修复

最初八分片取得 4,607 项通过、17 项失败、3 项跳过。失败集中于 5 个旧测试文件，本阶段仅修复其模拟输入与存储契约，未改动真实 Mission/Workflow、AI 调用、Evidence 或权限的业务实现：

1. `packages/harness/src/server-semantic-artifact-context.test.ts`：补齐 EvolveProject 契约要求的 `baselineRun.originalReferences` 空列表；保留 Hidden paper 隔离和证据状态断言。
2. `apps/backend/src/services/html-browser-preflight-route.test.ts`：为历史 Markdown Workflow 测试 Mission 补齐必填的 `experimentPolicy`；不放松真实 HTML Sandbox 启动前的准入保护。
3. `apps/backend/src/services/security-policy-members.test.ts`：用 Nitro/H3 `mockEvent(new Request(...))` 替代缺少 HTTP Headers 的伪事件对象，使用非 loopback 测试地址验证内部开发身份与组织成员目录边界。
4. `packages/harness/src/server-grounded-baseline-defect.test.ts`：补齐基线的 Original 引用列表，保留原文证据真实性和对虚假引用的拒绝检查。
5. `apps/backend/src/services/server-repair-construction.test.ts`：Mock 的 AI Repair 响应补齐必需的 `reflection`，包括精确父候选和失败 Criteria 身份；测试 Artifact Store 模拟补充 `getMetadata`、文件 SHA-256、MIME、size、绑定归属等真正的归档回读数据。成功路径明确验证仅 1 个 Candidate 文件和 1 份独立 Reflection 证据写入；失败/限额/取消场景继续验证写入为零。

本阶段专项复测：上述五个测试文件 **43/43 通过**（其中 Artifact 修复构造测试 **13/13**）；之后分别重新运行失败的 1、5、7、8 号根测试分片，全部退出码 0。首轮已通过且未被本次改动触及的其他分片保留真实终态证据。

## 4. 保留的验收边界和安全约束

- 本阶段对五个旧测试文件的修改均是测试夹具 / 模拟存储，不改变应用生产行为、数据结构、部署参数、API Key 或模型身份；没有调用真实 MiniMax 生成与独立 Judge，也没有云端 Sandbox/Browser 的付费验收。
- 未改动 Supabase Lab 或生产数据库、历史迁移、Vault、两条历史孤儿活动 Job、主分支及现有线上 Preview；没有创建 Mission / Artifact 或执行真实工作流。
- 先前 Evolve Studio F01–F07 的修复代码已在 P3-AB 本地提交中存在，但**本次根测试通过不等于已完成新 Preview 在线复验**。页面、模型回读、日志口径仍要在精确授权的新 Lab Preview 源码部署后通过已登录 Chrome 进行只读核对。
- 三项跳过测试仍应保留原有跳过说明并在覆盖率签署时独立记录。单元/契约回归、P3 治理回归及本地构建均不替代真实 Baseline → Candidate → Independent Judge → Hidden / Final → Gate F → Outcome 全链路的云端实测。
- 历史全局 Job 完整性告警在本阶段没有被修复或绕过。真实模型调用、实验数据写入和后续生产发布需另行取得明确授权并通过 Gate。

## 5. 下一步建议

本次测试夹具修复与证据文件在独立分支进行原子本地提交，核对 Git HEAD、干净工作树及 P3-X 原始 HTML SHA-256 不变。随后只有在明确授权准确提交 SHA 和 Vercel Lab 项目的前提下，才可推送并发布独立 Lab Preview；该发布必须进行 F01–F07 的登录态只读页面复验。完整进化业务闭环另行安排范围、预算与安全审批。
