/** Machine package controls; host updates and commercial rights live elsewhere. */
import {useEffect,useRef,useState} from "react";
import {
  AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle,
  Button,EmptyState,Icon,Input,StatusBadge,
} from "@vxture/design-system";
import {ApiError,type Api,type ProductInfo,type RegistryCatalog} from "./api";
import {compareVersions,packageFor} from "./agent-catalog";
import {useT} from "./i18n";
import {InstallMenu,RegistryList} from "./agent-install-controls";

type Change={product:ProductInfo;version:string}|{product:ProductInfo;disable:true};

export function AgentManagementPage({api,onChanged}:{
  api:Api;onChanged:()=>void|Promise<void>;
}){
  const t=useT();
  const [products,setProducts]=useState<ProductInfo[]|null>(null),[catalog,setCatalog]=useState<RegistryCatalog|null>(null);
  const [loading,setLoading]=useState(false),[checking,setChecking]=useState(false),[loadFailed,setLoadFailed]=useState(false);
  const [busy,setBusy]=useState<string>(),[error,setError]=useState<string>(),[notice,setNotice]=useState<string>();
  const [confirm,setConfirm]=useState<Change>();
  const lock=useRef(false),alive=useRef(true),localRequest=useRef(0),catalogRequest=useRef(0);
  const [query,setQuery]=useState(""),[filter,setFilter]=useState<"all"|"updates"|"disabled">("all");
  const [registryOpen,setRegistryOpen]=useState(false);
  const load=async()=>{
    const request=++localRequest.current;setLoading(true);setLoadFailed(false);
    try{const rows=await api.products();if(alive.current&&request===localRequest.current)setProducts(rows.filter(row=>row.supply!=="builtin"));}
    catch{if(alive.current&&request===localRequest.current)setLoadFailed(true);}
    finally{if(alive.current&&request===localRequest.current)setLoading(false);}
  };
  const check=async()=>{
    const request=++catalogRequest.current;setChecking(true);
    try{const next=await api.registry();if(alive.current&&request===catalogRequest.current)setCatalog(next);}
    catch{if(alive.current&&request===catalogRequest.current)setCatalog({status:"unreachable",base:"",checkedAt:"",reason:""});}
    finally{if(alive.current&&request===catalogRequest.current)setChecking(false);}
  };
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;localRequest.current++;catalogRequest.current++;};},[api]);
  useEffect(()=>{void load();void check();},[api]);
  const changed=async()=>{await load();await check();await onChanged();};
  const updateOf=(product:ProductInfo)=>[...product.versions,...(packageFor(catalog,product.id)?[packageFor(catalog,product.id)!.version]:[])].some(version=>compareVersions(version,product.version)>0);
  const searched=products?.filter(product=>`${product.name} ${product.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const counts={all:searched?.length??0,updates:searched?.filter(updateOf).length??0,disabled:searched?.filter(product=>product.state==="inactive").length??0};
  const shown=searched?.filter(product=>filter==="all"||filter==="updates"&&updateOf(product)||filter==="disabled"&&product.state==="inactive");

  const change=async(action:Change|{product:ProductInfo;enable:true})=>{
    if(lock.current)return;
    lock.current=true;setBusy(action.product.id);setError(undefined);setNotice(undefined);
    try{
      if("version" in action){
        if(!action.product.versions.includes(action.version)){
          const installed=await api.installFromRegistry(action.product.id,action.version);
          if(installed.productId!==action.product.id||installed.version!==action.version)throw Error("Package identity mismatch");
        }
        await api.pinProductVersion(action.product.id,action.version);
      }else if("disable" in action)await api.deactivateProduct(action.product.id);
      else await api.activateProduct(action.product.id);
      if(alive.current){setConfirm(undefined);setNotice(t("agents.manage.saved"));}
      // Home refresh failure must not turn an acknowledged mutation into a failed install.
      await Promise.resolve(onChanged()).catch(()=>{});
    }catch(cause){
      if(alive.current)setError(t(cause instanceof ApiError&&cause.body.code==="PRODUCT_BUSY"?"agents.manage.busy":
        cause instanceof ApiError&&cause.body.code==="REGISTRY_PACKAGE_MISMATCH"?"agents.manage.mismatch":"agents.manage.changeFailed"));
    }finally{
      if(alive.current){await load();setBusy(undefined);}
      lock.current=false;
    }
  };
  return <>
    <section className="agent-management-page" aria-label={t("agents.manage.pageTitle")}>
        <header className="agent-management-header">
          <div><h1>{t("agents.manage.pageTitle")}</h1><p>{t("agents.manage.description")}</p></div>
          <InstallMenu api={api} toolbar registryOpen={registryOpen} onToggleRegistry={()=>setRegistryOpen(value=>!value)} onDone={changed} onError={setError}/>
        </header>
        {registryOpen&&<section className="agent-registry-panel" aria-label={t("home.install.catalogAria")}><h2>{t("home.install.catalogAria")}</h2><RegistryList api={api} open={registryOpen} onDone={changed} onError={setError}/></section>}
        <div className="agent-manager-toolbar">
          <div className="agent-manager-filters" role="group" aria-label={t("agents.manage.filter")}>
            {(["all","updates","disabled"] as const).map(value=><Button key={value} size="sm" variant={filter===value?"secondary":"ghost"} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{t(value==="all"?"agents.manage.all":value==="updates"?"agents.manage.updates":"agents.manage.disabled")}<span className="agent-manager-filter-count">{value==="updates"&&catalog?.status!=="ok"?"—":counts[value]}</span></Button>)}
          </div>
          <div className="agent-manager-tools"><Input aria-label={t("agents.manage.search")} placeholder={t("agents.manage.search")} value={query} onChange={event=>setQuery(event.target.value)}/>
          <Button variant="outline" size="sm" disabled={checking||loading||!!busy} onClick={()=>{void load();void check();}}>
            <Icon name="refresh" size="xs"/>{t(checking?"agents.manage.checking":"agents.manage.check")}
          </Button>
          </div>
        </div>
        <div className="agent-manager-body">
          {loading&&products===null&&<p role="status" className="text-body-sm text-muted-foreground">{t("agents.manage.loading")}</p>}
          {loadFailed&&<p role="alert" className="agent-manager-message">{t("agents.manage.loadFailed")} <Button variant="outline" size="sm" disabled={loading||!!busy} onClick={()=>void load()}>{t("ph.retry")}</Button></p>}
          {catalog?.status==="unreachable"&&<p role="status" className="agent-manager-message">{t("agents.manage.offline")}</p>}
          {error&&<p role="alert" className="agent-manager-message text-destructive">{error}</p>}
          {notice&&!error&&<p role="status" className="agent-manager-message">{notice}</p>}
          {products?.length===0&&!loadFailed&&<EmptyState icon="package" title={t("agents.manage.empty")} description={t("agents.manage.emptyHint")}/>}
          {!!products?.length&&shown?.length===0&&!loadFailed&&<EmptyState icon="package" title={t("agents.manage.noMatches")}/>}
          {shown?.map(product=>{
            const release=packageFor(catalog,product.id);
            const versions=[...new Set([...product.versions,...(release?[release.version]:[])])].sort((a,b)=>compareVersions(b,a));
            const newer=versions.find(version=>compareVersions(version,product.version)>0);
            const needsDownload=!!newer&&!product.versions.includes(newer);
            const blocked=needsDownload&&catalog?.status==="ok"&&!catalog.installable&&!release?.signed;
            return <article className="agent-install-record" key={product.id} aria-label={product.name}>
              <header className="agent-install-head">
                <span className="agent-install-icon" aria-hidden><Icon name="package" size="md"/></span>
                <div className="agent-install-identity"><h3>{product.name}</h3><p>{product.id}</p></div>
                <StatusBadge tone={product.state==="active"?"success":"neutral"}>{t(product.state==="active"?"agents.manage.enabled":"agents.manage.disabled")}</StatusBadge>
              </header>
              <div className="agent-install-actions">
                <span className="text-body-sm text-muted-foreground">{t("agents.manage.defaultVersion",{version:product.version})}</span>
                <span className="agent-install-buttons">
                  {newer&&<Button size="sm" disabled={!!busy||loadFailed||blocked} title={blocked?t("home.install.unsignedBlockedTitle"):undefined} onClick={()=>void change({product,version:newer})}>{t(busy===product.id?"agents.manage.working":"agents.manage.updateTo",{version:newer})}</Button>}
                  <Button variant="outline" size="sm" disabled={!!busy||loadFailed} onClick={()=>{setError(undefined);product.state==="active"?setConfirm({product,disable:true}):void change({product,enable:true});}}>{t(product.state==="active"?"agents.manage.disable":"agents.manage.enable")}</Button>
                </span>
              </div>
              <details className="agent-install-versions">
                <summary>{t("agents.manage.versions",{count:product.versions.length})}<Icon name="chevron-down" size="xs"/></summary>
                <ul>{[...product.versions].sort((a,b)=>compareVersions(b,a)).map(version=><li key={version}>
                  <span className="mono">v{version}</span>
                  {version===product.version?<span className="text-body-sm text-muted-foreground">{t("agents.manage.current")}</span>:<Button variant="ghost" size="sm" disabled={!!busy||loadFailed||!product.managed} onClick={()=>{setError(undefined);setConfirm({product,version});}}>{t("agents.manage.use")}</Button>}
                </li>)}</ul>
              </details>
            </article>;
          })}
        </div>
        <p className="agent-manager-footnote">{t("agents.manage.retained")}</p>
    </section>
    <AlertDialog open={!!confirm} onOpenChange={next=>{if(!next&&!lock.current){setConfirm(undefined);setError(undefined);}}}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(confirm&&"disable" in confirm?"agents.manage.disableTitle":"agents.manage.switchTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{confirm&&("disable" in confirm?t("agents.manage.disableHint"):compareVersions(confirm.version,confirm.product.version)<0?t("agents.manage.rollbackHint"):t("agents.manage.switchHint"))}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-body-md font-medium">{confirm?.product.name}{confirm&&"version" in confirm&&` · v${confirm.version}`}</p>
        {error&&<p role="alert" className="text-body-sm text-destructive">{error}</p>}
        <AlertDialogFooter><AlertDialogCancel disabled={!!busy}>{t("home.install.cancel")}</AlertDialogCancel><Button disabled={!!busy} onClick={()=>{if(confirm)void change(confirm);}}>{t(busy?"agents.manage.working":"agents.manage.confirm")}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
