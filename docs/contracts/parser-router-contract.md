# Parser Router Contract · V2.7

## 核心原则

Parser Router 是“增强解析”，不是“替代本地成果适配器”。

- ZIP / Code / Text：始终优先 Local Parser / Repository Intelligence。
- Office/PDF：Local 原格式结构用于回写，外部 Parser 可增强语义/布局理解。
- 外部 Parser 失败：回退 Local，并记录 warning。
- Parser 能力不足：降低证据等级，不直接把成果判 FAIL。

## Parser Services

### Docling

推荐：PDF / DOCX / PPTX / XLSX。

认证：

```text
X-Api-Key
```

### Unstructured

推荐：复杂 PDF / Scan / OCR / 分区结构。

认证：

```text
unstructured-api-key
```

### Apache Tika

推荐：广谱 MIME / metadata / text extraction，未知格式兜底。

### Custom Parser

企业内部专用 Parser / OCR / VLM / legacy format service。

## Auto Route

```text
ZIP / Code / Text → Local only
PDF → Docling → Unstructured → Tika → Custom
Office → Docling → Unstructured → Tika → Custom
Image → Unstructured → Custom → Tika
Unknown → Tika → Custom → Docling → Unstructured
```

只尝试 Enabled 且 Endpoint 非空的服务。

## Connection Test

设置页可对每个 Parser Service 发送一个最小 `text/plain` fixture，验证：

- endpoint 可达
- authentication header 正确
- response 包含可读文本
- latency

连接测试失败不会改变成果状态。
