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
import { Api, type SystemInfo } from "./api";

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
          {section === "updates" && <UpdatesSection system={system} />}
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
 * 在线更新尚未接通：`latest.yml` 一直在发布流水线里产出，但**应用里没有消费者**
 * （electron-updater 未接入）。所以这一节只报当前版本，不提供检查与渠道选择。
 *
 * 原实现点「检查更新」会直接显示「当前已是最新（时:分:秒）」——一个网络请求都
 * 没发，却带着时间戳，看起来像真查过。**没查过就说已是最新，比不提供这个按钮
 * 糟得多**：用户会信它。渠道开关同理，它只写 localStorage，没有任何人读——
 * 用户切到 Beta 却永远收不到 beta 包，只会以为坏了。
 *
 * 接入更新后，这两项一并放开。
 */
function UpdatesSection({ system }: { system: SystemInfo | null }) {
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
        label="在线更新"
        hint="发布服务与自动更新尚未接通；接通前请从官方渠道获取新版本安装包"
      >
        <StatusBadge tone="neutral">尚未接通</StatusBadge>
      </SettingRow>
      <SettingRow
        label="更新渠道"
        hint="随自动更新一并开放——现在设置它不会有任何效果，所以先不提供"
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
