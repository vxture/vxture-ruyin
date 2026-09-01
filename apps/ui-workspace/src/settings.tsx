/**
 * Settings - runtime transparency and preferences. DS-native: ghost-button
 * section nav, SegmentedControl pickers over the ThemeProvider's three axes
 * (mode / density / font size - the user-preference axis of the DS sizing
 * model), StatusBadge for protection states.
 */

import { useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  NativeSelect,
  SectionHeader,
  SegmentedControl,
  StatusBadge,
  useTheme,
} from "@vxture/design-system";
import { Api, type SystemInfo, type UpdateCheck } from "./api";

const UI_VERSION = "0.2.0";

type SectionId = "account" | "general" | "privacy" | "updates" | "about";

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: "account", label: "账户" },
  { id: "general", label: "通用" },
  { id: "privacy", label: "数据与隐私" },
  { id: "updates", label: "软件更新" },
  { id: "about", label: "关于" },
];

export function SettingsView({ api }: { api: Api }) {
  const [section, setSection] = useState<SectionId>("account");
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .system()
      .then(setSystem)
      .catch((e) => setError(String((e as Error).message)));
  }, [api]);

  return (
    <div className="flex flex-col gap-lg">
      <SectionHeader level={1} icon="settings" title="设置" />
      {error && <div className="error-box">{error}</div>}
      <div className="settings">
        <nav className="settings-nav" aria-label="设置分区">
          {SECTIONS.map((s) => (
            <Button
              key={s.id}
              variant={section === s.id ? "secondary" : "ghost"}
              className="w-full justify-start"
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </Button>
          ))}
        </nav>
        <div className="settings-content">
          {section === "account" && <AccountSection />}
          {section === "general" && <GeneralSection />}
          {section === "privacy" && <PrivacySection system={system} />}
          {section === "updates" && <UpdatesSection system={system} api={api} />}
          {section === "about" && <AboutSection system={system} />}
        </div>
      </div>
    </div>
  );
}

function SettingRow({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        {label}
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

/* ---------------- 账户 ---------------- */

function AccountSection() {
  return (
    <div className="card">
      <EmptyState
        icon="user-circle"
        title="账户由左下角的账户菜单管理"
        description="在侧栏底部登录 Vxture 账号：同步订阅权益、调用云端 AI 能力、管理设备。登录走系统浏览器（PKCE），凭证只存于本机凭据库。"
      />
    </div>
  );
}

/* ---------------- 通用 ---------------- */

function GeneralSection() {
  const { mode, setMode, density, setDensity, fontSize, setFontSize } =
    useTheme();
  return (
    <div className="card">
      <SettingRow label="主题" hint="深色为默认基调；窗口按钮颜色随后续版本同步">
        <SegmentedControl
          ariaLabel="主题"
          items={[
            { value: "dark", label: "深色" },
            { value: "light", label: "浅色" },
            { value: "system", label: "跟随系统" },
          ]}
          value={mode}
          onChange={setMode}
        />
      </SettingRow>
      <SettingRow label="密度" hint="同一套语义间距的三组取值，控件高度不变">
        <SegmentedControl
          ariaLabel="密度"
          items={[
            { value: "compact", label: "紧凑" },
            { value: "default", label: "默认" },
            { value: "comfortable", label: "宽松" },
          ]}
          value={density}
          onChange={setDensity}
        />
      </SettingRow>
      <SettingRow label="字号" hint="整套排版角色一起挪档，层级关系不变">
        <SegmentedControl
          ariaLabel="字号"
          items={[
            { value: "small", label: "小" },
            { value: "default", label: "标准" },
            { value: "large", label: "大" },
          ]}
          value={fontSize}
          onChange={setFontSize}
        />
      </SettingRow>
      <SettingRow label="语言">
        <NativeSelect disabled wrapperClassName="sel-lang">
          <option>简体中文</option>
        </NativeSelect>
      </SettingRow>
    </div>
  );
}

/* ---------------- 数据与隐私 ---------------- */

function PrivacySection({ system }: { system: SystemInfo | null }) {
  const [policy, setPolicy] = useState(
    localStorage.getItem("ruyin-transmission-policy") ?? "sensitivity",
  );
  const pickPolicy = (p: string) => {
    localStorage.setItem("ruyin-transmission-policy", p);
    setPolicy(p);
  };
  return (
    <>
      <div className="card">
        <SettingRow label="数据目录" hint="全部业务数据在本机，此目录之外不落任何内容">
          <span className="mono">{system?.dataDir ?? "…"}</span>
        </SettingRow>
        <SettingRow label="产品目录">
          <span className="mono">{system?.productsDir ?? "…"}</span>
        </SettingRow>
        <SettingRow label="静态加密" hint="每个项目独立密钥，SQLCipher 加密">
          {system ? (
            system.keyProtection === "dpapi" ? (
              <StatusBadge tone="success">主密钥由 Windows DPAPI 保护</StatusBadge>
            ) : (
              <StatusBadge tone="warning">开发态：主密钥明文存储</StatusBadge>
            )
          ) : (
            "…"
          )}
        </SettingRow>
      </div>
      <div className="card">
        <SettingRow
          label="推理传输策略"
          hint="上下文送云端推理前的确认粒度；策略引擎接入后生效（当前高敏感内容始终需确认）"
        >
          <SegmentedControl
            ariaLabel="推理传输策略"
            items={[
              { value: "sensitivity", label: "按敏感度（推荐）" },
              { value: "always", label: "全部需确认" },
            ]}
            value={policy}
            onChange={pickPolicy}
          />
        </SettingRow>
        <SettingRow
          label="审计"
          hint="每次传输与执行都有哈希链审计，可在项目的「审计」板块查看与本地校验"
        >
          <span className="text-body-sm text-muted-foreground">
            推理传输 ≠ 数据存储：传输临时、不持久化
          </span>
        </SettingRow>
      </div>
    </>
  );
}

/* ---------------- 软件更新 ---------------- */

/**
 * 检查是真的（守护进程拉渠道 feed 比版本），**下载与安装尚未接入**。
 *
 * 分成两半是因为前置不同：检查只是一个 HTTP GET，现在就能做；下载与安装要
 * electron-updater、要 TD-001 的签名证书（Windows 上 electron-updater 默认
 * 校验更新包签名），还要三条尚未定的策略——有任务在跑时装不装、自动下载还是
 * 询问、允不允许渠道降级。**未定的策略不该由实现替人默认掉**，所以这里不做
 * 自动检查、不记住渠道，只有用户点一下才去问一次。
 *
 * **查不到 ≠ 已是最新。** 这个功能的上一版不发请求就断言「当前已是最新」并附
 * 时间戳；现在 `unreachable` 是一个正式状态，绝不折叠进「最新」。
 */
function UpdatesSection({
  system,
  api,
}: {
  system: SystemInfo | null;
  api: Api;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setFailed(null);
    try {
      setResult(await api.checkUpdate());
    } catch (e) {
      // 连守护进程都没问到，同样不能说成「最新」。
      setResult(null);
      setFailed(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <SettingRow label="当前版本">
        <span className="mono">
          Runtime {system?.version ?? "…"} · UI {UI_VERSION}
        </span>
      </SettingRow>
      <SettingRow label="启动时间">
        <span className="mono">{system?.startedAt ?? "…"}</span>
      </SettingRow>
      <SettingRow
        label="检查更新"
        hint="向发布渠道询问是否有新版本；不会下载任何东西"
      >
        <div>
          <Button variant="outline" disabled={busy} onClick={() => void check()}>
            {busy ? "正在检查…" : "检查更新"}
          </Button>
          {failed && (
            <div className="update-line update-line--warn">
              检查失败：{failed}
            </div>
          )}
          {result?.status === "current" && (
            <div className="update-line">
              已是最新（{result.latest}）
            </div>
          )}
          {result?.status === "available" && (
            <div className="update-line update-line--new">
              有新版本 <span className="mono">{result.latest}</span>
              （当前 <span className="mono">{result.current}</span>）
            </div>
          )}
          {result?.status === "unreachable" && (
            <div className="update-line update-line--warn">
              没查到——{result.reason}。
              <br />
              这不代表你已是最新，只代表这次没问到。
            </div>
          )}
        </div>
      </SettingRow>
      <SettingRow
        label="下载与安装"
        hint="需要代码签名证书与更新策略（何时安装、是否自动下载）就位后开放"
      >
        <StatusBadge tone="neutral">尚未接入</StatusBadge>
      </SettingRow>
      <SettingRow
        label="更新渠道"
        hint="随下载与安装一并开放——现在设置它不会有任何效果，所以先不提供"
      >
        <span className="text-body-sm text-muted-foreground">stable</span>
      </SettingRow>
    </div>
  );
}

/* ---------------- 关于 ---------------- */

function AboutSection({ system }: { system: SystemInfo | null }) {
  return (
    <div className="card">
      <div className="about-block">
        <p>
          <span className="logo-cn">如影</span>{" "}
          <span className="logo-en">RUYIN</span>
        </p>
        <p className="text-body-md text-muted-foreground" style={{ marginTop: 10 }}>
          Vxture AI 原生业务产品的本地智能工作环境
          <br />
          业务工作空间运行时 · Business Workspace Runtime
        </p>
        <div className="mono text-muted-foreground">
          Runtime {system?.version ?? "…"} · {system?.platform ?? ""}-
          {system?.arch ?? ""}
        </div>
        <p className="text-body-sm text-muted-foreground" style={{ marginTop: 12 }}>
          © 2026 Vxture · 保留所有权利
        </p>
      </div>
    </div>
  );
}
