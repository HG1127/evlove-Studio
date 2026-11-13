# P3-X · 单一合成 HTML Mission 烟测交接包（未授权、未执行）

日期：2026-11-13
项目：Evlove Studio Evolution Lab
实验分支：`codex/artifact-evolution-governance-p0`
工作树：`D:\Downloads\evlove-studio-evolve-p0`
本阶段基础提交：`986dde10c7cabf382a4e0fc9484df8caab982264`
独立 Supabase Lab：`jnlbqgpezenmpksyklme`
独立 Vercel Lab：`prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs`
当前已上线 Lab Preview：`https://evlove-studio-evolution-lj0d4zy54-1248279806-7692s-projects.vercel.app`

## 1. 实验目的与唯一范围

唯一合成 Mission ID：

`lab-synthetic-html-task-filter-p3x-v1`

本阶段不再抽象列“实验需要什么”：实际生成一个可重复、可检查的独立 HTML 任务面板。原版具有固定页头、三条原始任务和一个搜索输入框，**故意缺少搜索过滤脚本**。未来获批的 AI 任务要求实现不区分大小写的过滤、显示精确命中数量、正确单复数的 aria-live 状态，同时保留原有标题、三项任务 ID 与标题、单文件无外网资源要求。

该 Mission 仅是**先验审查模板**，不是已登记的 Supabase Mission，也不是用户对真实 MiniMax 调用的授权。任务对应真实基金策略、真实客户资料与任何历史孤儿 Job 的可能关联已排除。

## 2. 生成文件与事实指纹

- `tests/fixtures/p3x-synthetic-task-board/original.html`：UTF-8 原始 HTML，**2067 字节**，无外部资源、无脚本。
- `tests/fixtures/p3x-synthetic-task-board/mission.template.json`：由生成器生成、通过 `EvolveProjectSchema` 验证的完整 Mission 模板，Campaign idle、候选数 0、Baseline/Experiment/Validation/Artifact Acceptance 均未执行；不是在线数据库记录。
- `tests/fixtures/p3x-synthetic-task-board/approval.request.json`：只表示申请待审，`userApproved=false`、`registeredInLab=false`、`labArmed=false`，实际物理模型调用数 0。
- `tests/fixtures/p3x-synthetic-task-board/baseline-visible-observation.json`：本地安装版 Chrome Headless 对**原始文件**执行三项可见题后的客观观察记录；不含任何模型生成结果。
- `scripts/p3x-create-synthetic-html-mission.mjs`：仅使用 Node 文件/加密标准库，确定性地生成模板和审批请求；如果未来已有文件内容变化，会拒绝静默覆盖。
- `scripts/p3x-verify-synthetic-html-baseline.mjs`：使用本机 Chrome 和 Playwright 实际测量原版，仅执行 Visible 题集，禁止外部请求；不提前执行 Hidden/Final 题集。
- `apps/backend/src/services/lab-synthetic-html-mission-fixture.test.ts`：正式 Schema、真实独立 Final 契约、父文件哈希、身份/审批状态、物理文件存储约束及原版浏览器观察的联合测试。
- `vitest.p3.config.ts`：将上述新测试纳入 P3 实验治理回归。

原始 HTML SHA-256：

`192abea39d167d9c0f4310fc603905905de5fa44106685fc7d6ea3d2931da8dc`

完整独立 Final 题集由真实 `finalHoldoutPaperHash` 算法绑定：
`aad0565-1934`

完整 Mission 成果合同由 `finalHoldoutContractFingerprint` 验证：
`754a3c5e-4907`

这两个 Fingerprint 是系统现有格式的轻量版本绑定，**不是** SHA-256 签名；原始 HTML 的实际文件指纹为上面独立列出的 SHA-256。两者没有相互替代。

## 3. 验收标准与题集设计

三个硬性 Criterion：
- `PRESERVE`（30%）：原有固定标题、页头和三张任务卡片及 ID 不丢失。
- `FILTER`（45%）：搜索筛选忽略大小写，设置非匹配项 `hidden`，清空时恢复。
- `COUNT`（25%）：`#result-count` 实时宣布可见数，正确处理 0、1、3，保留 aria-live。

三张题集各有 **3 项**，共九项，题目 ID 互不重复；所有行为题均为 `executionMode=external-runner`，有真实浏览器 `fill/count/text/visible` 指令。可见、隐藏和独立最终测试分别保留；Final 题集在候选生成前固定，独立于前两套题集并已通过系统 `assertIndependentFinalPaper` 与 `assertIndependentFinalExecution` 契约检查。

**这不代表测试结果已通过。** Hidden 和 Final 未实际执行，Gate F 未执行；未来必须在获批、实际冻结的 Candidate 文件字节上执行原始/候选同卷和独立最终测试，不能以文本评分取代真实浏览器证据。

## 4. 已完成的 Chrome 真实原版基线

使用本机安装版 Chrome Headless 打开 `original.html` 的 `file://` 地址：

- `V-PRESERVE`：通过。标题精确为 `Lab Task Board`，三张原始任务卡片和任务节点均存在。
- `V-ALPHA`：失败，**这是我们要改进的真实缺口**。输入 `alpha` 后仍然有三张可见卡片，预期一张；ARIA 状态仍为 `3 tasks`，预期 `1 task`。
- `V-CLEAR`：通过，但不能据此推断过滤已实现，因为原版根本没有实现过滤行为。
- 本地浏览器验证外部 HTTP 请求数 0，模型请求 0，Lab 数据库写入 0。
- 这只是**本地原版**浏览器证据，尚未验证 Vercel Sandbox Chromium、云端网络隔离、任务持久化/恢复或真实 Candidate 浏览器结果。

## 5. 不可跳过的在线导入条件

Mission JSON 虽已通过 Schema，并不满足实际浏览器执行所要求的物理文件保管链。源码 `apps/backend/src/services/server-html-native-execution.ts` 的 `originalBytes` 要求：

1. 原始 HTML 必须真实存储于专用 Lab Artifact Store；
2. 完整原始字节和 Artifact Metadata 可回读；
3. Metadata 的 `missionId` 必须对应唯一合成 Mission，`kind=source`，`sizeBytes`/SHA-256 匹配；
4. Mission Source Artifact 的 `storageRef` 必须绑定相应的真实 artifact ID，不能填一个臆造的 ID；
5. 正式注册需经 `POST /api/evolution/missions` 的 `mission.write` 权限、rubric Target Binding 校验及现有 Confirmation Admission 规则，源文件保存与关系更新也必须走受审计的现有 API/Artifact Store；
6. 目标 `requiresSandboxHtmlSourceExecution` 必须成立，实际隔离云 Chromium 能执行 `external-runner` 浏览器断言，并能验证冻结文件哈希。

**本阶段未向 Lab DB 写 Mission 或上传 Artifact，`storageRef` 仍为空，这是刻意保留的待执行依赖；未验证完成前不得宣布已具备真实启动条件。**

## 6. 真实 MiniMax 单代烟测的审批请求

建议未来获批的初次烟测只包含**一个新的**上述合成 Mission、最多一次成功 Candidate 构造及必要独立 Judge 测量，不代表完整三代或 Gate F 已承诺成功。

预先约束（仍需明确用户确认）：
- 唯一 Mission：`lab-synthetic-html-task-filter-p3x-v1`。
- Generation：Vault 中现有 `MiniMax-M3`；独立 Judge：`MiniMax-M3.1-Flash`；官方中国区 API `https://api.minimaxi.com/v1`；**绝不重新索取或展示 Key**。
- 强制硬上限：同一 Mission 最多 **6 次实际物理模型请求、300,000 Token、20 分钟**，5 小时及周订阅额度均需在每次尝试前达到 **50%**。
- 计划一代 + 独立 Judge 的名义物理调用为 2 次，但理解、Rubric、Baseline、修复、浏览器证据、Hidden/Final 和额外重试仍可能产生更多调用；当前 6 次不能保证完整任务成功。
- 每次新物理尝试必须被 SQL 预算预留和记录确认；用量未知、模型路由/身份变更、证据不足、截止时间到期即停止，保留账本，不能盲目再次尝试。
- 不采用新 Mission 重置额度；不自动调用真实 MiniMax、无需更改旧两个孤儿 Job；不动生产数据库、生产部署或主分支。
- 用户未明确批准之前，不登记新 Mission、不上传 Artifact、不打开 `EVOLUTION_LAB_EXPERIMENT_ARMED`、不设置获批 Mission ID、不发模型请求。

## 7. 后续运行顺序

在审批明确后，先进行唯一 Mission 的 Lab 注册、受控源 Artifact 存储/绑定；再做只读 Job/Mission 完整性、模型 Vault 路由、Chrome/Sandbox 执行能力和额度检查；只有全部证据完整且用户授予明确的真实调用许可，才在严格硬上限中发起一次模型烟测；保存真实物理调用/Token、原版和候选的 SHA-256、Browser 证据和独立 Judge 结果。

如结果出现中断或达到资源上限，应交付证据和具体阻断，而不是重置预算、偷加调用或声称 Gate F 通过。

**P3-X 交付性质：单一合成 Mission 的精确测试输入、冻结验收题集、真实本地原版 Baseline、审批申请和可验证的执行准备包。实际 Lab 注册及真实模型运行尚未获授权、尚未执行。**
