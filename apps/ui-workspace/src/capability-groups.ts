/**
 * 能力的**业务功能分组** —— 233 条技能 + 27 台服务器摊成一张平表，谁也找不到
 * 自己要的那一条。分组是为了「选得动、看得清、汇得拢」。
 *
 * ## 为什么按业务功能分，而不是按来源分
 *
 * 界面上已经有一个按**来源层**（预置 / 产品分发 / 用户 / 项目）的筛选，那回答
 * 的是「这条打哪儿来、谁能盖住谁」—— 是治理问题。而一个正在配置能力的人问的
 * 是「我要处理表格，有什么」。两个问题不能共用一套切法，硬合并只会让其中一套
 * 变得不诚实。
 *
 * ## 这份分类是关键词匹配，不是推断
 *
 * 它按名字与描述里的关键词判，**顺序即优先级，先中先得**。匹配不上的落进
 * 「其他」，而且「其他」**永远显示**、带计数 —— 一个把没归好类的东西藏起来的
 * 分类器，会让人以为清单变短了。
 *
 * 关键词表会漏。这不是缺陷，是这种做法的已知代价：上游的技能名与描述是别人写
 * 的，我们没有权威的业务标签可用。**宁可让它落进「其他」，也不要猜一个看起来
 * 很像的组** —— 分错组的那一条，比没分组更难找到。
 */

export type CapabilityGroupId =
  | "document"
  | "sheet"
  | "data"
  | "slide"
  | "research"
  | "browser"
  | "language"
  | "media"
  | "dev"
  | "collab"
  | "other";

export interface CapabilityGroup {
  id: CapabilityGroupId;
  label: string;
  /** 一句话说清这一组收的是什么 —— 组名只有两三个字，撑不住边界。 */
  desc: string;
}

/**
 * 组的顺序 = 界面上的顺序，也是匹配顺序。
 *
 * 排在前面的先拿走属于它的条目，所以**具体的排在笼统的前面**：一条讲「Excel
 * 数据分析」的技能应该进「表格」而不是「数据」，因为用户是拿着一个 xlsx 来
 * 找它的。
 */
export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
  // 语言排在文档前面：它的关键词很专（翻译 / 润色 / 本地化 / 术语），误伤面小；
  // 排在后面时，「把这本书翻译成中文并排版成 PDF」会被文档组先拿走，于是「语言」
  // 一条都没有 —— 实测 233 条技能确实是 0，而语料里明明有翻译类技能。
  { id: "language", label: "语言", desc: "翻译、润色、术语与本地化" },
  { id: "document", label: "文档", desc: "Word / PDF / Markdown、写作、排版、合同与标书" },
  { id: "sheet", label: "表格", desc: "Excel / CSV 读写、公式、透视、图表" },
  { id: "data", label: "数据", desc: "SQL、数据库、统计与分析" },
  { id: "slide", label: "演示", desc: "PPT / 幻灯片" },
  { id: "research", label: "检索", desc: "联网搜索、资料调研、情报汇集" },
  { id: "browser", label: "浏览器", desc: "网页自动化、抓取、截屏" },
  { id: "media", label: "图像与音视频", desc: "图片、视频、音频、OCR" },
  { id: "dev", label: "开发", desc: "代码、接口、测试与工程工具" },
  { id: "collab", label: "协作", desc: "邮件、日程、知识库、客户与项目系统" },
  { id: "other", label: "其他", desc: "关键词表没认出来的 —— 不猜，如实放在这里" },
] as const;

/**
 * 每组的关键词。中英文都收：上游技能的描述中英混排是常态。
 *
 * 全部小写比较；中文不分词，直接子串命中即可（`indexOf`），这对中文反而比分词
 * 稳 —— 见 storage.ts 里 FTS 分词器那一段实测。
 */
const KEYWORDS: Record<Exclude<CapabilityGroupId, "other">, readonly string[]> = {
  document: [
    "docx", "word", "pdf", "markdown", "文档", "写作", "排版", "论文", "thesis",
    "合同", "标书", "投标", "报告", "简历", "resume", "pandoc", "docling",
    "markitdown", "公文", "写作助手", "校对", "typst", "latex",
  ],
  sheet: ["excel", "xlsx", "xls", "csv", "spreadsheet", "表格", "工作表", "透视", "pivot", "单元格"],
  data: ["sql", "database", "数据库", "统计", "分析", "analytics", "dataset", "数据清洗", "bi ", "指标"],
  slide: ["ppt", "pptx", "slide", "幻灯", "presentation", "keynote", "deck", "演示文稿"],
  research: [
    "search", "搜索", "检索", "调研", "research", "情报", "serp", "duckduckgo",
    "tavily", "brave", "bing", "baidu", "exa", "jina", "firecrawl", "searxng",
    "websearch", "资料收集", "文献",
  ],
  browser: ["browser", "playwright", "puppeteer", "浏览器", "抓取", "爬", "crawl", "scrape", "截屏", "screenshot"],
  language: ["translate", "translation", "翻译", "润色", "语法", "i18n", "本地化", "改写", "术语"],
  media: ["image", "图片", "图像", "video", "视频", "audio", "音频", "语音", "ocr", "vision", "绘图", "配图"],
  dev: [
    "code", "代码", "git", "github", "api", "sdk", "debug", "调试", "test", "测试",
    "python", "typescript", "javascript", "编程", "重构", "lint", "ci ", "部署",
  ],
  collab: [
    "email", "邮件", "calendar", "日程", "会议", "notion", "jira", "slack", "飞书",
    "钉钉", "crm", "客户", "工单", "知识库", "notebooklm", "看板",
  ],
};

export interface Classifiable {
  name: string;
  description?: string | undefined;
  /** 工具那一侧用 id（`microsoft.playwright-mcp` 这种），里面往往就带着答案。 */
  id?: string | undefined;
}

/**
 * 判一条能力属于哪一组。**先中先得**，一条只进一组。
 *
 * 一条能力当然可能同时是「表格」和「数据」，但让它出现在两个组里，计数就再也
 * 加不起来 —— 「文档 12 · 表格 8」如果彼此重叠，这一行就不是事实了。
 */
export function classifyCapability(item: Classifiable): CapabilityGroupId {
  const haystack = `${item.id ?? ""} ${item.name} ${item.description ?? ""}`.toLowerCase();
  for (const group of CAPABILITY_GROUPS) {
    if (group.id === "other") continue;
    const words = KEYWORDS[group.id];
    if (words.some((w) => haystack.includes(w))) return group.id;
  }
  return "other";
}

export interface GroupedCapabilities<T> {
  group: CapabilityGroup;
  items: T[];
}

/**
 * 按组归拢，**空组不返回** —— 一个永远显示 0 的组只是噪音。
 * 「其他」不特殊对待：它有条目才出现，没有就不出现。
 */
export function groupCapabilities<T>(
  items: readonly T[],
  of: (item: T) => Classifiable,
): GroupedCapabilities<T>[] {
  const buckets = new Map<CapabilityGroupId, T[]>();
  for (const item of items) {
    const id = classifyCapability(of(item));
    const bucket = buckets.get(id);
    if (bucket) bucket.push(item);
    else buckets.set(id, [item]);
  }
  return CAPABILITY_GROUPS.flatMap((group) => {
    const list = buckets.get(group.id);
    return list && list.length > 0 ? [{ group, items: list }] : [];
  });
}
