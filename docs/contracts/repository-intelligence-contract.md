# Repository Intelligence Contract · V2.7

## 目的

代码/系统 ZIP 不再使用 `textContent.length / raw size` 表示“解析覆盖率”。Repository Intelligence 将“索引、结构、语义取证、运行证据”拆开。

## Deep Index

上传阶段对 ZIP：

```text
Manifest
→ Role classification
→ Text/code deep index
→ AST/symbol extraction
→ internal import resolution
→ critical module ranking
→ feature clustering
```

原型安全上限：

```text
MAX_ZIP_INDEX_FILES        600
MAX_ZIP_INDEX_TOTAL_CHARS  4,000,000
MAX_ZIP_INDEX_FILE_CHARS   120,000
MAX_ZIP_SUMMARY_CHARS      105,000
```

`MAX_ZIP_SUMMARY_CHARS` 只约束首次 LLM digest，不约束 Deep Index。

## RepositoryIntelligence

核心字段：

```text
totalEntries
eligibleEntries
deepIndexedEntries
codeFiles
parsedCodeFiles
indexedSymbols
internalImports
resolvedInternalImports
dependencyEdges
entrypoints
criticalModules
featureClusters
```

## 用户目标证据覆盖

`requirementAnchors(command)` 把用户命令拆成可检索目标。

例如：

```text
成果物输入兼容
流程完整闭环
UI/UX 与操作体验
```

每个目标用：

```text
path
+ content
+ AST symbols
+ critical score
+ file role
+ dependency neighbors
```

检索实现证据。

输出：

```text
anchor.label
anchor.coverage
anchor.evidencePaths[]
```

该 coverage 表示“当前 repository 是否有足够实现证据支持继续诊断”，**不表示真实功能已经通过。**

## Coverage 指标

### File Index Coverage

```text
indexedEntries / totalEntries
```

### Deep Index Coverage

```text
deepIndexedEntries / eligibleEntries
```

### Critical Module Coverage

关键入口/流程/解析/验证/UI 模块中有可读内容和 AST 的比例。

### Dependency Coverage

```text
resolvedInternalImports / internalImports
```

### Requirement Evidence Coverage

用户目标中，有足够强相关实现证据的目标比例。

### Semantic Coverage

V2.7 UI 使用：

```text
25% Deep Index
35% Critical Module
15% Dependency
25% User Goal Evidence
```

它衡量“系统理解是否足以支持进化”，不替代 E2E/Visual Evidence。

## Test Evidence 隔离

以下内容继续索引，但降低语义检索权重：

```text
tests/
e2e/
fixtures/
*.test.*
*.spec.*
test-results/
playwright-report/
docs/release/
docs/reference/
```

它们可以证明历史/预期行为，但不能反客为主定义用户进化目标。
