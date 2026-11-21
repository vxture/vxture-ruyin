/** Shared package import and registry controls for home and agent management. */
import {useEffect,useRef,useState} from "react";
import {Button,DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger,Icon} from "@vxture/design-system";
import {type Api,type InstalledPackage,type RegistryCatalog} from "./api";
import {useT} from "./i18n";
/** Explicit registry browser; catalog failure stays distinct from an empty registry. */
export function RegistryList({
  api,
  open,
  onDone,
  onError,
}: {
  api: Api;
  /** 由标题行的「从产品库安装」开关；关着时什么都不渲染、也不去问。 */
  open: boolean;
  onDone: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const t = useT();
  const [catalog, setCatalog] = useState<RegistryCatalog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => {
    setBusy("__catalog");
    try {
      setCatalog(await api.registry());
    } catch (e) {
      onError(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };
  const install = async (id: string, version: string) => {
    setBusy(`${id}@${version}`);
    try {
      await api.installFromRegistry(id, version);
      await onDone();
      await load();
    } catch (e) {
      onError(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (open && catalog === null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <div className="install-row" style={{ flexDirection: "column", alignItems: "flex-start" }}>
      {busy === "__catalog" && catalog === null && (
        <span className="text-body-sm text-muted-foreground">{t("home.install.reading")}</span>
      )}
      {/* **不端出 `catalog.reason`**（owner 2026-09-17）：那是取数失败的原话。
          用户要知道的只有两件——这次没读到，以及这不等于库是空的。 */}
      {open && catalog?.status === "unreachable" && (
        <span className="text-body-sm text-muted-foreground">
          {t("home.install.catalogUnreachable")}
        </span>
      )}
      {open && catalog?.status === "ok" && catalog.items.length === 0 && (
        <span className="text-body-sm text-muted-foreground">{t("home.install.catalogEmpty")}</span>
      )}
      {open && catalog?.status === "ok" && catalog.items.length > 0 && (
        <ul className="row-list" aria-label={t("home.install.catalogAria")}>
          {catalog.items.map((item) => (
            <li key={`${item.id}@${item.version}`} className="row-item">
              <span className="row-main">
                {item.name}{" "}
                <span className="mono text-muted-foreground">
                  {item.id} v{item.version}
                </span>
              </span>
              {/* 签没签名照实说：今天静态库里的包都未签名，生产拒装。 */}
              <span className="row-tag">{t(item.signed ? "home.install.signed" : "home.install.unsigned")}</span>
              {item.installed ? (
                <span className="text-body-sm text-muted-foreground">{t("home.install.installed")}</span>
              ) : catalog.installable || item.signed ? (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void install(item.id, item.version)}
                >
                  {t(
                    busy === `${item.id}@${item.version}`
                      ? "home.install.installing"
                      : "home.install.install",
                  )}
                </Button>
              ) : (
                // 悬停提示原先写着「未经 Vxture Registry 副署（TD-012 / TD-037）」——
                // **把内部债务编号挂到了用户的鼠标下**。要说的只有一句：为什么装不了。
                <span
                  className="text-body-sm text-muted-foreground"
                  title={t("home.install.unsignedBlockedTitle")}
                >
                  {t("home.install.unsignedBlocked")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Add agents by importing a package or browsing the registry; both use host validation. */
export function InstallMenu({
  api,
  onDone,
  onError,
  registryOpen,
  onToggleRegistry,
  onManage,
  toolbar=false,
}: {
  api: Api;
  onDone: () => void | Promise<void>;
  onError: (msg: string) => void;
  registryOpen: boolean;
  onToggleRegistry: () => void;
  onManage?:()=>void;
  toolbar?:boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<InstalledPackage | null>(null);
  const [candidate, setCandidate] = useState<{ file: File; report: Awaited<ReturnType<Api["preflightPackage"]>> } | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  return (
    <span className="install-inline">
      {toolbar?<><Button size="sm" disabled={busy} onClick={()=>pick.current?.click()}><Icon name="arrow-down" size="xs"/>{t(busy?"home.install.installing":"home.install.fromFile")}</Button><Button variant="outline" size="sm" disabled={busy} onClick={onToggleRegistry}>{t(registryOpen?"home.install.hideRegistry":"home.install.showRegistry")}</Button></>:<DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy}>
            {t(busy ? "home.install.installing" : "home.install.addAgent")}
            <Icon name="caret-up-down" size="xs" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* 原生 file input 藏起来，由菜单项代打开。藏它不是为了好看：那个控件由
              浏览器渲染，按**浏览器的语言**显示「Choose File / No file chosen」——
              一句改不掉的英文夹在中文界面里。功能照旧走这个 input（同一个页面在
              浏览器和壳里都要能用，不走只有壳能走的原生对话框）。 */}
          <DropdownMenuItem onSelect={() => pick.current?.click()}>
            {t("home.install.fromFile")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleRegistry}>
            {t(registryOpen ? "home.install.hideRegistry" : "home.install.showRegistry")}
          </DropdownMenuItem>
          {onManage&&<><DropdownMenuSeparator/><DropdownMenuItem onSelect={onManage}>{t("agents.manage.title")}</DropdownMenuItem></>}
        </DropdownMenuContent>
      </DropdownMenu>}
      <input
          ref={pick}
          type="file"
          accept=".ruyinpkg"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // 选完就清掉输入框：同一个文件连选两次也要能触发。
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            setDone(null);
            setCandidate(null);
            void api
              .preflightPackage(file)
              .then((report) => setCandidate({ file, report }))
              .catch((err: Error) => onError(err.message))
              .finally(() => setBusy(false));
          }}
        />
      {candidate && (
        <span className="install-review" role="group" aria-label={t("home.install.review")}>
          <span className="text-body-sm">
            {candidate.report.name} · {candidate.report.productId}@{candidate.report.version} · {candidate.report.publisher}
            {candidate.report.runtimeMinimum && ` · Runtime ≥ ${candidate.report.runtimeMinimum}`} · {t(candidate.report.signed ? "home.install.signed" : "home.install.unsigned")}
          </span>
          <Button size="sm" disabled={busy} onClick={() => {
            setBusy(true);
            void api.installPackage(candidate.file).then(async (result) => {
              setCandidate(null);
              setDone(result);
              await onDone();
            }).catch((err: Error) => onError(err.message)).finally(() => setBusy(false));
          }}>{t("home.install.confirm")}</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setCandidate(null)}>{t("home.install.cancel")}</Button>
        </span>
      )}
      {/* 签没签名要照实说：未签名的包是另一回事，不该和签过的长一个样。 */}
      {done && (
        <span className="text-body-sm text-muted-foreground">
          {t(done.signed ? "home.install.doneSigned" : "home.install.doneUnsigned", {
            id: done.productId,
            version: done.version,
          })}
        </span>
      )}
    </span>
  );
}
