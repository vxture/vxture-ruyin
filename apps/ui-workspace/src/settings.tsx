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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Icon,
  Input,
  NativeSelect,
  SectionHeader,
  SegmentedControl,
  StatusBadge,
  useTheme,
} from "@vxture/design-system";
import {
  Api,
  ApiError,
  type ConnectorView,
  type SkillLayer,
  type SkillListing,
  type SkillView,
  type ToolView,
  type DataDirCheck,
  type SessionInfo,
  type SystemInfo,
  type UpdateCheck,
} from "./api";
// SectionId/SETTINGS_SECTIONS live in their own module (settings-sections.ts)
// so the sidebar can know the section list without pulling in this file's
// DS-heavy SettingsView - see that file's header comment (TD-011②).
export { SETTINGS_SECTIONS, type SectionId } from "./settings-sections";
import { resolveSection, type SectionId } from "./settings-sections";
import { NoticeBar } from "./notice-bar";
import { useHostChrome } from "./host-chrome";

const UI_VERSION = "0.2.0";

/**
 * 换地址。设置页在工作台的 hash 路由里（workbench.tsx 的 navigate 监听
 * hashchange），所以「去另一页」就是改 hash —— 设置页不需要自己拿到路由函数。
 */
function go(href: string): void {
  window.location.hash = href.replace(/^#/, "");
}
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
    <div className="settings-page">
      {/* 「设置」两个字已经在标题栏和侧栏里，这里不再写第三遍。 */}
      {error && <NoticeBar message={error} onClose={() => setError(null)} />}
      {view === "account" && <AccountSection session={session} />}
      {view === "general" && <SystemSection system={system} api={api} />}
      {view === "connectors" && <ConnectorsSection api={api} />}
      {view === "connectors-add" && <AddConnectorPage api={api} />}
      {view === "skills" && <SkillsSection api={api} />}
      {view === "database" && <DatabaseSection />}
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
  action,
}: {
  label: string;
  value?: React.ReactNode;
  badge?: React.ReactNode;
  mono?: boolean;
  /** 行尾的一个动作（如「打开目录」）。顶到右端，不挤值那一列。 */
  action?: React.ReactNode;
}) {
  return (
    <div className="fact-row">
      <span className="fact-label">{label}</span>
      {/* 值被省略号截掉时，悬停要能看全 —— 只有字符串值能这么挂。 */}
      <span
        className={mono ? "fact-value mono" : "fact-value"}
        {...(typeof value === "string" && value ? { title: value } : {})}
      >
        {value === undefined || value === null || value === "" ? (
          <span className="fact-empty">—</span>
        ) : (
          value
        )}
      </span>
      {badge && <span className="fact-badge">{badge}</span>}
      {action && <span className="fact-action">{action}</span>}
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
            // 「减小 / 默认 / 加大」而不是「小 / 标准 / 大」（owner 2026-09-04
            // 第 3 条）：这三个是**动作**，是把当前字号往哪边调，不是在描述
            // 一个尺码。
            { value: "small", label: "减小" },
            { value: "default", label: "默认" },
            { value: "large", label: "加大" },
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
function SystemSection({ system, api }: { system: SystemInfo | null; api: Api }) {
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
        {/* 数据目录**连它的两个动作一起**由一个组件出（owner 2026-09-05 指出：
            「打开目录」在行上、「更改目录」在下面另一块，同一个对象的两个动作分
            在两处）。行是「数据在哪」，两个按钮是能对它做的两件事 —— 一个看一眼、
            一个换位置。 */}
        <DataDirRow system={system} api={api} />
        <FactRow label="产品目录" value={system?.productsDir} mono />
      </SettingsBlock>

      <SettingsBlock
        icon="lock"
        title="数据加密"
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
            {/* 成功那一侧原来还有个徽章「主密钥由 Windows DPAPI 保护」——**与上面
                「主密钥」那一行说了同一件事**（owner 2026-09-04 第 2 条），删掉。
                明文这一侧留着：它多说了一句「不可用于真实数据」，那是行里没有的
                结论，而且这一条必须显眼 —— 它是「别把真数据放进来」。 */}
            {system.keyProtection === "plaintext" && (
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

  const reload = async () => {
    try {
      setItems((await api.connectors()).items);
      setUnavailable(null);
      // 拉成功了就把上一次的错误擦掉：一条讲「拉不到」的红字压在一张拉到了的
      // 列表下面，比没有提示更糟 —— 它说的事已经不成立了。
      setFailed(null);
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

  const remove = async (target: string) => {
    setFailed(null);
    try {
      await api.removeConnector(target);
      await reload();
    } catch (e) {
      setFailed(String((e as Error).message));
    }
  };
  const enable = async (target: string) => {
    setFailed(null);
    try {
      await api.activateConnector(target);
      await reload();
    } catch (e) {
      // 「还是连不上」不该被包装成「启用失败」：原因照原样转达。
      setFailed(String((e as Error).message));
    }
  };
  const stop = async (target: string) => {
    setFailed(null);
    try {
      await api.deactivateConnector(target);
      await reload();
    } catch (e) {
      setFailed(String((e as Error).message));
    }
  };

  return (
    <SettingsBlock
      icon="plugs-connected"
      title="已安装的连接器"
      desc="来源管理：添加、测试、授权本机 MCP 连接器（局域网 / 私有系统）；它们暴露的工具出现在「能力平台」的清单里，每个项目还要单独授权才能用"
      aside={
        unavailable ? undefined : (
          // 走地址，不是换状态：添加页有自己的地址，返回是真的返回（第 5 条）。
          <Button variant="outline" size="sm" onClick={() => go("#settings/connectors-add")}>
            添加连接器
          </Button>
        )
      }
    >
      {failed && <div className="update-line update-line--warn">{failed}</div>}
      {unavailable ? (
        <p className="set-note">{unavailable}</p>
      ) : items === null ? (
        <p className="set-note">…</p>
      ) : items.length === 0 ? (
        <p className="set-note">尚未安装任何连接器。</p>
      ) : (
        <ul className="row-list" aria-label="已安装的连接器">
          {items.map((c) => (
            <li key={c.id} className="row-item">
              <code className="row-main" title={`${c.command} ${c.args.join(" ")}`}>
                {c.id}
              </code>
              <span className="row-tag">{c.source === "bundled" ? "预置" : c.source}</span>
              {/* 暴露了哪些工具：契约里 provider: connector 的工具要靠同名才接得上，
                  用户对着契约就能看出接没接。 */}
              {c.tools.length > 0 && (
                <span className="text-body-sm text-muted-foreground mono">
                  {`工具：${c.tools.join("、")}`}
                </span>
              )}
              {/* 三种状态各说各的：暂存 ≠ 装了但没跑起来。前者是用户当时的选择，
                  后者是这一刻的故障 —— 混成一句话，用户不知道该改配置还是该点启用。 */}
              {c.state === "stashed" ? (
                <StatusBadge tone="neutral">已暂存</StatusBadge>
              ) : (
                <StatusBadge tone={c.health.ok ? "success" : "warning"}>
                  {c.health.ok
                    ? "运行中"
                    : `未运行${c.health.detail ? "：" + c.health.detail : ""}`}
                </StatusBadge>
              )}
              {c.state === "stashed" && (
                <Button variant="outline" size="sm" onClick={() => void enable(c.id)}>
                  启用
                </Button>
              )}
              {/* 预置的随安装包来，卸不掉，只能停用；用户装的才有「卸载」。 */}
              {c.source === "bundled" ? (
                c.state === "active" && (
                  <Button variant="ghost" size="sm" onClick={() => void stop(c.id)}>
                    停用
                  </Button>
                )
              ) : (
                <Button variant="ghost" size="sm" onClick={() => void remove(c.id)}>
                  卸载
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsBlock>
  );
}

/**
 * 添加连接器 —— **独立一页**（owner 2026-09-04 第 12 条）。
 *
 * 列表页回答「我有什么」，这一页回答「再加一个」。原来两件事挤在同一个分区里，
 * 于是一个只想看看装了什么的人，先看到的是一张表单。
 *
 * 流程里有一步**测试**：先起一次进程、握手、读工具清单，再决定写不写。
 * 通不过也能**暂存** —— 现场连不上是常事（服务没开、端口没通），把配置留下来
 * 比让用户重新敲一遍强；但暂存的不启动、不进任务能拿到的清单，它是待办不是能力。
 */
function AddConnectorPage({ api }: { api: Api }) {
  const [id, setId] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [source, setSource] = useState<"lan" | "private">("lan");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; tools: string[]; detail?: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const argv = () => (args.trim() ? args.trim().split(/\s+/) : []);
  const ready = id.trim().length > 0 && command.trim().length > 0;

  const test = async () => {
    setBusy("test");
    setFailed(null);
    setProbe(null);
    try {
      setProbe(await api.testConnector({ id: id.trim(), command: command.trim(), args: argv() }));
    } catch (e) {
      setFailed(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  const save = async (stashed: boolean) => {
    setBusy("save");
    setFailed(null);
    try {
      await api.installConnector({
        id: id.trim(),
        command: command.trim(),
        // 空格分参数够用了：这是开发态的口子，真正的安装走签名包（TD-036）。
        args: argv(),
        source,
        ...(stashed ? { state: "stashed" as const } : {}),
      });
      // 回列表页 —— 它自己会重新拉一次，不需要谁替它记住。
      go("#settings/connectors");
    } catch (e) {
      setFailed(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsBlock
      icon="plugs-connected"
      title="添加连接器（stdio）"
      desc="一个 MCP 服务器的启动命令。先测一次，再决定启用还是暂存"
      aside={
        <Button variant="ghost" size="sm" onClick={() => go("#settings/connectors")}>
          返回列表
        </Button>
      }
    >
      <Row label="连接器 id">
        <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="如 crm" />
      </Row>
      <Row label="命令">
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="如 node，或 MCP 服务器可执行文件的完整路径"
        />
      </Row>
      <Row label="参数" note="空格分隔，可以留空。">
        <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="--port 8931" />
      </Row>
      <Row label="来源种类" note="契约里声明 lan / private 的上下文类型才能绑到它。">
        <NativeSelect
          aria-label="来源种类"
          value={source}
          onChange={(e) => setSource(e.target.value === "private" ? "private" : "lan")}
        >
          <option value="lan">lan · 局域网系统</option>
          <option value="private">private · 私有服务</option>
        </NativeSelect>
      </Row>

      <div className="add-actions">
        <Button variant="outline" disabled={!ready || busy !== null} onClick={() => void test()}>
          {busy === "test" ? "正在测试…" : "测试连接"}
        </Button>
        {/* 主按钮只在测通之后亮：没测过就写进去，等于把「能用」这件事留给
            下一个打开它的人去发现。 */}
        <Button disabled={!ready || busy !== null || probe?.ok !== true} onClick={() => void save(false)}>
          {busy === "save" ? "正在添加…" : "添加并启用"}
        </Button>
        {probe && !probe.ok && (
          <Button variant="ghost" disabled={busy !== null} onClick={() => void save(true)}>
            暂存（不启用）
          </Button>
        )}
      </div>

      {probe?.ok && (
        <p className="update-line">
          连接成功
          {probe.tools.length > 0 ? (
            <>
              ，对方报了 {probe.tools.length} 个工具：
              <span className="mono"> {probe.tools.join("、")}</span>
            </>
          ) : (
            "，但对方没有报出任何工具 —— 契约里 provider: connector 的工具会接不上"
          )}
        </p>
      )}
      {probe && !probe.ok && (
        <p className="update-line update-line--warn">
          连不上{probe.detail ? "：" + probe.detail : ""}。可以改配置再测，或先暂存 —— 暂存的不会启动，也不会被任务用到。
        </p>
      )}
      {failed && <div className="update-line update-line--warn">{failed}</div>}
      <p className="set-note">
        签名信任锚就位前，正式版会拒绝安装并说明原因（TD-036）；测试本身不落盘，起一下就结束。
      </p>
    </SettingsBlock>
  );
}

/**
 * 换数据目录（TD-039）。**一次性操作，所以只在页面上留一个按钮。**
 *
 * 三步走完在弹层里：**选目录**（系统目录框，壳弹 —— 见 folder-pick）→ **确认**
 * （从哪到哪、多少、同盘还是跨盘、要重启、失败会留在原处）→ **重启并搬移**。
 *
 * 页面上不再有输入框与「检查目标」：校验是我们的事，不是用户要记得先按的一步。
 * 它现在发生在用户选完目录之后，结果直接写在确认那一屏里。
 */
function DataDirRow({ system, api }: { system: SystemInfo | null; api: Api }) {
  // 壳在不在，决定给不给这两个按钮：系统目录框与资源管理器都只有壳弹得出来，
  // 浏览器里给了就是给两条走不通的路。
  const hostChrome = useHostChrome();
  const [open, setOpen] = useState(false);
  const pending = system?.dataDirPending;
  const last = system?.lastMove;
  const shell = hostChrome === "electron" && Boolean(system?.dataDir);

  return (
    <>
      <FactRow
        label="数据目录"
        value={system?.dataDir}
        mono
        {...(shell
          ? {
              action: (
                <>
                  {/* 「打开目录」在前：**大多数人想要的是看一眼**，而不是搬家。
                      默认目录要让人不想改，那就先让人找得到它。 */}
                  <Button variant="ghost" size="sm" onClick={() => void api.openDataDir()}>
                    <Icon name="folder-open" size="xs" />
                    打开目录
                  </Button>
                  {/* 排着一次搬移时不给「更改」：那时该做的是重启或取消，
                      而不是再选一个新目标。 */}
                  {!pending && (
                    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                      更改…
                    </Button>
                  )}
                </>
              ),
            }
          : {})}
      />
      {/* 排着一次搬移时，这一块要说清楚现在是什么状态 —— 它比「换位置」这个
          动作更重要，所以放在最前面。 */}
      {pending && (
        <p className="set-callout set-callout--warning">
          <Icon name="warning" size="sm" />
          <span>
            <strong>已排好一次搬移，重启后生效。</strong>
            目标：<span className="mono">{pending}</span>。搬移在下次启动、打开任何数据库之前
            进行；万一没搬成，应用会照旧从原目录启动并告诉你原因。
          </span>
        </p>
      )}
      {!pending && last?.status === "failed" && (
        <p className="set-callout set-callout--warning">
          <Icon name="warning" size="sm" />
          <span>
            <strong>上次搬移没成功，数据仍在原处。</strong>
            {last.reason}
          </span>
        </p>
      )}
      {/* 成功的回执**只在搬完的那一次启动**出现（justNow），并且不重复路径 ——
          新位置就写在正上方那一行里。再往后这条就是历史，而历史不该占着设置页
          （owner 2026-09-05）。失败不同：数据还在原处，那是要人处理的状态，
          所以它一直显示到下一次动作为止。 */}
      {!pending && last?.status === "moved" && last.justNow && (
        <p className="set-note">数据已搬到上面这个新位置，旧目录里只剩缓存。</p>
      )}

      {/* 待搬状态下的两个动作跟着那条提醒走：它们说的是「这次搬移」，不是
          「这个目录」—— 所以不在行上。 */}
      {pending && (
        <div className="add-actions">
          <Button size="sm" onClick={() => void api.restartApp()}>
            立即重启并搬移
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void api.cancelDataDir().then(() => window.location.reload())}
          >
            取消这次搬移
          </Button>
        </div>
      )}
      {open && (
        <DataDirMoveDialog
          api={api}
          current={system?.dataDir ?? ""}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * 换目录那一层弹窗：选 → 校验 → 确认 → 重启。
 *
 * 每一步的措辞都只说用户需要知道的那件事。**要重启这件事必须在按下之前说**，
 * 而不是按下之后才发生 —— 一个会关掉应用的按钮，不能长得像一个普通按钮。
 */
function DataDirMoveDialog({
  api,
  current,
  onClose,
}: {
  api: Api;
  current: string;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [check, setCheck] = useState<DataDirCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const pick = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const picked = await api.pickFolder(current || undefined);
      if (!picked.path) return; // 取消：什么都不变，也不报错
      setTarget(picked.path);
      // 选完立刻校验 —— 用户不该记得「还要按一下检查」。
      setCheck(await api.checkDataDir(picked.path));
    } catch (e) {
      setFailed(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const go = async () => {
    if (!target) return;
    setBusy(true);
    setFailed(null);
    try {
      await api.requestDataDir(target);
      await api.restartApp();
    } catch (e) {
      setFailed(String((e as Error).message));
      setBusy(false);
    }
  };

  const mb = ((check?.bytes ?? 0) / 1024 / 1024).toFixed(0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>更改数据目录</DialogTitle>
          <DialogDescription>
            业务数据与密钥会搬到新位置。搬移在下次启动、打开任何数据库之前进行。
          </DialogDescription>
        </DialogHeader>

        <div className="move-dlg">
          <FactRow label="当前" value={current} mono />
          <FactRow
            label="搬到"
            value={target ?? undefined}
            mono
            action={
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void pick()}>
                {target ? "重新选择…" : "选择目录…"}
              </Button>
            }
          />
          {check && !check.ok && (
            <p className="set-callout set-callout--warning">
              <Icon name="warning" size="sm" />
              <span>{check.reason}</span>
            </p>
          )}
          {check?.ok && (
            <p className="set-note">
              要搬 约 {mb} MB
              {check.sameVolume
                ? " · 同一个盘，改名即可，几乎瞬间完成。"
                : " · 跨盘，要逐文件复制并核对，可能要等几分钟。"}
              {" 缓存不搬（它会自己重建）。"}
            </p>
          )}
          <p className="set-note">
            按下之后应用会**关闭并重新打开**，期间会显示搬移进度。源目录在核对通过之前
            一直是权威 —— 中途失败就照旧从原处启动，数据不会丢。数据按当前 Windows
            用户加密，所以不要选别的用户的目录或移动磁盘。
          </p>
          {failed && <p className="set-note">{failed}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={busy || !check?.ok} onClick={() => void go()}>
            重启并搬移
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 数据库 ---------------- */

/**
 * 数据库 —— **占位，功能未开通**（owner 2026-09-04 第 6 条）。
 *
 * 放一个空页而不是隐藏这一项，是有意的：菜单里出现它，说明这件事在路线上；
 * 但页面**不摆假控件** —— 一个连不上任何东西的连接表单，会让人以为是自己配错了。
 * 现在业务数据都在本机 SQLite（通用设置 › 存储位置），外部数据库进上下文要走
 * 连接器那条路（ADR-005 通路二）。
 */
function DatabaseSection() {
  return (
    <div className="card">
      <EmptyState
        icon="table"
        title="功能暂未开通"
        description="外部数据库接入还没有开放。业务数据当前全部在本机的加密库里（通用设置 › 存储位置）；要把局域网或私有服务的数据带进上下文，先用「连接器」那条路。"
      />
    </div>
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
        {/* 名称与控件同一行、列宽与别处同一套（owner 2026-09-04 追加）：
            这里原先用的是纵向那套旧行，于是整个设置页只有这一处是两行。 */}
        <Row label="渠道">
          <NativeSelect value="stable" disabled>
            <option value="stable">stable（正式）</option>
          </NativeSelect>
        </Row>
      </SettingsBlock>

      <SettingsBlock
        icon="package"
        title="安装方式"
        desc="本应用不会自动下载或自动安装 —— 更新由你自己决定什么时候装"
      >
        <FactRow label="检查" value="手动，或每次打开设置时你点一下" />
        <FactRow label="下载" value="浏览器下载，安装包落在你的下载目录" />
        <FactRow label="安装" value="双击安装包，覆盖安装，业务数据不动" />
        {/* 语气块，不是灰色小字（owner 2026-09-04 第 1 条）：这一条是**装之前
            要先知道**的事，混在事实行下面的说明里会被划过去。原来那句还带着
            「照实说，而不是让你装到一半才遇到」—— 那是写给我们自己看的编辑说明，
            不是给用户的话，删掉。 */}
        <p className="set-callout set-callout--warning">
          <Icon name="warning" size="sm" />
          <span>
            <strong>首次安装时 Windows 会拦一下。</strong>
            安装包还没做代码签名，SmartScreen 第一次会弹一个蓝色提示框：点「更多信息」，
            再点「仍要运行」即可继续。这是提醒，不是阻止；同一台机器以后不再提示。
          </span>
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

/**
 * 能力平台（ADR-018 §2.7）—— 本机装着的能力：技能（指令包）与工具（可执行）。
 *
 * 用户在这里看得见、管得着，但**不直接用**：调用它们的只有产品，且产品必须在
 * 契约里声明（§2.5）。所以这一页没有「运行」按钮，只有启用 / 停用与刷新。
 * 四层来源同名时近者优先，被盖住的那条如实标「被覆盖」，而不是从清单里消失。
 */
const LAYER_LABEL: Record<SkillLayer, string> = {
  bundled: "预置",
  distributed: "产品分发",
  user: "用户",
  project: "项目",
};
const TIER_LABEL: Record<string, string> = {
  default: "默认启用",
  "installed-disabled": "装而不启用",
  "runos-registered": "经 Runos",
};
const TOOL_STATUS: Record<ToolView["status"], { label: string; tone: "success" | "warning" | "neutral" }> = {
  available: { label: "可用", tone: "success" },
  unavailable: { label: "不可用", tone: "warning" },
  registered: { label: "已登记", tone: "neutral" },
  runos: { label: "经 Runos", tone: "neutral" },
};
const TOOL_KIND: Record<ToolView["kind"], string> = {
  builtin: "内建",
  connector: "连接器",
  "mcp-server": "MCP 服务器",
};

function SkillsSection({ api }: { api: Api }) {
  const [listing, setListing] = useState<SkillListing | null>(null);
  const [tools, setTools] = useState<ToolView[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [layer, setLayer] = useState<"all" | SkillLayer>("all");

  const reload = async () => {
    try {
      setListing(await api.skills());
      setUnavailable(null);
      setFailed(null);
    } catch (e) {
      // 503 = 这套装配没有技能登记册。这是一个事实，不是错误，单独说。
      if (e instanceof ApiError && e.status === 503) {
        setListing({ items: [], layers: [], scannedAt: "" });
        setUnavailable(e.message);
      } else {
        setFailed(String((e as Error).message));
      }
    }
    try {
      setTools((await api.tools()).items);
    } catch {
      setTools([]);
    }
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const refresh = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await api.refreshSkills();
      await reload();
    } catch (e) {
      setFailed(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (s: SkillView) => {
    setFailed(null);
    try {
      await api.setSkillEnabled({ name: s.name, layer: s.layer, source: s.source }, !s.enabled);
      await reload();
    } catch (e) {
      setFailed(String((e as Error).message));
    }
  };

  const items = (listing?.items ?? []).filter((s) => layer === "all" || s.layer === layer);
  const layerSummary = (listing?.layers ?? []).map((l) => `${LAYER_LABEL[l.layer]} ${l.count}`).join(" · ");
  // 预置的 MCP 服务器：启动 = 真起进程、握手、列工具；起不了的原因照原样转达。
  const [starting, setStarting] = useState<string | null>(null);
  const launch = async (t: ToolView, on: boolean) => {
    setFailed(null);
    setStarting(t.id);
    try {
      if (on) await api.activateConnector(t.id);
      else await api.deactivateConnector(t.id);
      await reload();
    } catch (e) {
      setFailed(String((e as Error).message));
    } finally {
      setStarting(null);
    }
  };

  return (
    <>
      <SettingsBlock
        icon="sparkles"
        title="技能"
        desc="本机装着的指令包（Agent Skills）：预置 → 产品分发 → 用户 → 项目，同名近者优先。只有产品在契约里声明了的任务能读到它们"
        aside={
          unavailable ? undefined : (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>
              {busy ? "刷新中…" : "刷新"}
            </Button>
          )
        }
      >
        {failed && <div className="update-line update-line--warn">{failed}</div>}
        {unavailable ? (
          <p className="set-note">{unavailable}</p>
        ) : listing === null ? (
          <p className="set-note">…</p>
        ) : (
          <>
            {/* 计数一行、筛选一行：挤在同一行里，计数会在选择框旁边折成两行。 */}
            <p className="set-note">{layerSummary || "尚无技能"}</p>
            <div className="row-item">
              <NativeSelect
                aria-label="按来源层筛选"
                value={layer}
                onChange={(e) => setLayer(e.target.value as "all" | SkillLayer)}
              >
                <option value="all">全部来源</option>
                {(["bundled", "distributed", "user", "project"] as SkillLayer[]).map((l) => (
                  <option key={l} value={l}>
                    {LAYER_LABEL[l]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {items.length === 0 ? (
              <p className="set-note">
                {listing.items.length === 0
                  ? "本机还没有任何技能。预置层随安装包来；开发态要先 pnpm skills:pull。"
                  : "这一层没有技能。"}
              </p>
            ) : (
              <ul className="row-list" aria-label="技能">
                {items.map((s) => (
                  <li key={`${s.layer}:${s.source}:${s.name}`} className="row-item">
                    <code className="row-main" title={`${s.dir}\n${s.description}`}>
                      {s.name}
                    </code>
                    <span className="row-tag">{LAYER_LABEL[s.layer]}</span>
                    <span className="text-body-sm text-muted-foreground">
                      {s.source}
                      {s.version ? ` · v${s.version}` : ""}
                      {s.license ? ` · ${s.license}` : ""}
                      {s.tier ? ` · ${TIER_LABEL[s.tier] ?? s.tier}` : ""}
                    </span>
                    {/* 脚本本地不跑（TD-005）：标出来，而不是悄悄跳过。 */}
                    {s.hasScripts && <StatusBadge tone="neutral">含脚本（本地不跑）</StatusBadge>}
                    {s.shadowedBy ? (
                      <StatusBadge tone="neutral">{`被${LAYER_LABEL[s.shadowedBy]}层覆盖`}</StatusBadge>
                    ) : (
                      <StatusBadge tone={s.enabled ? "success" : "neutral"}>{s.enabled ? "启用" : "停用"}</StatusBadge>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => void toggle(s)}>
                      {s.enabled ? "停用" : "启用"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SettingsBlock>
      <SettingsBlock
        icon="plugs-connected"
        title="工具"
        desc="可执行的能力：运行时内建的、已装连接器暴露的、预置清单登记的 MCP 服务器。每一次调用都过 Tool Gate"
      >
        {tools === null ? (
          <p className="set-note">…</p>
        ) : tools.length === 0 ? (
          <p className="set-note">没有工具登记册。</p>
        ) : (
          <ul className="row-list" aria-label="工具">
            {tools.map((t) => (
              <li key={`${t.kind}:${t.id}`} className="row-item">
                <code className="row-main" title={t.detail ?? ""}>
                  {t.id}
                </code>
                <span className="row-tag">{TOOL_KIND[t.kind]}</span>
                {(t.license || t.tier) && (
                  <span className="text-body-sm text-muted-foreground">
                    {[t.license, t.tier ? (TIER_LABEL[t.tier] ?? t.tier) : undefined].filter(Boolean).join(" · ")}
                  </span>
                )}
                {t.tools && t.tools.length > 0 && (
                  <span className="text-body-sm text-muted-foreground mono">{`工具：${t.tools.join("、")}`}</span>
                )}
                {t.launchable && t.status !== "available" && t.detail && (
                  <span className="text-body-sm text-muted-foreground">{t.detail}</span>
                )}
                <StatusBadge tone={TOOL_STATUS[t.status].tone}>{TOOL_STATUS[t.status].label}</StatusBadge>
                {t.launchable && (
                  <Button
                    variant={t.status === "available" ? "ghost" : "outline"}
                    size="sm"
                    disabled={starting === t.id}
                    onClick={() => void launch(t, t.status !== "available")}
                  >
                    {starting === t.id ? "…" : t.status === "available" ? "停止" : "启动"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsBlock>
    </>
  );
}
