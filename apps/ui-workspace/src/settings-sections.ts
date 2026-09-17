import type { MessageKey } from "./i18n";

/** 设置的分区 id。单独一个文件（不是定义在 settings.tsx 里）：同 TabId 的
 *  理由——SettingsView 本身现在是懒加载的（TD-011②），从 settings.tsx 里
 *  连同它一起导入这份数据会拖进整个设置页的 DS 组件面。 */
export type SectionId =
  | "account"
  | "general"
  | "connectors"
  /**
   * 添加连接器**是它自己的地址**（`#settings/connectors-add`，owner 2026-09-04
   * 第 5 条）。上一版只是在同一个分区里换了内容，从地址栏、从标题栏的返回、
   * 从历史记录看它都还是同一页 —— 那不叫拆开。
   *
   * 它不进侧栏：侧栏是「我能去哪儿」，添加是从列表页发起的一个动作。
   */
  | "connectors-add"
  /**
   * 模型平台 —— 只展示本工作区被授权的模型，不调用、不配置；模型由各智能体直接对接
   * Atlas（ADR-026 §2 第 3 条）。
   */
  | "models"
  /** 能力平台（ADR-018 §2.7）：本机装着的技能与工具，一张清单。代码标识符仍叫 skills。 */
  | "skills"
  | "database"
  | "updates"
  | "about";

/**
 * 设置的分区。**这是设置自己的导航，所以它属于侧栏。**
 *
 * 原本它是页面内的第二根竖直导航栏 —— 于是设置页上并排站着两根：工作台的
 * 256px 和这里的 180px，436px 全是导航，右边才是内容。设置是一个应用，应用有
 * 自己的框架（和产品态同一套道理）。
 */
/**
 * 分区表里放的是**目录键**，不是那句中文（2026-09-17 起）：这份数据在侧栏、
 * 搜索、面包屑各用一次，词句只能有一处来源，而它现在按语言取。
 */
export const SETTINGS_SECTIONS: Array<{
  id: SectionId;
  labelKey: MessageKey;
  icon: string;
}> = [
  { id: "account", labelKey: "sections.account", icon: "role" },
  { id: "general", labelKey: "sections.general", icon: "settings" },
  /**
   * 能力平台在连接器**前面**（owner 2026-09-07）。
   *
   * 两者是「有什么能力」与「这些能力从哪儿接进来」的关系：连接器是能力平台的
   * 一个**来源**，不是与它并列的另一件事。来源排在结果前面，读者就得先理解一个
   * 他还没有理由关心的东西。
   */
  /** 模型平台排在能力平台**前面**（owner 2026-09-15）。只展示，不调用。 */
  { id: "models", labelKey: "sections.models", icon: "cpu" },
  { id: "skills", labelKey: "sections.skills", icon: "sparkles" },
  { id: "connectors", labelKey: "sections.connectors", icon: "plugs-connected" },
  { id: "database", labelKey: "sections.database", icon: "table" },
  { id: "updates", labelKey: "sections.updates", icon: "arrow-down" },
  { id: "about", labelKey: "sections.about", icon: "info" },
];

/**
 * 旧的分区 id → 现在的分区（owner 2026-09-04 重组）。
 *
 * `general`（偏好三轴）整组搬进「账户」做第二个板块，`privacy` 的内容接管
 * 「通用设置」这个位置。**旧链接不能变成白屏**：地址栏里可能还留着
 * `#settings/privacy`，侧栏收起时用户也可能从历史回来。
 */
export function resolveSection(id: string): SectionId {
  if (id === "privacy") return "general";
  // 添加页有地址但不在侧栏，所以要单独认一次。
  if (id === "connectors-add") return "connectors-add";
  return (SETTINGS_SECTIONS.some((s) => s.id === id) ? id : "account") as SectionId;
}
