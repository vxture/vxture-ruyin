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
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  EmptyState,
  Icon,
  Input,
  NativeSelect,
  SectionHeader,
  SegmentedControl,
  StatusBadge,
  useTheme,
} from "@vxture/design-system";
import { Api, ApiError, type ConnectorView, type SessionInfo, type SystemInfo, type UpdateCheck } from "./api";
// SectionId/SETTINGS_SECTIONS live in their own module (settings-sections.ts)
// so the sidebar can know the section list without pulling in this file's
// DS-heavy SettingsView - see that file's header comment (TD-011②).
export { SETTINGS_SECTIONS, type SectionId } from "./settings-sections";
import { resolveSection, type SectionId } from "./settings-sections";

const UI_VERSION = "0.2.0";
/** 界面语言偏好（本机）。DS 管排版三轴，语言这一项归本文件。 */
const LANG_KEY = "ruyin-language";

export function SettingsView({ api, section }: { api: Api; section: SectionId }) {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .system()
      .then(setSystem)
      .catch((e) => setError(String((e as Error).message)));
    // 账户页要展示会话里的身份；拿不到就按未登录呈现，不报错。
    Promise.resolve()
      .then(() => api.session())
      .then(setSession)
      .catch(() => setSession(null));
  }, [api]);

  // 旧地址（#settings/privacy）不该变成白屏，见 settings-sections.ts。
  const view = resolveSection(section);

  return (
    <div className="flex flex-col gap-md">
      {/* 「设置」两个字已经在标题栏和侧栏里，这里不再写第三遍。 */}
      {error && <div className="error-box">{error}</div>}
      {view === "account" && <AccountSection session={session} />}
      {view === "general" && <SystemSection system={system} />}
      {view === "connectors" && <ConnectorsSection api={api} />}
      {view === "updates" && <UpdatesSection system={system} api={api} />}
      {view === "about" && <AboutSection system={system} />}
    </div>
  );
}

/**
 * 二级板块（owner 2026-09-04 定的统一标题模式）：小图标 + 标题 + 一句说明，
 * 内容整体缩进到标题文字的左缘。
 *
 * 分区里不再只有一张大 card 平铺所有行：一个分区往往在讲两三件不同的事
 * （账户 = 身份 + 偏好；通用设置 = 存在哪儿 + 怎么加密 + 什么会离开本机），
 * 挤在同一张卡里读者得自己找分界线。图标是给扫视用的锚点，不是装饰。
 */
function SettingsBlock({
  icon,
  title,
  desc,
  aside,
  children,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  title: string;
  desc?: string;
  /** 板块级动作，靠右（例如账号信息的「在线修改」）。 */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card set-block">
      <header className="set-block-head">
        <span className="set-block-icon" aria-hidden>
          <Icon name={icon} size="sm" />
        </span>
        <div className="set-block-titles">
          <h3 className="set-block-title">{title}</h3>
          {desc && <p className="set-block-desc">{desc}</p>}
        </div>
        {aside && <span className="set-block-aside">{aside}</span>}
      </header>
      <div className="set-block-body">{children}</div>
    </section>
  );
}

/**
 * 单行设置：名称 + 控件，一行一个（owner 2026-09-04 第 5 / 6 条）。
 *
 * 控件列**定宽**，所以四项左右严格对齐、滑块铺满同一格；要解释的话放
 * `note`，它单独占一行、整行宽 —— 挤进名称列里换行是上一版的毛病。
 */
function Row({
  label,
  children,
  note,
}: {
  label: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <>
      <div className="set-row">
        <span className="set-row-label">{label}</span>
        <span className="set-row-control">{children}</span>
      </div>
      {note && <p className="set-row-note">{note}</p>}
    </>
  );
}

/** 一行事实：名称 + 值（+ 可选徽章）。值缺失写「—」，不留空。 */
function FactRow({
  label,
  value,
  badge,
  mono,
}: {
  label: string;
  value?: React.ReactNode;
  badge?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="fact-row">
      <span className="fact-label">{label}</span>
      <span className={mono ? "fact-value mono" : "fact-value"}>
        {value === undefined || value === null || value === "" ? (
          <span className="fact-empty">—</span>
        ) : (
          value
        )}
      </span>
      {badge && <span className="fact-badge">{badge}</span>}
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

/**
 * 账户：登录后把会话里的身份**摆出来**（姓名、邮箱、租户、工作区），修改走
 * 云平台的「个人信息」页（owner 2026-09-03 定：不能只留一个跳转页）。本机只读
 * 会话，不改身份 —— 改在平台改，这里如实写「在线修改」。
 */
function AccountSection({ session }: { session: SessionInfo | null }) {
  if (!session?.signedIn) {
    return (
      <>
        <div className="card">
          <EmptyState
            icon="user-circle"
            title="账户由左下角的账户菜单管理"
            description="在侧栏底部登录 Vxture 账号：同步订阅权益、调用云端 AI 能力、管理设备。登录走系统浏览器（PKCE），凭证只存于本机凭据库。"
          />
        </div>
        <PreferencesBlock />
      </>
    );
  }
  const p = session.profile;
  const profileUrl = `${session.consoleBase || "https://vxture.com"}/zh-CN/profile`;
  const name = p?.name ?? p?.email ?? "Vxture 用户";
  const verified = (ok?: boolean) =>
    ok === undefined ? undefined : ok ? (
      <StatusBadge tone="success">已验证</StatusBadge>
    ) : (
      <StatusBadge tone="warning">未验证</StatusBadge>
    );
  return (
    <>
      <SettingsBlock
        icon="role"
        title="账号信息"
        desc="全部取自登录后的会话，本机只读；修改在平台的「个人信息」页完成"
        aside={
          <Button variant="outline" size="sm" onClick={() => window.open(profileUrl, "_blank", "noopener")}>
            在线修改
            <Icon name="external-link" size="xs" />
          </Button>
        }
      >
        <div className="account-head">
          <Avatar className="account-avatar">
            {p?.picture && <AvatarImage src={p.picture} alt={name} />}
            <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <div className="account-ident">
            <div className="account-name">{name}</div>
            {p?.email && <div className="account-email">{p.email}</div>}
          </div>
        </div>
        {/* 逐项摆出来。**不显示 sub（uuid）** —— 那是给机器对账的，不是给人看的
            （owner 2026-09-04 定）。缺的字段写「—」而不是藏起来：那一横说明的是
            「平台没在 token 里给」，本身就是信息。 */}
        <FactRow label="显示名" value={p?.name} />
        <FactRow label="用户名" value={p?.username} mono />
        <FactRow label="邮箱" value={p?.email} badge={verified(p?.emailVerified)} />
        <FactRow label="电话" value={p?.phone} badge={verified(p?.phoneVerified)} />
        <FactRow
          label="角色"
          value={
            p?.roles && p.roles.length > 0 ? (
              <span className="fact-chips">
                {p.roles.map((r) => (
                  <StatusBadge key={r} tone="neutral">
                    {r}
                  </StatusBadge>
                ))}
              </span>
            ) : undefined
          }
        />
        <FactRow label="语言地区" value={p?.locale} mono />
        {/* 租户与工作区同一行（owner 第 4 条）：它们回答的是同一个问题 ——
            「我现在在哪儿干活」。中间一个淡分隔点，不是两行各说一半。
            **切换只能去平台**（第 3 条）：token 里只有 `active_org` 一个组织，
            平台 v2 已弃用 `tenants` 声明，所以本机既列不出候选、也换不了 ——
            换租户等于换一份 token。按钮如实写成去平台切换，切完工作区一起变。 */}
        <div className="fact-row">
          <span className="fact-label">当前租户</span>
          <span className="fact-value">
            {session.org?.name ?? <span className="fact-empty">—</span>}
            {session.org?.type && (
              <StatusBadge tone="neutral">
                {session.org.type === "personal" ? "个人" : "团队"}
              </StatusBadge>
            )}
            <span className="fact-sep">·</span>
            {session.workspace?.name ?? <span className="fact-empty">—</span>}
          </span>
          <span className="fact-action">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(profileUrl, "_blank", "noopener")}
            >
              切换租户
              <Icon name="external-link" size="xs" />
            </Button>
          </span>
        </div>
        <p className="set-row-note">
          切换在平台完成，工作区随租户一起切换；本机会话在下次刷新令牌时跟上。
        </p>
      </SettingsBlock>
      <PreferencesBlock />
    </>
  );
}

/**
 * 偏好设置（owner 2026-09-04：从「通用」整组搬到账户之下）。
 *
 * **四项都是本机的事**，与账号无关：换台机器不跟着走，也不上传。三条排版轴由
 * DS 的 ThemeProvider 自己写进 localStorage（`vx-theme` / `vx-density` /
 * `vx-font-size`），语言这一项由本文件存 `ruyin-language`。
 */
function PreferencesBlock() {
  const { mode, setMode, density, setDensity, fontSize, setFontSize } = useTheme();
  const [lang, setLang] = useState(
    () => localStorage.getItem(LANG_KEY) ?? "zh-CN",
  );
  const pickLang = (next: string) => {
    localStorage.setItem(LANG_KEY, next);
    setLang(next);
  };
  return (
    <SettingsBlock
      icon="settings"
      title="偏好设置"
      desc="只作用于这台机器上的这个应用，记录在本机，不随账号同步"
    >
      {/* 四项各一行、不带说明（owner 第 5 条）：这四个词自己说得清，一行小字
          只是把行距撑开。控件列定宽，所以四行左右对齐、滑块等长（第 6 条）。 */}
      <Row label="语言">
        <NativeSelect value={lang} onChange={(e) => pickLang(e.target.value)}>
          <option value="zh-CN">简体中文</option>
        </NativeSelect>
      </Row>
      <Row label="主题">
        <SegmentedControl
          ariaLabel="主题"
          items={[
            { value: "dark", label: "深色" },
            { value: "light", label: "浅色" },
            { value: "system", label: "系统" },
          ]}
          value={mode}
          onChange={setMode}
        />
      </Row>
      <Row label="密度">
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
      </Row>
      <Row label="字号">
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
      </Row>
    </SettingsBlock>
  );
}

/* ---------------- 通用设置（原「数据与隐私」的内容）---------------- */

/**
 * 通用设置：数据在哪儿、怎么加密、什么会离开本机。三件事三个板块 ——
 * 原先它们挤在两张卡里，而「目录」和「加密」不是同一个问题。
 */
function SystemSection({ system }: { system: SystemInfo | null }) {
  const [policy, setPolicy] = useState(
    localStorage.getItem("ruyin-transmission-policy") ?? "sensitivity",
  );
  const pickPolicy = (p: string) => {
    localStorage.setItem("ruyin-transmission-policy", p);
    setPolicy(p);
  };
  return (
    <>
      <SettingsBlock
        icon="folder-open"
        title="存储位置"
        desc="全部业务数据在本机，这两个目录之外不落任何内容"
      >
        <FactRow label="数据目录" value={system?.dataDir} mono />
        <FactRow label="产品目录" value={system?.productsDir} mono />
        {/* 「能不能改」是 owner 问过的（2026-09-04）。答案照实写在界面上，而不是
            放一个改不动的输入框：目录在守护进程启动时确定（RUYIN_DATA_DIR），
            改它要停下运行时、搬走已加密的库、再重新指过去 —— 中途失败会留下
            两份数据，而两份加密数据比没有更糟。登记在 TD-039。 */}
        <p className="set-note">
          目录在运行时启动时确定（<span className="mono">RUYIN_DATA_DIR</span>）。
          界面内暂不支持修改：改动要停下运行时并搬移已加密的库，半途失败会留下两份数据。
        </p>
      </SettingsBlock>

      <SettingsBlock
        icon="lock"
        title="静态加密"
        desc="业务数据落盘即加密。一次加密，密钥再套两层保护 —— 每层各自保护什么，逐条写在下面"
      >
        {system ? (
          <>
            <ul className="crypto-chain">
              <li>
                <span className="crypto-what">业务数据</span>
                <span className="crypto-how">每个项目库整库加密 · SQLCipher（AES-256）</span>
              </li>
              <li>
                <span className="crypto-what">库密钥</span>
                <span className="crypto-how">一库一把随机密钥 · AES-256-GCM 封装在主密钥下</span>
              </li>
              <li>
                <span className="crypto-what">主密钥</span>
                <span className="crypto-how">
                  {system.keyProtection === "dpapi"
                    ? "Windows DPAPI 保护（当前用户作用域），不落明文"
                    : "明文存放 —— 本平台没有 OS 级密钥保护"}
                </span>
              </li>
            </ul>
            {/* 说清楚哪些**没**加密，比多列两个算法名更能说明这段话可信。 */}
            <p className="crypto-note">
              会话凭证由主密钥单独密封；产品契约与本机配置不加密 —— 它们按设计就是公开信息。
            </p>
            {system.keyProtection === "dpapi" ? (
              <StatusBadge tone="success">主密钥由 Windows DPAPI 保护</StatusBadge>
            ) : (
              <StatusBadge tone="warning">开发态：主密钥明文存储，不可用于真实数据</StatusBadge>
            )}
          </>
        ) : (
          "…"
        )}
      </SettingsBlock>

{/* 原来是一个「推理与审计」板块 —— 两件事挤在一起（owner 第 9 条）：
          一个是**我允许什么离开**（可选），一个是**离开之后留下什么**（不可选）。
          可选与不可选不该同一块。 */}
      <SettingsBlock
        icon="cloud"
        title="推理策略"
        desc="上下文送云端推理之前，什么情况下要先问我一句"
      >
        <Row
          label="确认粒度"
          note="策略引擎接入后生效；当前无论选哪一档，高敏感内容都始终需要确认。推理传输 ≠ 数据存储：传输临时、不持久化。"
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
        </Row>
      </SettingsBlock>

      <SettingsBlock
        icon="list"
        title="安全审计"
        desc="每一次传输与执行都留痕，且留痕本身可以被校验 —— 这一块没有开关"
      >
        <FactRow label="记录范围" value="每次上下文传输、每次工具执行、每次人工决定" />
        <FactRow label="完整性" value="哈希链：每条记录接在上一条的哈希之后，改一条后面全对不上" />
        <FactRow label="查看" value="在项目的「审计」板块查看，并可在本机重算校验" />
        <p className="set-note">
          审计不落原文：记录里是内容的哈希与字节数，不是内容本身。
        </p>
      </SettingsBlock>
    </>
  );
}

/* ---------------- 连接器 ---------------- */

/**
 * 机器级的连接器（ADR-005 通路二）：装了哪些、活着没有、装一个、卸一个。
 * 项目级的授权不在这里 —— 那在每个项目的「资料」板块，因为授权是项目的事。
 *
 * 装是受限的：签名信任锚就位前生产拒装（TD-036），守护进程会用 403 说明。
 * 界面照实转达，不把「拒绝」包装成「暂不可用」。
 */
function ConnectorsSection({ api }: { api: Api }) {
  const [items, setItems] = useState<ConnectorView[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [source, setSource] = useState<"lan" | "private">("lan");

  const reload = async () => {
    try {
      setItems((await api.connectors()).items);
      setUnavailable(null);
    } catch (e) {
      // 503 = 这套装配没有注册表。这不是错误，是一个事实，单独说。
      if (e instanceof ApiError && e.status === 503) {
        setItems([]);
        setUnavailable(e.message);
      } else {
        setFailed(String((e as Error).message));
      }
    }
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const install = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await api.installConnector({
        id: id.trim(),
        command: command.trim(),
        // 空格分参数够用了：这是开发态的口子，真正的安装走签名包（TD-036）。
        args: args.trim() ? args.trim().split(/\s+/) : [],
        source,
      });
      setId("");
      setCommand("");
      setArgs("");
      await reload();
    } catch (e) {
      setFailed(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: string) => {
    setFailed(null);
    try {
      await api.removeConnector(target);
      await reload();
    } catch (e) {
      setFailed(String((e as Error).message));
    }
  };

  return (
    <>
      <div className="card">
        <SettingRow
          label="已安装的连接器"
          hint="局域网 / 私有服务经本机 MCP 连接器进入项目上下文；每个项目要单独授权才能用"
        >
          {unavailable ? (
            <span className="text-body-sm text-muted-foreground">{unavailable}</span>
          ) : items === null ? (
            "…"
          ) : items.length === 0 ? (
            <span className="text-body-sm text-muted-foreground">尚未安装任何连接器</span>
          ) : (
            <ul className="row-list" aria-label="已安装的连接器">
              {items.map((c) => (
                <li key={c.id} className="row-item">
                  <code className="row-main" title={`${c.command} ${c.args.join(" ")}`}>
                    {c.id}
                  </code>
                  <span className="row-tag">{c.source}</span>
                  {/* 暴露了哪些工具：契约里 provider: connector 的工具要靠同名才接得上，
                      用户对着契约就能看出接没接。 */}
                  {c.tools.length > 0 && (
                    <span className="text-body-sm text-muted-foreground mono">
                      {`工具：${c.tools.join("、")}`}
                    </span>
                  )}
                  {/* 健康是问出来的：一个「已安装」不说它此刻活着没有。 */}
                  <StatusBadge tone={c.health.ok ? "success" : "warning"}>
                    {c.health.ok ? "运行中" : `未运行${c.health.detail ? "：" + c.health.detail : ""}`}
                  </StatusBadge>
                  <Button variant="ghost" size="sm" onClick={() => void remove(c.id)}>
                    卸载
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SettingRow>
      </div>
      {!unavailable && (
        <div className="card">
          <SettingRow
            label="安装连接器（stdio）"
            hint="一个 MCP 服务器的启动命令。签名信任锚就位前，正式版会拒绝安装并说明原因（TD-036）"
          >
            <div className="flex flex-col gap-sm">
              <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="连接器 id，如 crm" />
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="命令，如 node，或 MCP 服务器可执行文件的完整路径"
              />
              <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="参数（空格分隔，可空）" />
              <NativeSelect
                aria-label="来源种类"
                value={source}
                onChange={(e) => setSource(e.target.value === "private" ? "private" : "lan")}
                wrapperClassName="sel-narrow"
              >
                <option value="lan">lan · 局域网系统</option>
                <option value="private">private · 私有服务</option>
              </NativeSelect>
              <div>
                <Button disabled={busy || !id.trim() || !command.trim()} onClick={() => void install()}>
                  {busy ? "正在安装…" : "安装并启动"}
                </Button>
              </div>
              {failed && <div className="update-line update-line--warn">{failed}</div>}
            </div>
          </SettingRow>
        </div>
      )}
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
/**
 * 软件更新：四件事四个板块（owner 2026-09-04）—— 现在装的是什么、去问一次、
 * 从哪个渠道问、以及问到了之后怎么装。
 *
 * 最后一块不是客套话：**本应用不自动安装**（TD-021，owner 定不采购签名证书后
 * 的连带结果）。把「怎么装」写在这里，用户点下载之前就知道接下来要自己动手。
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
    <>
      <SettingsBlock icon="info" title="当前版本" desc="这台机器上正在跑的是哪一版">
        <FactRow label="运行时" value={system ? `Runtime ${system.version}` : undefined} mono />
        <FactRow label="界面" value={`UI ${UI_VERSION}`} mono />
        <FactRow label="平台" value={system ? `${system.platform}-${system.arch}` : undefined} mono />
        <FactRow label="启动时间" value={system?.startedAt} mono />
      </SettingsBlock>

      <SettingsBlock
        icon="arrow-down"
        title="检查更新"
        desc="向发布渠道询问是否有新版本；只是问一句，不会下载任何东西"
        aside={
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void check()}>
            {busy ? "正在检查…" : "检查更新"}
          </Button>
        }
      >
        {!result && !failed && !busy && (
          <p className="set-note">还没查过。查一次也不会自动下载。</p>
        )}
        {failed && <div className="update-line update-line--warn">检查失败：{failed}</div>}
        {result?.status === "current" && (
          <div className="update-line">已是最新（{result.latest}）</div>
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
                  <Button onClick={() => window.open(result.downloadUrl, "_blank", "noopener")}>
                    下载安装包
                    <Icon name="external-link" size="xs" />
                  </Button>
                  <span className="text-body-sm text-muted-foreground">
                    在浏览器里下载，下载完自己运行它。
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
      </SettingsBlock>

      {/* 这一句的理由**换到第三个版本了**，前两个都随实现变化而过期：
          ① 「随下载与安装一并开放」—— 那两样开放之后它没跟着改；
          ② 「切换渠道会连带允许降级」—— 那是 electron-updater 的 `channel`
             setter 副作用，而 electron-updater 已随自动更新一并拆掉；
          ③ 现在：本机只发 stable，切到 beta 那边**没有包**，检查会 unreachable。
          之所以把这段历史留着：一处解释性文案连着两次比它解释的东西活得更久，
          说明它值得被当成会过期的东西看待，而不是写完就忘。 */}
      <SettingsBlock
        icon="list"
        title="更新渠道"
        desc="从哪个渠道问新版本。当前只发布 stable —— 别的渠道那边还没有包，切过去检查会查不到"
      >
        <SettingRow label="渠道">
          <NativeSelect wrapperClassName="sel-narrow" value="stable" disabled>
            <option value="stable">stable（正式）</option>
          </NativeSelect>
        </SettingRow>
      </SettingsBlock>

      <SettingsBlock
        icon="package"
        title="安装方式"
        desc="本应用不会自动下载或自动安装 —— 更新由你自己决定什么时候装"
      >
        <FactRow label="检查" value="手动，或每次打开设置时你点一下" />
        <FactRow label="下载" value="浏览器下载，安装包落在你的下载目录" />
        <FactRow label="安装" value="双击安装包，覆盖安装，业务数据不动" />
        <p className="set-note">
          安装包未做代码签名，Windows SmartScreen 首次会警告一次（「更多信息 → 仍要运行」）。
          这是警告不是封锁 —— 照实说，而不是让你在装到一半时才遇到它。
        </p>
      </SettingsBlock>
    </>
  );
}

/* ---------------- 关于 ---------------- */

function AboutSection({ system }: { system: SystemInfo | null }) {
  return (
    <div className="card">
      <div className="about-block">
        <p>
          <span className="brand-name">RUYIN</span>
        </p>
        <p className="brand-tag">Intelligent Workbench</p>
        <p className="text-body-md text-muted-foreground" style={{ marginTop: 10 }}>
          Vxture AI 原生智能体的本地智能工作环境
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
