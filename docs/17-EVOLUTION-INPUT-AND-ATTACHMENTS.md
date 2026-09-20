# 17 · Evolution Input & Attachments

## 1. 为什么 Input 是 Evolve 的第一对象

Evolve 不应该从“填一个项目名称”开始，而应该从：

> **这是我现在的版本，这是参考材料，这是测试样本，我希望它这样变好。**

因此 `SourceArtifact` 和 `evolutionCommand` 是整个项目证据链的起点。

## 2. 输入架构

```text
Evolution Composer
│
├─ files[]
│  ├─ target
│  ├─ reference
│  └─ eval
├─ pastedText
├─ evolution command
├─ department
└─ requestedObjectType
        ↓
POST /api/v1/intake
        ↓
size / count validation
        ↓
Source Extractor
├─ Text/Code → UTF-8
├─ PDF → pdf-parse
├─ DOCX → mammoth
├─ XLS/XLSX → xlsx
├─ ZIP → manifest + selected source
└─ Image/complex file → AI file/vision path
        ↓
Prototype local asset storage
        ↓
Optional OpenAI user_data file upload
        ↓
AI Intake Structured Output
        ↓
Source Understanding + Evolve Contract draft
```

## 3. SourceArtifact

核心字段：

```ts
type SourceArtifact = {
  id: string;
  name: string;
  role: "target" | "reference" | "eval";
  mimeType: string;
  size: number;
  extension: string;
  inputMode: "upload" | "paste" | "remote";
  parseStatus: "ready" | "ai-file" | "image" | "binary" | "unsupported" | "error";
  textContent?: string;
  textExcerpt?: string;
  summary?: string;
  openaiFileId?: string;
  storageRef?: string;
  structure: string[];
  warnings: string[];
  createdAt: string;
};
```

## 4. Artifact Role

### target
Candidate Patch 应优先指向它。一个项目可有多个 target，例如 System Prompt + Workflow JSON。

### reference
只读参考，不允许 Candidate 自动修改。例如优秀样例、制度规范、品牌语气指南。

### eval
输入/验收样本。它可以被 AI 用来构造 Eval Suite，但不应该直接作为 Candidate 的修改目标。

## 5. 连续对话

Evolution Composer 是一个持续 Intake，而非一次性上传页。

用户可以：
1. 首次上传 Agent Prompt；
2. AI 读取；
3. 再上传优秀报告；
4. 再补充“格式不能改变”；
5. 再上传失败样本；
6. 最后确认创建项目。

AI 每次必须基于已有 Source + 新 Source 重新汇总目标。

## 6. Source 变化 → 下游失效

任何 materially changed source 都必须触发：

```text
Target Ready = ready / waiting approval
Eval Suite = reset
Baseline = reset
Problem = reset
Diagnosis = reset
Candidates = reset
Experiment = reset
Validation = reset
Release = idle
```

这样才能保证 Evidence Chain 与当前 Source 一致。

## 7. 文件生命周期

当前前端 Prototype：
- 元数据：project LocalStorage
- 文件：`.evolve-data/uploads`
- OpenAI live file：`openaiFileId`

Production 必须改为：

```text
Source Asset Service
↓
Object Storage
+ checksum
+ tenant/workspace ownership
+ MIME validation
+ malware scan
+ retention
+ deletion job
+ audit
```

不要把文件二进制写进 PostgreSQL 主业务表。

## 8. 安全

- 浏览器不能拿 OPENAI_API_KEY。
- 文件扩展名不能代替 MIME/内容检查。
- 生产环境增加 malware scan。
- 用户上传内容视为不可信输入，不能允许文件内容覆盖系统级安全规则。
- ZIP 解包需要路径穿越保护、数量/尺寸限制；当前 Prototype 只读取 JSZip 内存对象并限制抽取文件数量。
- Prompt Injection 应在后续 AI Security Gate 增加专门 Eval。
