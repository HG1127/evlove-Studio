# Artifact Type Contract · V2.4

V2.4 不再把所有上传物都视为“文本”。每个 Source Artifact 在接入时会持久化两个层级：

```ts
artifactKind:
  | "prompt"
  | "workflow"
  | "document"
  | "presentation"
  | "spreadsheet"
  | "codebase"
  | "knowledge"
  | "image"
  | "media"
  | "generic"

artifactDescriptor: {
  family:
    | "text"
    | "workflow"
    | "presentation"
    | "spreadsheet"
    | "codebase"
    | "knowledge"
    | "image"
    | "media"
    | "fixed-layout"
    | "package"
    | "generic"
  subtype
  adapterId
  confidence
  preservationMode
  fidelity
  formatExtension
  editable
  capabilities
  evolutionDimensions
  requiredValidations
  limitations
}
```

## Descriptor 是运行契约，不只是 UI 标签

它会进入：
- Source Understanding
- Project-specific Acceptance Rubric
- Context Retrieval
- Candidate Artifact Builder
- Baseline / Hidden Eval
- Artifact Acceptance
- Same-format Materializer
- 用户可见流程阶段名称

因此成果物类型真正改变执行逻辑。

## 原生适配示例

### PPTX
`presentation-pptx-ooxml`

```text
PPTX package
→ slide/text-run structure
→ slide-level candidate blueprint
→ page/story/editability acceptance
→ accepted snapshot
→ write back original OOXML package
```

### DOCX
`document-docx-ooxml`

```text
DOCX package
→ document parts / text runs
→ part-level candidate blueprint
→ structure/depth/integrity acceptance
→ write back original package
```

### XLSX
`spreadsheet-xlsx`

```text
Workbook
→ Sheet / Cell / Formula / Type / Format
→ cell-level candidate blueprint
→ formula/data/business acceptance
→ apply changes on original workbook
→ same-format workbook
```

### Code ZIP
`codebase-zip-repository`

```text
original ZIP + file tree
→ relevant-file retrieval
→ changed file map
→ contract/build/test/regression acceptance
→ overlay changed files on original ZIP
```

### Workflow
`workflow-structured`

按 Node / Edge / State / Gate / Error Path / I-O Contract 进化，不按文章段落改写。

### Prompt
`prompt-text`

按 Instruction / Constraint / Output Contract / Robustness 进化。

### PDF / Image / Media
这些格式可以建立专属标准，但没有对应高保真 Renderer 时：

> **Format Hard Gate = FAIL**

系统必须阻止假交付，而不是输出 Markdown 冒充 PDF/图片/视频。

## Mixed Artifact

一个项目可以同时含 PPT + Code + Excel 等多个 Target。

用户仍然只看一条简单主流程，但底层每个 Target 独立使用自己的：
- Parser
- Context Retriever
- Builder
- Evaluator
- Acceptance
- Materializer

最后再做跨成果物一致性检查并按各自原格式打包。
