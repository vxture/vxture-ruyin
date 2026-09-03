# @vxture/ruyin-document

如影（Ruyin）的结构化文档表示与渲染：内部表示为 mdast（Markdown 的标准 AST），上线格式为 Markdown 文本，分页 / 目录等 Markdown 说不了的构件走 `remark-directive` 指令；渲染器输出 `.docx`（OOXML）与 HTML（PDF 由宿主的 Chromium 排版）。

- 表达不了的构件**拒渲而不是少渲**：`lossy` 拒绝并带行号原因，`degraded` 照渲但说出来。
- 同构，云端 Runtime 可直接复用。
- 设计权威：vxture-ruyin 仓库 ADR-013 / ADR-016 / ADR-017。

All rights reserved.
