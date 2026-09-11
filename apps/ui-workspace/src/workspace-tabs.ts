/** 项目内的分区 id。单独一个文件（不是定义在 workspace.tsx 里）：workbench.tsx
 *  的侧栏要知道有哪些分区，但 ProjectPanel 本身现在是懒加载的（TD-011②）——
 *  从 workspace.tsx 里把这份数据连同 ProjectPanel 一起导入，会让侧栏一渲染
 *  就把整个项目面板（含它拉的全部 DS 表格/表单组件）拖进同一个同步包里，
 *  这条数据本该带来的「按需加载」也就名存实亡。 */

/** Runtime 自持的四个控制面（接入指南 §6.3）。每个项目都有。 */
export type RuntimeTabId = "overview" | "context" | "tasks" | "audit";

/**
 * 加上 `product`：**产品自己的界面**（ADR-023，owner 2026-09-11 定位置）。只在契约
 * 声明了界面时出现，出现时排第一、并且是进项目的默认页；没声明的产品没有这一格。
 */
export type TabId = RuntimeTabId | "product";

/** 项目内的分区。**这是产品自己的导航，所以它属于侧栏** —— 进了产品就是进了
 *  另一套框架（macOS 的应用源列表就是这么回事）。产品界面那一格不在这里：它有没有
 *  取决于契约，由侧栏按守护进程的回答另行加在最前面。 */
export const PROJECT_TABS: Array<{ id: RuntimeTabId; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "context", label: "上下文" },
  { id: "tasks", label: "任务" },
  { id: "audit", label: "审计" },
];
