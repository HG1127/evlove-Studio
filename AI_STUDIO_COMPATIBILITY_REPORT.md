# AI Studio Compatibility Report · Evolve Studio V3.0

验证日期：2026-09-09

## 1. 输入基线

本版直接基于用户上传的 `evlove-studio-v2.8(1).zip` 继续升级，保留 V2.8 的 Repository Intelligence、Semantic Runtime、Candidate Snapshot、Successive Halving、Batch Runtime、Artifact Acceptance、Campaign、Outputs 和多模型路由。

## 2. V3.0 为什么需要重构

此前底层能力已经很多，但用户主流程仍然暴露大量技术状态：Target / Baseline / Problem / Root Cause / Plan / Experiment / Hidden / Release。更关键的是，不同 AI Operation 容易拿到相似的通用 Source 摘要，造成“流程节点很多，但没有明确围绕当前问题深入读取成果”的体验。

V3.0 改为：

```text
看懂成果
→ 找出关键差距
→ 生成并比较新版
→ 验证是否真的变好
→ 交付最佳成果
```

内部技术状态机继续保留，但不再作为用户主导航。

## 3. 真正影响运行时的改动

### 3.1 Stage-specific Artifact Retrieval

`sourceEvidence(project, focus)` 现在会把：
- 用户原始命令
- 当前步骤 focus
- Project-specific Acceptance Rubric

组合成检索 query，再通过 `retrieveTextContext()` 从真实 Artifact 中抽取相关片段。

因此：
- Problem 节点优先读取失败相关成果、流程和用户目标证据；
- Diagnosis 节点围绕选中问题读取相关成果、依赖与 Trace；
- Plan 节点围绕根因读取可修改区域和保护边界；
- Campaign 每轮重新围绕当前问题取证；
- Copilot 按用户当前问题读取相关证据。

不再所有步骤固定读取每个 Source 前 12,000 字符。

### 3.2 Human-readable Evidence Receipt

新增：
- `src/features/evolve/runtime/real-evolution-workflow.ts`

每个用户步骤都能产生：

```text
read[]      系统实际读取了什么
findings[]  当前最重要结论
outputs[]   本步真实产出
next        下一步
```

代码 ZIP 会显示 Repository Index / Critical Modules / Requirement Evidence；PPT/Excel/Document 显示真实 Slide/Sheet/结构读取结果。

### 3.3 5-step User Workflow

`stage-progress.tsx` 和 `adaptive-stage-guide.tsx` 已重构，用户只看到 5 个步骤。技术术语保留在高级详情，不再作为主流程。

### 3.4 中文结果表达

主标题、按钮、验收卡、流程说明优先使用中文业务语言：
- “当前成果体检”
- “找出关键差距”
- “生成并比较新版”
- “验证是否真的变好”
- “交付最佳成果”

## 4. 零配置 Parser

本地解析仍为默认能力，无需外部服务即可使用：
- ZIP / Code → Repository Intelligence / Babel AST / Dependency Graph
- PPTX / DOCX / XLSX / PDF / Text → Browser Local Parser

Docling / Unstructured / Tika / Custom 仅作为复杂 OCR/版面/特殊格式增强服务。

## 5. 继承 V2.8 性能能力

- Successive Halving
- Finalist-only Artifact Build
- Batch Artifact Runtime
- Population Judge
- Watchdog / timeout control
- deterministic ZIP overlay fast path
- failed-case retry
- AI performance diagnostics

## 6. 实际静态 QA

已执行：

```text
TS/TSX/JS/JSX source files     117
Syntax diagnostics               0
Missing local imports             0
V3.0 workflow smoke             9/9 PASS
Non-ASCII working paths           0
```

Smoke：`docs/release/v3.0-real-evolution-smoke.json`

## 7. npm / Build 限制

当前环境访问 npm registry 超时，没有获得项目 node_modules。因此没有声称：

```text
npm run check
npm run build
npm test
npm run test:e2e
```

已经 PASS。联网 AI Studio / 开发机仍需执行完整依赖 QA。

## 8. 最终 ZIP 包装规则

最终包使用 root-flat 结构；`package.json`、`index.html`、`vite.config.ts`、`src/` 均直接位于 ZIP 根目录。内部路径全部 ASCII，CRC 校验通过。
