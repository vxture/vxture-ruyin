/** 设置的分区 id。单独一个文件（不是定义在 settings.tsx 里）：同 TabId 的
 *  理由——SettingsView 本身现在是懒加载的（TD-011②），从 settings.tsx 里
 *  连同它一起导入这份数据会拖进整个设置页的 DS 组件面。 */
export type SectionId =
  | "account"
  | "general"
  | "privacy"
  | "connectors"
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
  { id: "general", label: "通用", icon: "settings" },
  { id: "privacy", label: "数据与隐私", icon: "lock" },
  { id: "connectors", label: "连接器", icon: "plugs-connected" },
  { id: "updates", label: "软件更新", icon: "arrow-down" },
  { id: "about", label: "关于", icon: "info" },
];
