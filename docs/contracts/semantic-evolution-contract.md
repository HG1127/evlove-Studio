# Semantic Evolution Contract · V2.5

## 核心原则

V2.5 不允许把“文件格式”直接等价为“进化对象”。系统明确区分四层：

```text
ContainerProfile   物理容器：ZIP / PPTX / XLSX / DOCX / PDF / Folder ...
        ↓
ArtifactGraph      实际组成：子文件 / Sheet / Slide / Module / Document ...
        ↓
SemanticObject     业务对象：融资资料体系 / 战略经营体系 / 培训体系 / 软件系统 / 任意业务成果 ...
        ↓
EvolutionIntent    用户希望它为什么、如何变好
```

最终流程与验收由：

```text
SemanticObject + EvolutionIntent + ArtifactGraph + RuntimeCapabilities
```

共同编译，而不是由 `.zip` / `.pptx` 等扩展名直接选择流程。

## ContainerProfile

只描述技术容器能力：
- containerType
- format / extension
- canUnpack
- editable
- preservationMode

**ContainerProfile 不得决定业务流程。**

## ArtifactGraph

把输入展开成节点和关系：
- root artifact
- package child entry
- artifact family
- semantic role
- contains / must-match / depends-on / references 等关系

多 Target 自动建立联合一致性关系。ZIP 的 `structuredContent.kind` 必须是 `package`，只有上层证据证明是软件工程时才将 SemanticObject 识别为 `software-system`。

## SemanticObject

必须包含：
- typeId
- label
- domain
- description
- confidence
- audience
- primaryOutcome
- componentArtifactIds
- crossArtifactRequirements
- reasoning

SemanticObject 可以来自：
1. deterministic semantic draft；
2. Live AI Intake；
3. 用户通过新命令纠正后重新编译。

## EvolutionIntent

从用户命令编译：
- summary
- desiredChanges
- mustPreserve
- outputRequirements
- qualityPriorities

用户命令是最高优先级，不允许固定 Artifact Type Rubric 覆盖用户真实目标。

## Dynamic Workflow

用户界面始终只保留 6 个位置以降低学习成本：

```text
1 → 2 → 3 → 4 → 5 → 6
```

但每个位置的：
- label
- flow
- input
- action
- output
- done

由 Semantic Workflow Compiler 动态生成。

例如融资资料 ZIP：

```text
融资目标 → 资料关系 → 说服力诊断 → 分成果进化 → 联合验收 → 资料包交付
```

企业战略包：

```text
战略目标 → 战略关系 → 断点诊断 → 体系进化 → 闭环验收 → 体系交付
```

未识别业务对象时：

```text
理解目标 → 建立模型 → 诊断问题 → 自适应进化 → 动态验收 → 原格式交付
```

## Dynamic Acceptance

项目 Rubric = 三层合成：

1. **User Intent**：用户原始要求，最高优先级；
2. **Business Object Standard**：该业务对象真正成功的标准；
3. **Artifact / Technical Integrity**：格式、结构、可编辑性、可运行性、未授权内容保护。

多成果项目额外增加 Cross-artifact Consistency Hard Gate。

所有 Criteria 最终归一到 100 权重，并继续进入 Eval Suite Mapping、Hidden Holdout 和 Artifact Acceptance。

## Native Artifact Runtime

Semantic Workflow 决定“做什么”；Artifact Adapter 决定“怎么修改和回写”。

例如融资资料包里的：
- PPTX → Presentation Builder
- XLSX → Spreadsheet Builder
- DOCX → Document Builder

各自按原生结构构造 Candidate，最后做联合验收，再保持原格式重新打包。

这两层禁止再次混淆。
