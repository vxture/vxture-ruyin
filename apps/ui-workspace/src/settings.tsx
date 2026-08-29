/**
 * Settings panel (Claude-Desktop-style: left section nav, right content).
 * Live today: theme switching, runtime transparency (data dir, master-key
 * protection, versions). Explicit placeholders: Vxture account (liaison
 * L3(a) PKCE), transmission policy enforcement (policy engine), update
 * channel + check (W4 release infra / dl host).
 */

import { useEffect, useState } from "react";
import {
  Button,
  NativeSelect,
  SegmentedControl,
  useTheme,
} from "@vxture/design-system";
import { Api, type SystemInfo } from "./api";

const UI_VERSION = "0.1.0";

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
    <>
      <h1>设置</h1>
      {error && <div className="error-box">{error}</div>}
      <div className="settings">
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item${section === s.id ? " active" : ""}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
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
    </>
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
        {hint && <div className="muted setting-hint">{hint}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

/* ---------------- 账户 ---------------- */

function AccountSection() {
  return (
    <div className="card">
      <div className="account-empty">
        <div className="product-icon dim" style={{ margin: "0 auto 10px" }}>
          ？
        </div>
        <div className="ws-name">未登录</div>
        <p className="muted">
          登录 Vxture 账号后可同步订阅、调用云端 AI 能力并管理设备。
          <br />
          桌面端登录（PKCE）随平台对接上线。
        </p>
        <Button disabled>登录 Vxture 账号（即将开放）</Button>
      </div>
    </div>
  );
}

/* ---------------- 通用 ---------------- */

function GeneralSection() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="card">
      <SettingRow label="主题" hint="深色模式下窗口按钮颜色随后续版本同步">
        <SegmentedControl
          ariaLabel="主题"
          items={[
            { value: "light", label: "浅色" },
            { value: "dark", label: "深色" },
            { value: "system", label: "跟随系统" },
          ]}
          value={theme ?? "light"}
          onChange={(v) => setTheme(v)}
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
        <SettingRow label="数据目录" hint="全部业务数据保存在本机，是否上云由你决定">
          <span className="mono">{system?.dataDir ?? "…"}</span>
        </SettingRow>
        <SettingRow label="产品目录">
          <span className="mono">{system?.productsDir ?? "…"}</span>
        </SettingRow>
        <SettingRow label="静态加密" hint="每个工作空间独立密钥，SQLCipher 加密">
          {system ? (
            system.keyProtection === "dpapi" ? (
              <span className="pill completed">主密钥由 Windows DPAPI 保护</span>
            ) : (
              <span className="pill waiting_human">开发态：主密钥明文存储</span>
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
        <SettingRow label="审计" hint="每次传输与执行都有哈希链审计，可在工作空间的「审计」板块查看与本地校验">
          <span className="muted">推理传输 ≠ 数据存储：传输临时、不持久化</span>
        </SettingRow>
      </div>
    </>
  );
}

/* ---------------- 软件更新 ---------------- */

function UpdatesSection({ system }: { system: SystemInfo | null }) {
  const [channel, setChannel] = useState(
    localStorage.getItem("ruyin-update-channel") ?? "stable",
  );
  const [checked, setChecked] = useState<string | null>(null);
  const pickChannel = (c: string) => {
    localStorage.setItem("ruyin-update-channel", c);
    setChannel(c);
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
      <SettingRow label="更新渠道" hint="stable 稳定 / beta 尝鲜；自动更新随发布服务上线">
        <SegmentedControl
          ariaLabel="更新渠道"
          items={[
            { value: "stable", label: "稳定版" },
            { value: "beta", label: "Beta" },
          ]}
          value={channel}
          onChange={pickChannel}
        />
      </SettingRow>
      <SettingRow label="检查更新">
        <div>
          <Button
            variant="outline"
            onClick={() =>
              setChecked(
                `当前已是最新（${new Date().toLocaleTimeString()}）· 在线更新随发布服务上线后启用`,
              )
            }
          >
            检查更新
          </Button>
          {checked && (
            <div className="muted" style={{ marginTop: 6 }}>
              {checked}
            </div>
          )}
        </div>
      </SettingRow>
    </div>
  );
}

/* ---------------- 关于 ---------------- */

function AboutSection({ system }: { system: SystemInfo | null }) {
  return (
    <div className="card">
      <div className="account-empty">
        <div className="logo" style={{ justifyContent: "center", fontSize: 18 }}>
          <span className="logo-mark" aria-hidden />
          <span>
            <span className="logo-cn">如影</span>{" "}
            <span className="logo-en">RUYIN</span>
          </span>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Vxture AI 原生业务产品的本地智能工作环境
          <br />
          业务工作空间运行时 · Business Workspace Runtime
        </p>
        <div className="mono muted">
          Runtime {system?.version ?? "…"} · {system?.platform ?? ""}-
          {system?.arch ?? ""}
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          © 2026 Vxture · 保留所有权利
        </p>
      </div>
    </div>
  );
}
