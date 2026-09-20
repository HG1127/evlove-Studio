# Evolve Studio V3.0 · Real Artifact Evolution Workflow

> **Engineering baseline:** all new architecture, backend and refactor work MUST follow [`PROJECT_RULES.md`](./PROJECT_RULES.md). The repository is migrating incrementally to `apps/* + packages/*`, with contracts/core/harness/adapters as enforced dependency boundaries.

V3.0 的目标不是继续增加更多“进化节点”，而是让普通用户真正看懂并使用一套**会读取真实成果、根据成果内容找到问题、构造新版、验收新版、交付同一成果**的进化工作流。

## 用户只看到 5 步

```text
1. 看懂成果
   ↓
2. 找出关键差距
   ↓
3. 生成并比较新版
   ↓
4. 验证是否真的变好
   ↓
5. 交付最佳成果
```

内部仍保留 Target / Baseline / Problem / Root Cause / Candidate / Hidden / Artifact Acceptance / Release / Learning 等工程能力，但这些技术节点不再直接作为用户主导航。

## V3.0 的核心原则

### 1. 每一步都必须读取真实成果
AI 不再每个节点重复拿“同一段前 12k 文本”做通用判断。

运行时会把：
- 用户原始进化要求
- 本步骤要解决的问题
- 项目专属 Acceptance Rubric
- Repository Intelligence / Artifact Graph

组合成 `readFocus`，再从真实成果中动态检索最相关的：
- 文件/模块
- 段落/章节
- Slide
- Sheet/Cell/Formula
- Workflow node/state
- Candidate Snapshot

送入当前节点。

### 2. 用户能看到“系统到底读了什么”
每个主步骤顶部统一展示：
- 本步输入
- 系统会做什么
- 本步产出
- 完成标准
- 系统实际读取了什么
- 当前最重要的结论
- 用户最终能拿到什么
- 下一步

### 3. 问题和原因分开
- 问题：用户/成果可以观察到的差距
- 根因：为什么发生，必须有证据和 falsifier

### 4. Candidate 必须是新版成果
实验比较的对象是 Candidate Artifact Snapshot，而不是修改建议文字。

### 5. 最终下载 = 已验收的同一版本
交付阶段不能重新生成另一份未验收内容。

## 自适应成果物策略

底层继续自动适配：
- Code / ZIP Repository
- PPTX
- DOCX
- XLSX / CSV
- Workflow JSON / YAML
- Prompt
- Knowledge
- Document / PDF
- Mixed Package

同时 Semantic Runtime 会结合业务对象与用户意图动态决定“什么叫变好”。

## 零配置解析

默认不需要配置外部 Parser：
- ZIP/代码：内置 Repository Intelligence / Babel AST / Dependency Graph
- PPTX/DOCX/XLSX/PDF/Text：内置本地解析

Docling / Unstructured / Tika / Custom 仅作为复杂版面、OCR、特殊格式的可选增强服务。

## AI / Runner

- 多供应商 / 多模型 Operation Routing 保留
- Candidate Generator 与 Independent Judge 可使用不同模型
- V2.8 Successive Halving / Batch Runtime / Watchdog 性能优化继续保留
- 未连接真实 E2E / Visual Runner 时，相关结果保持 `UNVERIFIED`，不会伪装为 PASS/FAIL

## 启动

```bash
pnpm install
pnpm dev
```

默认 Vite：`0.0.0.0:8000`。

冻结前建议执行：

```bash
pnpm architecture:check
pnpm build
pnpm test
pnpm runner:test
```

## 重点文档

- `docs/release/v3.0-real-artifact-evolution.md`
- `docs/release/v3.0-validation-report.md`
- `docs/contracts/v3.0-user-workflow-contract.md`
