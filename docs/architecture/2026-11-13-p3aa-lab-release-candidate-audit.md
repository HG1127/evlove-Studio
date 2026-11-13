# P3-AA · Evolve Studio 隔离 Lab 发布候选审计

日期：2026-11-13
实验源码分支：`codex/artifact-evolution-governance-p0`
审核起点：`74e0c5ed64735fb01c5a0c47f8d9c4b144256c97`
允许环境：独立 Evlove Studio Lab；**本阶段未推送、未部署、未启动真实实验**。

## 一、为何需要本阶段

P3-Y/Z 对合成 Mission 的原始 HTML、Rubric、可见/Hidden/独立最终题集、Artifact 上传和 CAS 绑定已有哈希及权限保护。重新审计发现，实验保护清单、可编辑清单、指标、目标类型和执行模式等边界并未纳入冻结；通过普通 Mission 写入可能将另一个参考文件混入同一个已批准的实验，或扩展候选数量、迭代轮次及后台调度。虽然物理模型调用预算仍会拦截大部分越限请求，但批准的实验范围不可依赖后续预算才被发现。

## 二、本次针对性修复

在唯一的 `lab-synthetic-html-task-filter-p3x-v1` 的已有服务端守卫中新增：
- 冻结来源范围 SHA-256：`dc8c82974a096d79df20efb8172acd5b99c3bfa320385e4b4d9aa56672d46298`，绑定 protectedItems、editableItems、metrics、artifact 目标连接和 objectType；
- 必须恰有一个 `source-task-board` HTML Target，不允许悄悄增加其他 reference/eval 文件；
- 固定 `maxRounds=1`、`candidateCount=1`、`schedule.enabled=false`；验收题集和主要任务目标仍受先前 `113111c80af41de9a10bec92c87d901d755c1810a4da5a5c817dc64b113e9eb6` 绑定；
- 原始 HTML 的物理源仍必须回读 2067 字节和 SHA-256 `192abea39d167d9c0f4310fc603905905de5fa44106685fc7d6ea3d2931da8dc`。
- 正常的 Mission 名称、注释等非安全字段编辑不被拦截；生产或其他 Mission 的入口行为不因该唯一合成 Mission 守卫改变。

## 三、测试与代码审查结果

- 合成 Mission 及文件保管链专项：`56/56 PASS`。本阶段比 P3-Z 新增 15 项，覆盖额外参考文件、保护/可编辑边界替换、目标类型修改、候选和轮次扩大、未授权自动调度；包括登记前阻断、登记后 CAS 阻断和 Sandbox 前阻断。
- P3 实验治理全量回归：`56 test files / 752 tests PASS`。
- 相关 Mission/通用 HTML Runner 回归：`5 files / 29 tests PASS`。
- `tsc -b`、`pnpm architecture:check`、`pnpm lint`、`vite build`、`git diff --check`：全部退出码 0。Vite 构建仍有第三方 `@vercel/sandbox` 的 source map 警告，构建成功且本次未安装或更新依赖。
- P3-X 源文件 SHA-256 保持不变；新测试的存储、账户和云执行均为内存替身，运行时结果标记为 UNVERIFIED，不得将测试通过解释成真实模型进化成功。

## 四、在线运行版本差异（只读核对）

Vercel Lab 项目 `prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs` 在本轮只读检查的最新 READY Preview：
- Deployment：`dpl_4QF634W76EreMM9AVLwNumhbwRdp`
- 部署源码 SHA：`1a0705f4f2eab5ac954765504194727c2d59ebaf`
- SSO 保护：enabled / all

**上述 Preview 不包含此次 P3-Y/Z/AA 的未发布修复。** 保持 Preview 与生产环境不变，没有发布/提升。

隔离 Supabase Lab `jnlbqgpezenmpksyklme` 的上一轮只读核验：28 项迁移、0 Mission、3 Job，其中 2 条为未关联原 Mission 的活动孤儿 Job；0 对应合成 Artifact、0 AI 和订阅预算行。本次没有修改这些状态；未将全局 Job 完整性报警标记为已清除。

## 五、尚未通过的上线验收

1. 必须先明确是否授权将已经审核并固定的特定提交部署到**独立 Vercel Lab Preview**；不能因本地 build 通过就说已上线。
2. 已知 2 条历史孤儿 Job 仍使全局完整性报警为 BLOCKED。不能静默删除、取消、重建父 Mission 或假定 scoped 审查代替全局治理；需独立授权并制定非破坏性处理或明确为阻断。
3. 需要全新**明确用户授权**才能注册唯一 Lab Mission 和实际源 Artifact、启用模型实验；先前禁止真实 MiniMax 的指令仍有效。即便获授权，须执行独立配额、物理调用预算和浏览器健康检查，最多 6 次物理调用、300,000 Token、20 分钟且每次调用前订阅剩余额度不低于 50%；任何不确定情况立即停止。
4. 真实 Candidate、独立 Judge、云 Chromium、Hidden/Final、Gate F 以及最终可交付进化成果均未验证。不得用内存 Mock 或预览部署状态伪报为已验收。

## 六、发布约束

本阶段仅在现有独立 `codex/artifact-evolution-governance-p0` 分支审计、修复及固定本地版本。不触碰主分支、生产、Vault Key、旧迁移或两个历史孤儿 Job，不调用真实 MiniMax，不启动 Mission，不通过 Git 推送触发自动 Preview，不进行生产/Preview 部署。需要发版时再次核验精确 Project、Team、分支、提交 SHA，并仅按新的授权部署。
