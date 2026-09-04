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
export const SETTINGS_SECTIONS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: "account", label: "账户", icon: "role" },
  { id: "general", label: "通用设置", icon: "settings" },
  { id: "connectors", label: "连接器", icon: "plugs-connected" },
  { id: "database", label: "数据库", icon: "table" },
  { id: "updates", label: "软件更新", icon: "arrow-down" },
  { id: "about", label: "关于", icon: "info" },
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
