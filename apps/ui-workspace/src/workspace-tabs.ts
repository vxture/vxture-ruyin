/** 项目内的分区 id。单独一个文件（不是定义在 workspace.tsx 里）：workbench.tsx
 *  的侧栏要知道有哪些分区，但 ProjectPanel 本身现在是懒加载的（TD-011②）——
 *  从 workspace.tsx 里把这份数据连同 ProjectPanel 一起导入，会让侧栏一渲染
 *  就把整个项目面板（含它拉的全部 DS 表格/表单组件）拖进同一个同步包里，
 *  这条数据本该带来的「按需加载」也就名存实亡。 */
export type TabId = "overview" | "context" | "tasks" | "audit";

/** 项目内的分区。**这是产品自己的导航，所以它属于侧栏** —— 进了产品就是进了
 *  另一套框架（macOS 的应用源列表就是这么回事）。 */
export const PROJECT_TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "context", label: "上下文" },
  { id: "tasks", label: "任务" },
  { id: "audit", label: "审计" },
];
