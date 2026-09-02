/**
 * 设置 —— 运行时的透明度与偏好。
 *
 * **分区导航不在这里。** 设置是一个应用，应用有自己的框架：分区在侧栏
 * （设置态 chrome，见 workbench.tsx）。这里曾经是页面内的第二根竖直导航栏，
 * 于是屏幕左边并排站着两根，436px 全是导航。
 *
 * 剩下的 SegmentedControl 是**取值控件**不是导航：ThemeProvider 的三条轴
 * （模式 / 密度 / 字号）与推理传输策略。StatusBadge 表示保护状态。
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
// SectionId/SETTINGS_SECTIONS live in their own module (settings-sections.ts)
// so the sidebar can know the section list without pulling in this file's
// DS-heavy SettingsView - see that file's header comment (TD-011②).
export { SETTINGS_SECTIONS, type SectionId } from "./settings-sections";
import type { SectionId } from "./settings-sections";

const UI_VERSION = "0.2.0";

export function SettingsView({ api, section }: { api: Api; section: SectionId }) {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .system()
      .then(setSystem)
      .catch((e) => setError(String((e as Error).message)));
  }, [api]);

  return (
    <div className="flex flex-col gap-md">
      {/* 「设置」两个字已经在标题栏和侧栏里，这里不再写第三遍。 */}
      {error && <div className="error-box">{error}</div>}
      {section === "account" && <AccountSection />}
      {section === "general" && <GeneralSection />}
      {section === "privacy" && <PrivacySection system={system} />}
      {section === "updates" && <UpdatesSection system={system} api={api} />}
      {section === "about" && <AboutSection system={system} />}
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
 * 检查更新；**下载与安装交给用户自己在浏览器里做**（2026-09-02，owner 定）。
 *
 * MVP 阶段不做自动更新。原因不是没做到：曾经整套接过 electron-updater，
 * 但它在 Windows 上默认校验更新包签名，而 owner 定了不采购证书
 * （TD-001 转 standing）。于是只剩两条路 —— 关掉那道校验，等于让更新通道接受
 * 任何来自 feed 的包；或者不做自动安装。**选了后者**：为一个 MVP 阶段还不需要
 * 的便利去降一条安全底线，不划算。下载与安装那一整段代码已经拆掉，不是留着
 * 不用 —— 留着的死路会让下一个人以为它还能走。
 *
 * 于是这里只做两件事：说清有没有新版本，以及**给出那一份包的确切地址**。地址
 * 由守护进程从它刚校验过的那份 feed 自己拼出，**带着渠道**（stable / beta）。
 * 不写明渠道的下载链接是有害的 —— 用户可能正装上一个 beta 包而不自知。
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
              （当前 <span className="mono">{result.current}</span>
              {/* 渠道要写在明面上：用户有权知道自己要装的是 stable 还是 beta。
                  更新源没写明渠道时**不提它** —— 猜一个渠道名是拿错话冒充事实。 */}
              {result.channel && (
                <>
                  ，<span className="mono">{result.channel}</span> 渠道
                </>
              )}
              ）
              <div className="update-actions">
                {result.downloadUrl ? (
                  <>
                    <Button
                      onClick={() =>
                        window.open(result.downloadUrl, "_blank", "noopener")
                      }
                    >
                      下载安装包 ↗
                    </Button>
                    <span className="text-body-sm text-muted-foreground">
                      在浏览器里下载，下载完自己运行它 —— 本应用不会自动安装。
                    </span>
                  </>
                ) : (
                  // feed 里没有 path。**不拼一个猜出来的地址**：点下去拿到 404，
                  // 用户会以为是产品坏了。照实说这一次拿不到地址。
                  <span className="text-body-sm update-line--warn">
                    这次没能拿到安装包地址（更新源里没写文件名）。
                  </span>
                )}
              </div>
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
      {/* 这一句的理由**换到第三个版本了**，前两个都随实现变化而过期：
          ① 「随下载与安装一并开放」—— 那两样开放之后它没跟着改；
          ② 「切换渠道会连带允许降级」—— 那是 electron-updater 的 `channel`
             setter 副作用，而 electron-updater 已随自动更新一并拆掉；
          ③ 现在：本机只发 stable，切到 beta 那边**没有包**，检查会 unreachable。
          之所以把这段历史留着：一处解释性文案连着两次比它解释的东西活得更久，
          说明它值得被当成会过期的东西看待，而不是写完就忘。 */}
      <SettingRow
        label="更新渠道"
        hint="当前只发布 stable。切到其他渠道那边还没有包，检查会查不到——等有了再开放"
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
