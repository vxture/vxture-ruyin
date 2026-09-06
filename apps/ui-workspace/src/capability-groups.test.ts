/**
 * 业务功能分组。
 *
 * 这组用例问的不是「分得准不准」—— 关键词表当然会漏。问的是**分类器有没有说谎**：
 * 认不出来时是否老老实实进「其他」、计数加不加得起来、组的顺序是不是稳定的。
 */

import { describe, expect, it } from "vitest";
import {
  CAPABILITY_GROUPS,
  classifyCapability,
  groupCapabilities,
  type CapabilityGroupId,
} from "./capability-groups";

describe("classifyCapability", () => {
  it("按名字与描述认出常见的几类", () => {
    const cases: Array<[CapabilityGroupId, { name: string; description?: string; id?: string }]> = [
      ["sheet", { name: "sn-da-excel-workflow", description: "Excel 数据分析多步编排器" }],
      ["document", { name: "thesis-docx", description: "论文排版" }],
      ["slide", { name: "codex-slides", description: "生成 PPT" }],
      ["research", { name: "browser-search", description: "联网检索资料" }],
      ["browser", { name: "playwright-skill", description: "浏览器自动化" }],
      ["language", { name: "translate-book", description: "整本书翻译" }],
      ["dev", { name: "refactor-helper", description: "重构一段 TypeScript 代码" }],
      ["collab", { name: "qiaomu-anything-to-notebooklm", description: "汇入知识库" }],
    ];
    for (const [expected, item] of cases) {
      expect(classifyCapability(item), item.name).toBe(expected);
    }
  });

  it("工具那一侧可以只靠 id 判 —— id 里往往就带着答案", () => {
    expect(classifyCapability({ id: "microsoft.playwright-mcp", name: "" })).toBe("browser");
    expect(classifyCapability({ id: "haris-musa.excel-mcp-server", name: "" })).toBe("sheet");
    expect(classifyCapability({ id: "ihor-sokoliuk.mcp-searxng", name: "" })).toBe("research");
  });

  it("认不出来就是「其他」，不猜一个看起来很像的", () => {
    expect(classifyCapability({ name: "xberg", description: "" })).toBe("other");
    expect(classifyCapability({ name: "", description: "" })).toBe("other");
  });

  it("先中先得：具体的组排在笼统的组前面", () => {
    // 「Excel 数据分析」既像表格也像数据 —— 用户是拿着一个 xlsx 来找它的。
    expect(classifyCapability({ name: "excel 数据分析" })).toBe("sheet");
  });

  it("已知的重叠：一句话同时命中两组时，靠前的那组拿走它", () => {
    // 「为代码库生成 API 文档」听起来是开发工具，但描述里有「文档」，而文档组
    // 排在开发组前面 —— 于是它进「文档」。**这是关键词法的代价，不是意外**：
    // 记在这里，下一个人看到它落在「文档」里时就知道为什么，也知道要动的是
    // KEYWORDS 的顺序或词条，而不是怀疑自己看错了。
    expect(classifyCapability({ name: "skill-seekers", description: "为代码库生成 API 文档" })).toBe(
      "document",
    );
  });

  it("大小写不影响判定", () => {
    expect(classifyCapability({ name: "PDF Toolkit" })).toBe("document");
    expect(classifyCapability({ name: "pdf toolkit" })).toBe("document");
  });
});

describe("groupCapabilities", () => {
  const items = [
    { name: "excel-writer", description: "写 xlsx" },
    { name: "pdf-reader", description: "读 PDF" },
    { name: "mystery", description: "无从判断" },
    { name: "another-pdf", description: "PDF 合并" },
  ];

  it("计数加得起来 —— 一条只进一组", () => {
    const groups = groupCapabilities(items, (i) => i);
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(items.length);
  });

  it("空组不出现", () => {
    const groups = groupCapabilities(items, (i) => i);
    const ids = groups.map((g) => g.group.id);
    expect(ids).not.toContain("slide");
    expect(ids).toContain("other");
  });

  it("组的顺序与 CAPABILITY_GROUPS 一致，不随数据次序变", () => {
    const forward = groupCapabilities(items, (i) => i).map((g) => g.group.id);
    const backward = groupCapabilities([...items].reverse(), (i) => i).map((g) => g.group.id);
    expect(backward).toEqual(forward);
    const order = CAPABILITY_GROUPS.map((g) => g.id);
    expect(forward).toEqual(order.filter((id) => forward.includes(id)));
  });

  it("空清单得到空结果，而不是一排 0", () => {
    expect(groupCapabilities([], (i) => i)).toEqual([]);
  });

  it("「其他」是最后一组 —— 没归好类的不排在正经分类前面", () => {
    const groups = groupCapabilities(items, (i) => i);
    expect(groups[groups.length - 1]?.group.id).toBe("other");
  });
});
