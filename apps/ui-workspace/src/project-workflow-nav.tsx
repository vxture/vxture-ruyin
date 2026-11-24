import type { ReactNode } from "react";
import { Icon, ShellIconButton } from "@vxture/design-system";
import type { ProductNavItem } from "./product-navigation";
import { useT } from "./i18n";

export function ProjectWorkflowNav({items, projectId, activeId, collapsed, onToggle, onNavigate, footer}: {
  items: ProductNavItem[]; projectId: string; activeId: string; collapsed: boolean;
  onToggle: () => void; onNavigate: (href: string) => void; footer: ReactNode;
}) {
  const t = useT();
  const timestamp = (value?: string) => value ? new Date(value).toLocaleString(undefined, {year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}) : t("flow.unrecorded");
  const duration = (start?: string, end?: string) => {
    if (!start || !end) return t("flow.unrecorded");
    const minutes = Math.floor((Date.parse(end)-Date.parse(start))/60000);
    return minutes < 1 ? t("flow.lessMinute") : t("flow.minutes",{count:minutes});
  };
  const starts = items.map(i=>i.startedAt).filter((v):v is string=>!!v).sort();
  const ends = items.map(i=>i.completedAt).filter((v):v is string=>!!v).sort();
  const completed = items.filter(i=>i.state === "complete").length;
  return <div className={`project-workflow-nav${collapsed ? " is-collapsed" : ""}`}>
    <div className="shrink-0 p-2xs"><div className="workflow-nav-heading flex h-header-sm items-center gap-xs"><span className="flex shrink-0 items-center justify-center size-control-xl"><ShellIconButton icon="sidebar" label={t(collapsed?"nav.expand":"nav.collapse")} onClick={onToggle}><Icon name="sidebar" size="md"/></ShellIconButton></span></div></div>
    <div className="workflow-scroll">
    <a className="workflow-info" href={`#ws/${projectId}/overview`} title={t("flow.settings")} aria-label={t("flow.settings")} aria-current={activeId==="configuration"?"page":undefined} onClick={e=>{e.preventDefault();onNavigate(e.currentTarget.getAttribute("href")!);}}><span className="workflow-icon-slot"><span className="workflow-marker"><Icon name="settings" size="sm"/></span></span><span className="workflow-label">{t("flow.settings")}</span></a>    <nav aria-label={t("nav.workflow")} className={collapsed?"workflow-timeline is-collapsed":"workflow-timeline"}>
      {items.map((item,index)=><div className="workflow-step" key={item.id} data-state={item.state ?? "pending"}>
        <a href={`#ws/${projectId}/product/${item.id}`} title={item.label} aria-label={item.label} aria-current={activeId===item.id?"step":undefined} onClick={e=>{e.preventDefault();onNavigate(e.currentTarget.getAttribute("href")!);}}>
          <span className="workflow-icon-slot" aria-hidden><span className="workflow-marker">{item.state==="complete"?"✓":String(index+1).padStart(2,"0")}</span></span>
          <><span className="workflow-step-name">{String(index+1).padStart(2,"0")} {item.label}</span><span className="workflow-state">{t(`flow.${item.state??"pending"}`)}</span></>
        </a>
        <dl><div><dt>{t("flow.started")}</dt><dd>{timestamp(item.startedAt)}</dd></div><div><dt>{t("flow.finished")}</dt><dd>{timestamp(item.completedAt)}</dd></div><div><dt>{t("flow.duration")}</dt><dd>{duration(item.startedAt,item.completedAt)}</dd></div></dl>
      </div>)}
    </nav>
    </div><div className="workflow-total"><strong>{t("flow.total")}</strong><span>{t("flow.progress",{done:completed,total:items.length})}</span><p>{duration(starts[0],completed===items.length?ends.at(-1):undefined)}</p></div>
    <div className="workflow-footer h-header-xl shrink-0">{footer}</div>
  </div>;
}
