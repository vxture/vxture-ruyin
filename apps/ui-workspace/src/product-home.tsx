import { useState } from "react";
import { Button, Input } from "@vxture/design-system";
import { Api, type ProductInfo, type ProjectMeta } from "./api";
import { useT } from "./i18n";

/** Generic host container controls. Business resources remain package-owned. */
export function ProductHome({ api, product, projects, projectsState = "ready", catalog, onCatalog, onOpen, onCreated, onRefresh,onLibrary }: {
  api: Api; product: ProductInfo; projects: ProjectMeta[]; catalog: boolean;
  projectsState?: "loading" | "failed" | "ready";
  onCatalog: () => void; onOpen: (id: string) => void;
  onLibrary?:()=>void;
  onCreated: (id: string) => void | Promise<void>; onRefresh: () => void | Promise<void>;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("current");
  const [sort, setSort] = useState("created");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = projectsState === "ready";
  const mine = projects.filter(p => p.productId === product.id && p.workspaceId);
  let last: ProjectMeta | undefined;
  try { last = ready ? mine.find(p => !p.archivedAt && p.id === localStorage.getItem(`ruyin-last-project:${mine[0]?.workspaceId}:${product.id}`)) : undefined; } catch { /* Storage is optional. */ }
  const rows = mine.filter(p => (!catalog || (filter === "all" || (filter === "archived" ? !!p.archivedAt : !p.archivedAt))) && (!catalog || p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt));
  const create = async () => {
    if (!name.trim() || busy || !ready) return;
    setBusy(true); setError("");
    try { const p = await api.createProject(product.id, name.trim()); await onCreated(p.id); setCreating(false); setName(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true); setError("");
    try { await onRefresh(); } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const projectRows = (items: ProjectMeta[]) => items.map(p => <button key={p.id} className="product-project-row" onClick={() => onOpen(p.id)}>
    <strong title={p.name}>{p.name}</strong><span>{p.archivedAt ? t("nav.archived") : t("ph.current")}</span>
    <time dateTime={p.createdAt}>{t("ph.created")} {new Date(p.createdAt).toLocaleDateString()}</time>
    <span>{p.archivedAt ? t("ph.view") : t("nav.openProject")} →</span>
  </button>);
  return <div className="product-home">
    <header className="product-home-heading"><div><p>{product.name}</p><h1>{t(catalog ? "ph.projects" : "ph.title")}</h1></div>
      <Button disabled={product.availability !== "available" || !ready} onClick={() => setCreating(!creating)}>{t("ph.new")}</Button></header>
    {error && <p role="alert" className="error-box">{error}</p>}
    {creating && ready && <form className="product-create" onSubmit={e => {e.preventDefault(); void create();}}>
      <label>{t("ph.name")}<Input value={name} maxLength={120} onChange={e => setName(e.target.value)} autoFocus required /></label>
      <Button type="submit" disabled={busy || !name.trim()}>{t("ph.create")}</Button><Button type="button" variant="outline" onClick={() => setCreating(false)}>{t("ph.cancel")}</Button>
    </form>}
    {!ready && <section className="product-business-panel" aria-live="polite">
      <h2>{t(projectsState === "loading" ? "ph.loading" : "ph.loadFailed")}</h2>
      {projectsState === "failed" && <><p>{t("ph.loadFailedDetail")}</p><Button variant="outline" disabled={busy} onClick={() => void refresh()}>{t("ph.retry")}</Button></>}
    </section>}
    {catalog ? ready && <section className="product-business-panel">
      <div className="product-catalog-controls"><Input aria-label={t("ph.search")} placeholder={t("ph.search")} value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label={t("ph.filter")} value={filter} onChange={e => setFilter(e.target.value)}><option value="current">{t("ph.current")}</option><option value="archived">{t("nav.archived")}</option><option value="all">{t("ph.all")}</option></select>
        <select aria-label={t("ph.sort")} value={sort} onChange={e => setSort(e.target.value)}><option value="created">{t("ph.sortCreated")}</option><option value="name">{t("ph.sortName")}</option></select>
        <Button variant="outline" disabled={busy} onClick={() => void refresh()}>{t("ph.refresh")}</Button></div>
      <p className="product-helper">{t("ph.count", {shown:rows.length,total:mine.length})}</p>
      {rows.length ? <div className="product-project-list">{projectRows(rows)}</div> : <p>{t(mine.length ? "ph.noMatch" : "ph.empty")}</p>}
    </section> : <>
      {ready && <section className="product-business-panel"><div className="product-panel-heading"><h2>{t("ph.projects")}</h2><Button variant="outline" onClick={onCatalog}>{t("ph.allProjects")}</Button></div>
        {last && <div className="product-resume"><div><span>{t("ph.lastOpened")}</span><strong>{last.name}</strong></div><Button onClick={() => onOpen(last.id)}>{t("ph.continue")}</Button></div>}
        {mine.some(p => !p.archivedAt) ? <div className="product-project-list">{projectRows(rows.filter(p => !p.archivedAt && p.id !== last?.id).slice(0,3))}</div> : <p>{t("ph.empty")}</p>}
        <p className="product-helper">{t("ph.metadataLimit")}</p>
      </section>}
      <div className="product-resource-grid">{["templates", "knowledge"].map(section => <section className="product-business-panel" key={section}>
        <h2>{t(section === "templates" ? "ph.templates" : "ph.knowledge")}</h2>
        <p>{t(section === "templates" ? "ph.templateDesc" : "ph.knowledgeDesc")}</p>
        {section==="knowledge"&&onLibrary?<Button variant="outline" onClick={onLibrary}>{t("library.open")}</Button>:<p className="product-helper">{t("ph.resourcePending")}</p>}
      </section>)}</div>
    </>}
  </div>;
}
