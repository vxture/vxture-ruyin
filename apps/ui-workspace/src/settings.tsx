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

import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  Input,
  NativeSelect,
  SectionHeader,
  SegmentedControl,
  StatusBadge,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useTheme,
} from "@vxture/design-system";
import {
  Api,
  ApiError,
  type AtlasModel,
  type ConnectorView,
  type SkillLayer,
  type SkillListing,
  type SkillView,
  type ComponentState,
  type PythonRuntimeStatus,
  type PythonRuntimeState,
  type PythonStepCode,
  type PythonFailureCode,
  type ToolView,
  type CapabilityRouting,
  type CapabilityCatalogPage,
  type CatalogItem,
  type CatalogSourceStatus,
  type DataDirCheck,
  type HardwareInfo,
  type SessionInfo,
  type SystemInfo,
  type PrivateModelView,
} from "./api";
import { consoleAppBaseOf } from "./platform-base";
// SectionId/SETTINGS_SECTIONS live in their own module (settings-sections.ts)
// so the sidebar can know the section list without pulling in this file's
// DS-heavy SettingsView - see that file's header comment (TD-011②).
export { SETTINGS_SECTIONS, type SectionId } from "./settings-sections";
import { resolveSection, type SectionId } from "./settings-sections";
import { NoticeBar } from "./notice-bar";
import { groupCapabilities } from "./capability-groups";
import { useHostChrome } from "./host-chrome";

import { BrandInfoBlock } from "./brand-info";
import { UpdateNotice, channelLabel, type UpdateCheckState } from "./update-check";
import {
  LOCALE_NAMES,
  LOCALES,
  useLocale,
  useT,
  type Locale,
  type MessageKey,
  type TFn,
} from "./i18n";
import { useSetLocale } from "./locale-provider";
import { describeError } from "./api-message";
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

export function SettingsView({
  api,
  section,
  updateCheck,
}: {
  api: Api;
  section: SectionId;
  /**
   * 检查更新的共享状态，从工作台那一层传下来（owner 2026-09-15：自动检查的
   * 挂载点从设置页挪到工作台，好让它在**登录后应用一起来**那一刻问，而不是
   * 「下次打开设置页」才问）。结果要能在**任何**分区的顶部露出来——自动检查
   * 可能在用户正看着别的分区时问完。
   */
  updateCheck: UpdateCheckState;
}) {
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
      <UpdateNotice state={updateCheck} />
      {view === "account" && <AccountSection session={session} api={api} />}
      {view === "general" && <SystemSection system={system} api={api} />}
      {view === "connectors" && <ConnectorsSection api={api} />}
      {view === "connectors-add" && <AddConnectorPage api={api} />}
      {view === "models" && <ModelsSection api={api} system={system} />}
      {view === "skills" && <SkillsSection api={api} />}
      {view === "database" && <DatabaseSection />}
      {view === "updates" && <UpdatesSection system={system} updateCheck={updateCheck} />}
      {view === "about" && <AboutSection system={system} session={session} api={api} />}
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
  collapsible = false,
  defaultOpen = true,
  count,
  children,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  title: string;
  desc?: string;
  /** 板块级动作，靠右（例如账号信息的「在线修改」）。 */
  aside?: React.ReactNode;
  /**
   * 可收起（owner 2026-09-07）。**默认关着这个能力**：绝大多数板块只有三五行，
   * 给它们一个折叠钮等于多一个没有意义的状态。只有内容长到会把别的板块顶出
   * 屏幕的（能力平台的两大类）才打开它。折叠钮是箭头图标 + 点标题行也能触发
   * （owner 2026-09-16：全站只留一套折叠版式，不分「文字按钮」「箭头图标」
   * 两套——之前给连接器管理单独开的 `chevronToggle` 开关已经收掉，这是唯一
   * 的样子）。可访问名仍是「收起 / 展开」（`aria-label`），只是不再拿这两个
   * 字当可见文案。
   */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** 收起时仍然看得见的条数 —— 折叠不该把「这里有多少东西」一起藏掉。 */
  count?: number;
  children: React.ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const body = <div className="set-block-body">{children}</div>;
  const toggle = () => setOpen((v) => !v);
  const titleContent = (
    <>
      <span className="set-block-icon" aria-hidden>
        <Icon name={icon} size="sm" />
      </span>
      <div className="set-block-titles">
        <h3 className="set-block-title">
          {title}
          {typeof count === "number" && <span className="set-block-count">{count}</span>}
        </h3>
        {desc && <p className="set-block-desc">{desc}</p>}
      </div>
    </>
  );
  // 标题行只分两组（owner 2026-09-16 第三次修正，与连接器卡同一个手法）：
  // 标题在左，筛选/刷新/折叠箭头等操作拼成 trailing 一组一起靠右——
  // `.set-block-head` 下必须**永远只有两个直接子节点**，`space-between` 才能
  // 把它们分落两端；此前 aside 与折叠箭头是两个各自散落的子节点，才会出现
  // 「操作区紧跟在标题后面」而不是「贴在最右」。
  const trailing = (aside || collapsible) && (
    <span className="set-block-trailing">
      {aside && <span className="set-block-aside">{aside}</span>}
      {collapsible && (
        <button
          type="button"
          className="set-block-toggle set-block-toggle--chevron"
          aria-expanded={open}
          aria-label={t(open ? "set.collapse" : "set.expand")}
          onClick={toggle}
        >
          <Icon name={open ? "chevron-up" : "chevron-down"} size="sm" />
        </button>
      )}
    </span>
  );
  return (
    <section className="card set-block">
      <header className="set-block-head">
        {collapsible ? (
          <button type="button" className="set-block-head-hit" aria-expanded={open} onClick={toggle}>
            {titleContent}
          </button>
        ) : (
          <span className="set-block-head-static">{titleContent}</span>
        )}
        {trailing}
      </header>
      {(!collapsible || open) && body}
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
  const t = useT();
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
  const t = useT();
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

/**
 * 长标识的短形：前 8 位 + 省略号。**不是为了好看，是为了可读** —— 一串 43 个
 * 字符的指纹摊在行里，谁也不会去读它，只会把旁边的事实一起淹掉。前 8 位足够
 * 认出「是不是这一台」，整串由「复制」给出。
 */
function shortId(id?: string): string | undefined {
  if (!id) return undefined;
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/**
 * 复制一个值，并当场说一声复制成功了。
 *
 * **「已复制」必须出现**：点了按钮什么都不变，用户会再点一次，然后怀疑它坏了。
 * 剪贴板在没有安全上下文（http、沙盒 iframe）里会抛，那时按钮就什么也不说 ——
 * 谎报「已复制」比不报更糟。
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 2000);
    } catch {
      /* 复制不了就不吭声，绝不假装成功。 */
    }
  };
  return (
    <Button variant="ghost" size="sm" aria-label={label} onClick={() => void copy()}>
      <Icon name={done ? "check" : "copy"} size="xs" />
      {t(done ? "common.copied" : "common.copy")}
    </Button>
  );
}

/* ---------------- 账户 ---------------- */

/**
 * 账户：登录后把会话里的身份**摆出来**（姓名、邮箱、租户、工作区），修改走
 * 云平台的「个人信息」页（owner 2026-09-03 定：不能只留一个跳转页）。本机只读
 * 会话，不改身份 —— 改在平台改，这里如实写「在线修改」。
 */
function AccountSection({ session, api }: { session: SessionInfo | null; api: Api }) {
  const t = useT();
  if (!session?.signedIn) {
    return (
      <>
        <div className="card">
          <EmptyState
            icon="user-circle"
            title={t("set.account.signInTitle")}
            description={t("set.account.signInDesc")}
          />
        </div>
        <PreferencesBlock api={api} />
      </>
    );
  }
  const p = session.profile;
  // 「个人信息」页落在 console-bff 本体上，不是官网 consoleBase（owner 2026-09-16
  // audit：与「用户中心」「配额用量」同一类错，见 user.tsx 的 consoleAppBase 说明）。
  const profileUrl = `${consoleAppBaseOf(session)}/profile`;
  const name = p?.name ?? p?.email ?? t("user.defaultName");
  const verified = (ok?: boolean) =>
    ok === undefined ? undefined : ok ? (
      <StatusBadge tone="success">{t("set.account.verified")}</StatusBadge>
    ) : (
      <StatusBadge tone="warning">{t("set.account.unverified")}</StatusBadge>
    );
  return (
    <>
      <SettingsBlock
        icon="role"
        title={t("set.account.title")}
        desc={t("set.account.desc")}
        aside={
          <Button variant="outline" size="sm" onClick={() => window.open(profileUrl, "_blank", "noopener")}>
            {t("set.account.editOnline")}
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
        <FactRow label={t("set.account.displayName")} value={p?.name} />
        <FactRow label={t("set.account.username")} value={p?.username} mono />
        <FactRow label={t("set.account.email")} value={p?.email} badge={verified(p?.emailVerified)} />
        <FactRow label={t("set.account.phone")} value={p?.phone} badge={verified(p?.phoneVerified)} />
        <FactRow
          label={t("set.account.roles")}
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
        <FactRow label={t("set.account.locale")} value={p?.locale} mono />
        {/* 租户与工作区同一行（owner 第 4 条）：它们回答的是同一个问题 ——
            「我现在在哪儿干活」。中间一个淡分隔点，不是两行各说一半。
            **这里不再放切换入口**（owner 2026-09-15）：标题栏的租户菜单里已经有
            「租户管理 → 平台」这一条，两处都能切等于同一件事写了两遍；本机也确实
            切不了（token 里只有 `active_org` 一个组织，平台 v2 已弃用 `tenants`
            声明），要切只能去标题栏那一处。 */}
        <div className="fact-row">
          <span className="fact-label">{t("set.account.tenant")}</span>
          <span className="fact-value">
            {session.org?.name ?? <span className="fact-empty">—</span>}
            {session.org?.type && (
              <span className="fact-tag">
                <StatusBadge tone="neutral">
                  {t(session.org.type === "personal" ? "set.account.tenantPersonal" : "set.account.tenantOrg")}
                </StatusBadge>
              </span>
            )}
            <span className="fact-sep">·</span>
            {session.workspace?.name ?? <span className="fact-empty">—</span>}
          </span>
        </div>
      </SettingsBlock>
      <PreferencesBlock api={api} />
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
function PreferencesBlock({ api }: { api: Api }) {
  const { mode, setMode, density, setDensity, fontSize, setFontSize } = useTheme();
  const t = useT();
  // 语言不再由这一格自己存：它是**整棵树**的状态（换一门语言，屏幕上每一句话
  // 都要跟着变），所以持有者是 `LocaleProvider`，这里只读当前值、只发出切换。
  const locale = useLocale();
  const setLocale = useSetLocale();
  return (
    <SettingsBlock
      icon="settings"
      title={t("set.prefs.title")}
      desc={t("set.prefs.desc")}
    >
      {/* 四项各一行、不带说明（owner 第 5 条）：这四个词自己说得清，一行小字
          只是把行距撑开。控件列定宽，所以四行左右对齐、滑块等长（第 6 条）。 */}
      <Row label={t("prefs.language")}>
        {/* 每门语言用**它自己**写名字（简体中文 / English）—— 要换语言的人，
            多半正读不懂当前这一门。 */}
        <NativeSelect
          value={locale}
          onChange={(e) => {
            const next = e.target.value as Locale;
            setLocale(next);
            // 写给壳看的那一份（原生对话框、系统通知、搬家那一屏）。写不进去
            // 不拦人：界面这一侧已经切好了，壳下次启动跟上就是。
            void api.setLanguage(next).catch(() => {});
          }}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </NativeSelect>
      </Row>
      <Row label={t("set.prefs.theme")}>
        <SegmentedControl
          ariaLabel={t("set.prefs.theme")}
          items={[
            { value: "dark", label: t("set.prefs.theme.dark") },
            { value: "light", label: t("set.prefs.theme.light") },
            { value: "system", label: t("set.prefs.theme.system") },
          ]}
          value={mode}
          onChange={setMode}
        />
      </Row>
      <Row label={t("set.prefs.density")}>
        <SegmentedControl
          ariaLabel={t("set.prefs.density")}
          items={[
            { value: "compact", label: t("set.prefs.density.compact") },
            { value: "default", label: t("set.prefs.density.default") },
            { value: "comfortable", label: t("set.prefs.density.comfortable") },
          ]}
          value={density}
          onChange={setDensity}
        />
      </Row>
      <Row label={t("set.prefs.fontSize")}>
        <SegmentedControl
          ariaLabel={t("set.prefs.fontSize")}
          items={[
            // 「减小 / 默认 / 加大」而不是「小 / 标准 / 大」（owner 2026-09-04
            // 第 3 条）：这三个是**动作**，是把当前字号往哪边调，不是在描述
            // 一个尺码。
            { value: "small", label: t("set.prefs.fontSize.small") },
            { value: "default", label: t("set.prefs.fontSize.default") },
            { value: "large", label: t("set.prefs.fontSize.large") },
          ]}
          value={fontSize}
          onChange={setFontSize}
        />
      </Row>
    </SettingsBlock>
  );
}

/* ---------------- 通用设置（原「数据与隐私」的内容）---------------- */

/** 数据加密那几行里的关键词高亮（owner 2026-09-15）：盾牌 + 淡底，扫一眼就找到
 *  「用的是什么算法 / 什么机制」，不必读完整句话。图标改盾牌（对勾读作「已完成」，
 *  这里说的是「有什么在把关」，盾牌更贴）。 */
function CryptoTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="crypto-tag">
      <Icon name="shield-check" size="xs" />
      {children}
    </span>
  );
}

/**
 * 通用设置：数据在哪儿、怎么加密、什么会离开本机。三件事三个板块 ——
 * 原先它们挤在两张卡里，而「目录」和「加密」不是同一个问题。
 */
function SystemSection({ system, api }: { system: SystemInfo | null; api: Api }) {
  const t = useT();
  /* 「打开目录」只有 Electron 壳做得到 —— 浏览器里同一个页面也开着，那里不给
     这个入口，而不是给一个点了没反应的按钮。 */
  const inShell = useHostChrome() === "electron";
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
        title={t("set.storage.title")}
        desc={t("set.storage.desc")}
      >
        {/* 数据目录**连它的两个动作一起**由一个组件出（owner 2026-09-05 指出：
            「打开目录」在行上、「更改目录」在下面另一块，同一个对象的两个动作分
            在两处）。行是「数据在哪」，两个按钮是能对它做的两件事 —— 一个看一眼、
            一个换位置。 */}
        <DataDirRow system={system} api={api} />
        <FactRow label={t("set.storage.productsDir")} value={system?.productsDir} mono />
        {/* 安装标识（阶段 3a）。和运行日志放在一起，因为它们服务的是同一件事：
            用户报障时**对得上是哪一台**。刻意不叫「设备 ID」—— 它跟着安装走，
            重装即换，而且将来限制的是同时在线数不是安装数（RY-100 A10）。

            **它有一个用途，只有一个**（owner 2026-09-17 问的就是这个）：报障时
            把它给我们。用户不需要读懂它，更不需要记住它 —— 所以摊开 43 个字符
            没有意义，那只是一条谁也不会去读的乱码。留前 8 位让人认出「是这一台」，
            整串交给「复制」。它是公钥指纹，不是秘密，复制出去是安全的。 */}
        <FactRow
          label={t("set.storage.instanceId")}
          value={shortId(system?.instanceId)}
          mono
          {...(system?.instanceId
            ? { action: <CopyButton value={system.instanceId} label={t("set.storage.copyInstanceId")} /> }
            : {})}
        />
        {/* 运行日志（TD-066）。**只给入口，不显示路径** —— 路径是壳自己算的
            （Electron 的标准日志位置），守护进程不知道它，界面更不该编一个出来。
            用户报障时要的就是这一下：打开、把文件拖过来。 */}
        <FactRow
          label={t("set.storage.logs")}
          value={t("set.storage.logsValue")}
          {...(inShell
            ? {
                action: (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("set.storage.openLogDir")}
                    onClick={() => void api.openLogDir()}
                  >
                    <Icon name="folder-open" size="xs" />
                    {t("set.storage.openDir")}
                  </Button>
                ),
              }
            : {})}
        />
      </SettingsBlock>

      <SettingsBlock
        icon="lock"
        title={t("set.crypto.title")}
        desc={t("set.crypto.desc")}
      >
        {system ? (
          <>
            <ul className="crypto-chain">
              <li>
                <span className="crypto-what">{t("set.crypto.data")}</span>
                <span className="crypto-how">
                  {t("set.crypto.dataHow")}
                  <CryptoTag>SQLCipher（AES-256）</CryptoTag>
                </span>
              </li>
              <li>
                <span className="crypto-what">{t("set.crypto.dbKey")}</span>
                <span className="crypto-how">
                  {t("set.crypto.dbKeyHow")}
                  <CryptoTag>AES-256-GCM</CryptoTag>
                  {t("set.crypto.dbKeyWrapped")}
                </span>
              </li>
              <li>
                <span className="crypto-what">{t("set.crypto.masterKey")}</span>
                <span className="crypto-how">
                  {system.keyProtection === "dpapi" ? (
                    <>
                      {t("set.crypto.masterKeyProtectedPrefix")}
                      <CryptoTag>Windows DPAPI</CryptoTag>
                      {t("set.crypto.masterKeyProtectedSuffix")}
                    </>
                  ) : (
                    t("set.crypto.masterKeyPlain")
                  )}
                </span>
              </li>
            </ul>
            {/* 成功那一侧原来还有个徽章「主密钥由 Windows DPAPI 保护」——**与上面
                「主密钥」那一行说了同一件事**（owner 2026-09-04 第 2 条），删掉。
                明文这一侧留着：它多说了一句「不可用于真实数据」，那是行里没有的
                结论，而且这一条必须显眼 —— 它是「别把真数据放进来」。 */}
            {system.keyProtection === "plaintext" && (
              <StatusBadge tone="warning">{t("set.crypto.devBadge")}</StatusBadge>
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
        title={t("set.inference.title")}
        desc={t("set.inference.desc")}
      >
        <Row
          label={t("set.inference.grain")}
          note={t("set.inference.note")}
        >
          <SegmentedControl
            ariaLabel={t("set.inference.aria")}
            items={[
              { value: "sensitivity", label: t("set.inference.bySensitivity") },
              { value: "always", label: t("set.inference.always") },
            ]}
            value={policy}
            onChange={pickPolicy}
          />
        </Row>
      </SettingsBlock>

      <SettingsBlock
        icon="list"
        title={t("set.audit.title")}
        desc={t("set.audit.desc")}
      >
        <FactRow label={t("set.audit.scope")} value={t("set.audit.scopeValue")} />
        <FactRow label={t("set.audit.tamper")} value={t("set.audit.tamperValue")} />
        <FactRow label={t("set.audit.view")} value={t("set.audit.viewValue")} />
        <p className="set-note">{t("set.audit.note")}</p>
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
  const t = useT();
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
        setUnavailable(describeError(t, e));
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
      title={t("set.conn.title")}
      desc={t("set.conn.desc")}
      aside={
        unavailable ? undefined : (
          // 走地址，不是换状态：添加页有自己的地址，返回是真的返回（第 5 条）。
          <Button variant="outline" size="sm" onClick={() => go("#settings/connectors-add")}>
            {t("set.conn.add")}
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
        <p className="set-note">{t("set.conn.none")}</p>
      ) : (
        /* 每个连接器一张卡（owner 2026-09-16，原来共用「一行就是一行」的
           `.row-list`）：启用后要展开一段工具清单，塞进那个给「一条授权 /
           一条绑定」用的窄行里，启用的那一条把其它列全挤没了——这不是同一类
           内容，改用连接器专属的卡片版式，不动 `.row-list` 影响到别处。展开/
           收起是每张卡自己的事（owner 2026-09-16 纠正：上一版把它错放到了
           整个板块上——收起一整个板块没有意义，那不是这里说的「板块」）。 */
        <ul className="connector-list" aria-label={t("set.conn.listAria")}>
          {items.map((c) => (
            <ConnectorCard
              key={c.id}
              c={c}
              onEnable={() => void enable(c.id)}
              onStop={() => void stop(c.id)}
              onRemove={() => void remove(c.id)}
            />
          ))}
        </ul>
      )}
    </SettingsBlock>
  );
}

/**
 * 一张连接器卡，展开/收起是它自己的状态（owner 2026-09-16）。默认值跟着
 * 「有没有东西可展开」走——启用且暴露了工具，默认展开；否则默认收起——但
 * 那之后用户可以随时用箭头手动切换，不再是状态锁死的。
 *
 * 箭头只在**有内容可展开时**才可点（`expandable`）：暂存的、或启用了但一个
 * 工具都没暴露的，箭头直接禁用——给一个点开什么都没有的箭头，比不给箭头
 * 更糟。
 */
function ConnectorCard({
  c,
  onEnable,
  onStop,
  onRemove,
}: {
  c: ConnectorView;
  onEnable: () => void;
  onStop: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const running = c.state === "active";
  const expandable = running && c.tools.length > 0;
  const [open, setOpen] = useState(expandable);
  const toggle = () => setOpen((v) => !v);

  const head = (
    <>
      <span className="connector-card-icon" aria-hidden>
        <Icon name="plugs-connected" size="md" />
      </span>
      <span className="connector-card-title">
        <code
          className="connector-card-id"
          title={c.transport === "streamable_http" ? c.url : `${c.command} ${c.args.join(" ")}`}
        >
          {c.id}
        </code>
        {/* 「系统预置」而不是「预置」（owner 2026-09-16）：这个标签是用户唯一
            能看到「为什么这张卡没有删除按钮」的地方——预置的随安装包来，
            后端硬性拒绝卸载（ConnectorBundledError），只能停用。用户自己加的
            标「自定义」，不直接显示 lan / private 这种内部分类值——那不是
            给用户读的词。 */}
        <span className="row-tag">{t(c.source === "bundled" ? "set.conn.bundled" : "set.conn.custom")}</span>
      </span>
    </>
  );

  return (
    <li className={`connector-card${running ? " connector-card--running" : ""}`}>
      <div className="connector-card-head">
        {expandable ? (
          <button type="button" className="connector-card-head-hit" aria-expanded={open} onClick={toggle}>
            {head}
          </button>
        ) : (
          <span className="connector-card-head-static">{head}</span>
        )}
        <span className="connector-card-trailing">
          <span className="connector-card-side">
            {/* 三种状态各说各的：暂存 ≠ 装了但没跑起来。前者是用户当时的选择，
                后者是这一刻的故障 —— 混成一句话，用户不知道该改配置还是该点启用。 */}
            {c.state === "stashed" ? (
              <StatusBadge tone="neutral">{t("set.conn.staged")}</StatusBadge>
            ) : (
              <StatusBadge tone={c.health.ok ? "success" : "warning"}>
                {c.health.ok
              ? t("set.conn.running")
              : c.health.detail
                ? t("set.conn.stoppedWhy", { detail: c.health.detail })
                : t("set.conn.stopped")}
              </StatusBadge>
            )}
            {c.state === "stashed" && (
              <Button variant="outline" size="sm" onClick={onEnable}>
                {t("set.conn.enable")}
                </Button>
            )}
            {/* 预置的随安装包来，卸不掉，只能停用；用户装的才有「卸载」。 */}
            {c.source === "bundled" ? (
              c.state === "active" && (
                <Button variant="ghost" size="sm" onClick={onStop}>
                  {t("set.conn.disable")}
                  </Button>
              )
            ) : (
              <Button variant="ghost" size="sm" onClick={onRemove}>
                {t("set.conn.uninstall")}
                </Button>
            )}
          </span>
          {/* 箭头永远在最右侧（owner 2026-09-16）：不可展开时禁用，不是藏起来
              ——藏起来的话这一列的宽度每张卡都不一样，禁用则始终占着位置，
              一眼就能分清「这张卡没什么可看的」和「这张卡还没加载完」。 */}
          <button
            type="button"
            className="connector-card-toggle"
            aria-expanded={open}
            aria-label={t(open ? "set.collapse" : "set.expand")}
            disabled={!expandable}
            onClick={toggle}
          >
            <Icon name={open ? "chevron-up" : "chevron-down"} size="sm" />
          </button>
        </span>
      </div>
      {expandable && open && (
        <div className="connector-card-tools">
          <span className="connector-card-tools-label">{t("set.conn.toolsLabel")}</span>
          {/* 概要说清「这份清单是干嘛的」，不是重复标题（owner 2026-09-16：
              「暴露的工具」不够人话）。≤30 字，独占一行、撑满容器宽度。 */}
          <p className="connector-card-tools-caption">{t("set.conn.toolsCaption")}</p>
          <div className="connector-card-tools-grid">
            {c.tools.map((t) => (
              <code key={t} className="connector-tool-chip">
                {t}
              </code>
            ))}
          </div>
        </div>
      )}
    </li>
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
  const t = useT();
  const [id, setId] = useState("");
  const [transport, setTransport] = useState<"stdio" | "streamable_http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [source, setSource] = useState<"lan" | "private">("lan");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; tools: string[]; detail?: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const argv = () => (args.trim() ? args.trim().split(/\s+/) : []);
  const ready =
    id.trim().length > 0 && (transport === "streamable_http" ? url.trim().length > 0 : command.trim().length > 0);
  // 换传输方式时，上一种的测试结果不该跟着 —— 那是对着另一条连接细节测的。
  const switchTransport = (next: "stdio" | "streamable_http") => {
    setTransport(next);
    setProbe(null);
    setFailed(null);
  };
  const connectionInput = () =>
    transport === "streamable_http"
      ? ({ id: id.trim(), transport: "streamable_http", url: url.trim() } as const)
      : ({ id: id.trim(), transport: "stdio", command: command.trim(), args: argv() } as const);

  const test = async () => {
    setBusy("test");
    setFailed(null);
    setProbe(null);
    try {
      setProbe(await api.testConnector(connectionInput()));
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
        ...connectionInput(),
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
      title={t("set.conn.addTitle")}
      desc={t("set.conn.addDesc")}
      aside={
        <Button variant="ghost" size="sm" onClick={() => go("#settings/connectors")}>
          {t("set.conn.back")}
        </Button>
      }
    >
      <Row label={t("set.conn.id")}>
        <Input value={id} onChange={(e) => setId(e.target.value)} placeholder={t("set.conn.idPlaceholder")} />
      </Row>
      <Row label={t("set.conn.transport")}>
        <NativeSelect
          aria-label={t("set.conn.transport")}
          value={transport}
          onChange={(e) => switchTransport(e.target.value === "streamable_http" ? "streamable_http" : "stdio")}
        >
          <option value="stdio">{t("set.conn.transportStdio")}</option>
                      <option value="streamable_http">{t("set.conn.transportHttp")}</option>
        </NativeSelect>
      </Row>
      {transport === "streamable_http" ? (
        <Row label={t("set.conn.url")} note={t("set.conn.urlNote")}>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://127.0.0.1:8931/mcp"
          />
        </Row>
      ) : (
        <>
          <Row label={t("set.conn.command")}>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t("set.conn.commandPlaceholder")}
            />
          </Row>
          <Row label={t("set.conn.args")} note={t("set.conn.argsNote")}>
            <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="--port 8931" />
          </Row>
        </>
      )}
      <Row label={t("set.conn.kind")} note={t("set.conn.kindNote")}>
        <NativeSelect
          aria-label={t("set.conn.kind")}
          value={source}
          onChange={(e) => setSource(e.target.value === "private" ? "private" : "lan")}
        >
          <option value="lan">{t("set.conn.kindLan")}</option>
                      <option value="private">{t("set.conn.kindPrivate")}</option>
        </NativeSelect>
      </Row>

      <div className="add-actions">
        <Button variant="outline" disabled={!ready || busy !== null} onClick={() => void test()}>
          {t(busy === "test" ? "set.conn.testing" : "set.conn.test")}
        </Button>
        {/* 主按钮只在测通之后亮：没测过就写进去，等于把「能用」这件事留给
            下一个打开它的人去发现。 */}
        <Button disabled={!ready || busy !== null || probe?.ok !== true} onClick={() => void save(false)}>
          {t(busy === "save" ? "set.conn.saving" : "set.conn.saveEnable")}
        </Button>
        {probe && !probe.ok && (
          <Button variant="ghost" disabled={busy !== null} onClick={() => void save(true)}>
            {t("set.conn.stage")}
          </Button>
        )}
      </div>

      {probe?.ok && (
        <p className="update-line">
          {t("set.conn.probeOk")}
          {probe.tools.length > 0 ? (
            <>
              {t("set.conn.probeTools", { n: probe.tools.length })}
              <span className="mono"> {probe.tools.join("、")}</span>
            </>
          ) : (
            t("set.conn.probeNoTools")
          )}
        </p>
      )}
      {probe && !probe.ok && (
        <p className="update-line update-line--warn">
          {probe.detail
            ? t("set.conn.probeFailWhy", { detail: probe.detail })
            : t("set.conn.probeFail")}
        </p>
      )}
      {failed && <div className="update-line update-line--warn">{failed}</div>}
      <p className="set-note">
        {t(
          transport === "streamable_http"
            ? "set.conn.signNoteHttp"
            : "set.conn.signNoteStdio",
        )}
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
  const t = useT();
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
        label={t("set.storage.dataDir")}
        value={system?.dataDir}
        mono
        {...(shell
          ? {
              action: (
                <>
                  {/* 「打开目录」在前：**大多数人想要的是看一眼**，而不是搬家。
                      默认目录要让人不想改，那就先让人找得到它。 */}
                  {/* 可见文字是「打开目录」（行标签已经说了是哪个目录），但
                      **无障碍名要自带宾语** —— 这一屏上现在有两个「打开目录」
                      （数据、日志），读屏用户听到的是两次一模一样的话。 */}
                  <Button
                variant="ghost"
                size="sm"
                aria-label={t("set.storage.openDataDir")}
                onClick={() => void api.openDataDir()}
              >
                    <Icon name="folder-open" size="xs" />
                    {t("set.storage.openDir")}
                  </Button>
                  {/* 排着一次搬移时不给「更改」：那时该做的是重启或取消，
                      而不是再选一个新目标。 */}
                  {!pending && (
                    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                      {t("set.storage.change")}
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
            <strong>{t("set.storage.movePlanned")}</strong>{" "}
            {t("set.storage.movePlannedBody", { path: pending })}
          </span>
        </p>
      )}
      {!pending && last?.status === "failed" && (
        <p className="set-callout set-callout--warning">
          <Icon name="warning" size="sm" />
          <span>
            <strong>{t("set.storage.moveFailed")}</strong>
            {last.reason}
          </span>
        </p>
      )}
      {/* 成功的回执**只在搬完的那一次启动**出现（justNow），并且不重复路径 ——
          新位置就写在正上方那一行里。再往后这条就是历史，而历史不该占着设置页
          （owner 2026-09-05）。失败不同：数据还在原处，那是要人处理的状态，
          所以它一直显示到下一次动作为止。 */}
      {!pending && last?.status === "moved" && last.justNow && (
        <p className="set-note">{t("set.storage.moveDone")}</p>
      )}

      {/* 待搬状态下的两个动作跟着那条提醒走：它们说的是「这次搬移」，不是
          「这个目录」—— 所以不在行上。 */}
      {pending && (
        <div className="add-actions">
          <Button size="sm" onClick={() => void api.restartApp()}>
            {t("set.storage.restartAndMove")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void api.cancelDataDir().then(() => window.location.reload())}
          >
            {t("set.storage.cancelMove")}
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
  const t = useT();
  const [target, setTarget] = useState<string | null>(null);
  const [check, setCheck] = useState<DataDirCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const pick = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const picked = await api.pickFolder(current || undefined);
      if (!picked.path) return; // cancelled: nothing changes and nothing is reported
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
          <DialogTitle>{t("set.storage.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("set.storage.dialogDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="move-dlg">
{/* 云同步那条**排在最前、用警示样式**（TD-051，owner 2026-09-07）。
              位置与样式都是有意的：拦截只认得出常见的那几家（OneDrive、坚果云、
              Dropbox…），而挂成虚拟盘符的那些认不出来 —— **认不出来的拦不住**。
              所以第一位的是提醒，拦截是补网，不是反过来。
              放在「选择目录…」之前：选完再拒也拦得住，但那时用户已经打开过文件
              选择框、挑了一个他觉得很合理的位置。 */}
          <p className="set-callout set-callout--warning">
            <Icon name="warning" size="sm" />
            <span>
              {t("set.storage.cloudWarning")}
            </span>
          </p>

          <FactRow label={t("set.storage.current")} value={current} mono />
          <FactRow
            label={t("set.storage.moveTo")}
            value={target ?? undefined}
            mono
            action={
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void pick()}>
                {t(target ? "set.storage.pickAgain" : "set.storage.pick")}
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
              {t("set.storage.sizeToMove", { mb })}
              {check.sameVolume
                ? t("set.storage.sameDrive")
                : t("set.storage.crossDrive")}
                {t("set.storage.cacheNotMoved")}
            </p>
          )}
          <p className="set-note">
            {/* 这是渲染出去的正文，不是注释 —— JSX 不解析 Markdown 的星号，
                写 ** 用户就会看见两个星号。要加重用 <strong>。 */}
            {t("set.storage.restartNote")}
          </p>
          {failed && <p className="set-note">{failed}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {t("set.cancel")}
          </Button>
          <Button size="sm" disabled={busy || !check?.ok} onClick={() => void go()}>
            {t("set.storage.restartConfirm")}
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
  const t = useT();
  return (
    <div className="card">
      <EmptyState
        icon="table"
        title={t("set.db.title")}
        description={t("set.db.desc")}
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
 * 软件更新：三件事三个板块（owner 2026-09-15 收口为三块）—— 现在装的是什么
 * （连同「去问一次」的入口一起放在这一块的标题行）、从哪个渠道问、问到了之后
 * 怎么装。
 *
 * 「检查更新」不再单独占一块：**结果不在这里显示了** —— 它现在是页面顶部那条
 * 提示（`UpdateNotice`，`SettingsView` 那一层），自动检查与手动点这里的按钮
 * 写的是同一份状态。按钮与「自动检查」勾选一起挪到「当前版本」的标题行，紧挨着
 * 它要问的正是这个事实。
 *
 * 最后一块不是客套话：**本应用不自动安装**（TD-021，owner 定不采购签名证书后
 * 的连带结果）。把「怎么装」写在这里，用户点下载之前就知道接下来要自己动手。
 *
 * 未签名提醒挪到这一块了（owner 2026-09-16，从「关于」页搬回来）：那是**判断式**
 * 的提示（签了就自己没了，读的是构建期落下的印，见 `build-info.ts`），放在这里
 * 才对得上时机——用户正要点下载的这一刻，才是这句话真正管用的地方；「关于」页
 * 只在装完、想确认版本时才会被打开，那时提醒已经晚了。全平台只留这一处。
 * `unpackaged`（从仓里直接跑）什么都不提醒：那时根本没有安装包可谈，缺失 ≠
 * 否定，同 `capabilitySurface` 的纪律。要在开发态看这一支，设
 * `RUYIN_CODE_SIGNING=unsigned`。
 */
/**
 * `win32-x64` 是给程序看的写法。用户要认出的是「我这台是 Windows、64 位」。
 * 认不出来的组合就原样显示——**编一个好听的名字比显示原值更糟**。
 */
function describePlatform(system: SystemInfo | null, t: TFn): string | undefined {
  if (!system) return undefined;
  const osKey = {
    win32: "set.update.os.win32",
    darwin: "set.update.os.darwin",
    linux: "set.update.os.linux",
  }[system.platform] as MessageKey | undefined;
  const archKey = {
    x64: "set.update.arch.x64",
    arm64: "set.update.arch.arm64",
  }[system.arch] as MessageKey | undefined;
  return t("set.update.platformValue", {
    os: osKey ? t(osKey) : system.platform,
    arch: archKey ? t(archKey) : system.arch,
  });
}

function UpdatesSection({
  system,
  updateCheck,
}: {
  system: SystemInfo | null;
  updateCheck: UpdateCheckState;
}) {
  const t = useT();
  const { autoCheck, setAutoCheck, busy, check } = updateCheck;

  return (
    <>
      <SettingsBlock
        icon="info"
        title={t("set.update.currentTitle")}
        aside={
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* 命中区在 label 上，勾选框本身够小；hover 在文字上更容易碰到。 */}
                <label className="update-auto-check">
                  <Checkbox
                    checked={autoCheck}
                    onCheckedChange={(v) => setAutoCheck(v === true)}
                    aria-label={t("set.update.autoCheck")}
                  />
                  {t("set.update.autoCheck")}
                </label>
              </TooltipTrigger>
              <TooltipContent>{t("set.update.autoCheckTip")}</TooltipContent>
            </Tooltip>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void check(true)}>
              {t(busy ? "set.update.checking" : "set.update.check")}
            </Button>
          </TooltipProvider>
        }
      >
        <FactRow label={t("set.update.runtime")} value={system?.version} mono />
        <FactRow label={t("set.update.ui")} value={UI_VERSION} mono />
        <FactRow label={t("set.update.system")} value={describePlatform(system, t)} />
        <FactRow label={t("set.update.startedAt")} value={system?.startedAt} mono />
      </SettingsBlock>

      {/* 「更新渠道」原先是独立一块，里面只有一个**停用的下拉框、一个选项**，
          外加一句解释为什么别的渠道选不了（那句话把发布现状端给了用户）。一个
          选不了的选择不是选择 —— 收成下面这一行事实。将来真有第二个渠道，再
          让它长回一个能选的控件（owner 2026-09-17：没有价值的可以删）。 */}
      <SettingsBlock
        icon="package"
        title={t("set.update.installTitle")}
        desc={t("set.update.installDesc")}
      >
        {/* 渠道来自**刚查过的那份结果**，不是写死的字面量：写死的话，将来出了
            测试版渠道，界面会一口咬定「正式版」而用户正装着测试包（TD-021）。 */}
        <FactRow label={t("set.update.channelRow")} value={channelLabel(t, updateCheck.result?.channel)} />
        <FactRow label={t("set.update.howCheck")} value={t("set.update.howCheckValue")} />
        <FactRow label={t("set.update.howDownload")} value={t("set.update.howDownloadValue")} />
        <FactRow label={t("set.update.howInstall")} value={t("set.update.howInstallValue")} />
        {system?.codeSigning === "unsigned" && (
          <p className="set-callout set-callout--warning">
            <Icon name="warning" size="sm" />
            <span>
              <strong>{t("set.update.unsignedTitle")}</strong>{" "}
              {t("set.update.unsignedBody")}
            </span>
          </p>
        )}
      </SettingsBlock>
    </>
  );
}

/* ---------------- 关于 ---------------- */

/**
 * 关于页：**两块**（owner 2026-09-16 由三块收回两块）。
 *
 * 1. `.about-main` —— 「关于」：品牌 + 条款 + 三方许可，**自动布满**剩下的高度。
 *    内容不居中，落在**黄金分割**上（上方留白 : 下方留白 = 0.382 : 0.618），
 *    所以是「中部靠上一些」。
 * 2. 「本机配置」—— 本机固件信息，**按需高度**（内容多长就多高，不参与黄金
 *    分割）。原先嵌在同一张卡里、靠一条分隔线区分（owner 2026-09-10 的版式），
 *    现在拆成自己的卡：「这是什么产品」与「Ruyin 凭什么要读我这台机器」是两个
 *    不同的问题，不该挤在一张卡里靠一条线分。
 *
 * 事实不在这一页重复：数据目录、加密链条、推理策略、审计逐条写在「通用设置」，
 * 逐条许可证在「能力平台」页上 —— 抄第二份就会有两份各自漂。
 *
 * 未签名提醒**不在这一页了**（owner 2026-09-16：挪去「软件更新」页的「安装
 * 方式」板块——那才是用户正要下载安装包、这句话真正管用的地方；「关于」页
 * 只在装完之后才会被打开，那时提醒已经晚了）。全平台只留那一处，见
 * `UpdatesSection` 的注释。
 */
/** 字节 -> GB，一位小数；没有值时不显示单位，交给 FactRow 的「—」。 */
function gb(bytes?: number): string | undefined {
  return typeof bytes === "number" && bytes > 0 ? `${(bytes / 1073741824).toFixed(1)} GB` : undefined;
}

function AboutSection({
  system,
  session,
  api,
}: {
  system: SystemInfo | null;
  session: SessionInfo | null;
  api: Api;
}) {
  const t = useT();
  // 本机固件信息：懒加载（只在关于页问一次），拿不到就如实说「不可用」而不是
  // 空着——守护进程没接这一路是正常状态（旧版本、或装配没配），不是错误。
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [hardwareUnavailable, setHardwareUnavailable] = useState(false);
  useEffect(() => {
    api
      .hardware()
      .then(setHardware)
      .catch(() => setHardwareUnavailable(true));
  }, [api]);

  // 主板与 BIOS/UEFI 同一行、空格分隔（owner 2026-09-15）：都是「这块板子是什么」
  // 这一件事的两个来源，分两行反而让人以为是两件不相关的事实。各自内部原来怎么
  // 拼就还怎么拼（主板：厂商 型号；BIOS：厂商 · 版本），只在两组之间加空格。
  const boardPart = hardware?.baseboard
    ? [hardware.baseboard.manufacturer, hardware.baseboard.model].filter(Boolean).join(" ")
    : undefined;
  const biosPart = hardware?.bios
    ? [hardware.bios.vendor, hardware.bios.version].filter(Boolean).join(" · ")
    : undefined;
  const board = hardware ? [boardPart, biosPart].filter(Boolean).join(" ") || undefined : "…";

  return (
    <div className="about-page">
      <div className="about-main">
        {/* 卡片这一层是**内容的容器**，不是装饰：这一页的身份信息落在深色底上时
            没有边界，读起来像浮在背景里（owner 2026-09-10 报的）。上一轮重构版式
            时把它弄丢了。 */}
        <div className="card about-card">
          <BrandInfoBlock system={system} session={session} />
        </div>
      </div>

      {/* 「本机配置」——独立一张卡（owner 2026-09-15 从「关于」拆出来），按需高度，
          不参与上面那张卡的黄金分割。版式改用 `SettingsBlock`（owner 2026-09-15
          第二次修正）：原来是手写的居中标题 + 居中说明，与设置页其它每一块「图标 +
          标题 + 说明，左对齐、内容缩进」的统一版式（owner 2026-09-04 定）对不上，
          单独一张卡看不出是同一套设置页。 */}
      <SettingsBlock
        icon="cpu"
        title={t("set.hw.title")}
        desc={t("set.hw.desc")}
      >
        {hardwareUnavailable ? (
          <p className="text-body-sm text-muted-foreground">
            {t("set.hw.unavailable")}
          </p>
        ) : (
          <>
            <FactRow
              label={t("set.hw.cpu")}
              value={
                hardware?.cpu
                  ? [
                      hardware.cpu.brand,
                      hardware.cpu.cores ? t("set.hw.cores", { n: hardware.cpu.cores }) : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : hardware
                    ? undefined
                    : "…"
              }
            />
            <FactRow label={t("set.hw.memory")} value={hardware ? gb(hardware.memoryTotalBytes) : "…"} />
            <FactRow label={t("set.hw.board")} value={board} />
            <FactRow
              label={t("set.hw.os")}
              value={
                hardware?.os
                  ? [
                      hardware.os.distro,
                      hardware.os.build ? `build ${hardware.os.build}` : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : hardware
                    ? undefined
                    : "…"
              }
            />
            <FactRow
              label={t("set.hw.disk")}
              value={
                hardware?.disks && hardware.disks.length > 0
                  ? hardware.disks
                      .map((d) =>
                        [d.name ?? d.vendor, gb(d.sizeBytes)].filter(Boolean).join(" · "),
                      )
                      .join("；")
                  : hardware
                    ? undefined
                    : "…"
              }
            />
            <FactRow
              label={t("set.hw.mac")}
              value={hardware?.macAddresses?.join("、") ?? (hardware ? undefined : "…")}
              mono
            />
            <FactRow
              label={t("set.hw.machineId")}
              value={hardware?.machineId ?? (hardware ? undefined : "…")}
              mono
            />
          </>
        )}
      </SettingsBlock>
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
const LAYER_KEY: Record<SkillLayer, MessageKey> = {
  bundled: "set.cap.layer.bundled",
  distributed: "set.cap.layer.distributed",
  user: "set.cap.layer.user",
  project: "set.cap.layer.project",
};
/** 供给档位：认得的给它那句话，认不得的原样显示。 */
function tierLabel(t: TFn, tier: string): string {
  const key = TIER_KEY[tier];
  return key ? t(key) : tier;
}

const TIER_KEY: Record<string, MessageKey> = {
  default: "set.cap.supply.default",
  "installed-disabled": "set.cap.supply.installedDisabled",
  "runos-registered": "set.cap.supply.runos",
};
const TOOL_STATUS: Record<
  ToolView["status"],
  { key: MessageKey; tone: "success" | "warning" | "neutral" }
> = {
  available: { key: "set.cap.state.available", tone: "success" },
  unavailable: { key: "set.cap.state.unavailable", tone: "warning" },
  /** 用户点一下就能改变的事实 —— 所以它有自己的徽标和自己的按钮，不是「不可用」。 */
  "needs-acquisition": { key: "set.cap.state.needsAcquisition", tone: "warning" },
  acquiring: { key: "set.cap.state.acquiring", tone: "neutral" },
  registered: { key: "set.cap.state.registered", tone: "neutral" },
  runos: { key: "set.cap.supply.runos", tone: "neutral" },
};
/**
 * 获取失败**各说各的**（ADR-018 §7.2）。折叠成一句「获取失败」，用户就分不清
 * 「网络到不了」（等会儿再试）与「字节和清单对不上」（这一种是要说响的）。
 */
const COMPONENT_STATE_KEY: Record<ComponentState, MessageKey> = {
  acquired: "set.cap.component.acquired",
  "not-acquired": "set.cap.component.notAcquired",
  acquiring: "set.cap.component.acquiring",
  unreachable: "set.cap.component.unreachable",
  // 「上游已经删了这个构建」不是「等会儿再试」：再点一次还是 404，要动的是清单。
  gone: "set.cap.component.gone",
  "payload-missing": "set.cap.component.payloadMissing",
  mismatch: "set.cap.component.mismatch",
  "no-space": "set.cap.component.noSpace",
  "too-large": "set.cap.component.tooLarge",
  "license-missing": "set.cap.component.licenseMissing",
  "refused-origin": "set.cap.component.refusedOrigin",
  "path-too-long": "set.cap.component.pathTooLong",
  cancelled: "set.cap.component.cancelled",
  failed: "set.cap.component.failed",
};

function mb(n: number): string {
  return `${(n / 1048576).toFixed(1)} MB`;
}

/**
 * 「工具」块顶上那句常驻事实。数的是**能不能起**，不是清单上有多少条 ——
 * 「预置 10 个」而其中 7 个在干净机器上起不来，是上一版清单犯过的错。
 */
function bundledSummary(tools: ToolView[], t: TFn): string {
  const servers = tools.filter((t) => t.kind === "mcp-server");
  const bundled = servers.filter((t) => t.launchable && !t.component);
  // `launchable` 只说「有启动规格」，不说「此刻起得来」——差一个环境变量、差一个
  // 外部程序的也在里面。把它们算进「不下载就能起」，就是上一版「预置 10 个」那个
  // 错的小一号版本：数字对不上用户点下去看到的东西。
  const blocked = bundled.filter((t) => t.status !== "available" && t.status !== "registered").length;
  const needs = servers.filter((t) => t.component && t.component.state !== "acquired").length;
  return (
    t("set.cap.bundledSummary", { n: bundled.length }) +
    (blocked > 0 ? t("set.cap.bundledBlocked", { n: blocked }) : "") +
    (needs > 0 ? t("set.cap.bundledNeeds", { n: needs }) : t("set.cap.bundledEnd"))
  );
}
/** 三档路由的名字，按语言给（守护进程只给 `mode`）。 */
const ROUTE_MODE_KEY: Record<CapabilityRouting["current"]["mode"], MessageKey> = {
  local_only: "set.cap.route.localOnly",
  prefer_local: "set.cap.route.preferLocal",
  prefer_cloud: "set.cap.route.preferCloud",
};

/**
 * 一行工具旁边那半句话：守护进程给码，界面说话（2026-09-17）。
 *
 * 原来那半句是守护进程拼好的中文，而且会漏出预置清单里**我们自己的工程笔记**
 * （带日期的降档决策、闭包体积、「归属未核实」）。见 `tool-registry.ts` 的
 * `ToolDetailCode`。
 */
const TOOL_DETAIL_KEY: Record<string, MessageKey> = {
  "no-search-index": "set.tools.detail.noSearchIndex",
  "not-implemented": "set.tools.detail.notImplemented",
  "no-skill-registry": "set.tools.detail.noSkillRegistry",
  "connector-stashed": "set.tools.detail.connectorStashed",
  "connector-stopped": "set.tools.detail.connectorStopped",
  "via-runos": "set.tools.detail.viaRunos",
  "no-launch-spec": "set.tools.detail.noLaunchSpec",
  running: "set.tools.detail.running",
  launchable: "set.tools.detail.launchable",
  "not-enabled": "set.tools.detail.notEnabled",
  "needs-env": "set.tools.detail.needsEnv",
  "needs-python": "set.tools.detail.needsPython",
  blocked: "set.tools.detail.blocked",
};

/** 正在做哪一步（守护进程只给码）。 */
const PYTHON_STEP_KEY: Record<PythonStepCode, MessageKey> = {
  "acquire-uv": "set.python.step.acquireUv",
  "install-python": "set.python.step.installPython",
  "warm-cache": "set.python.step.warmCache",
  "verify-offline": "set.python.step.verifyOffline",
};

/**
 * 没装成是因为什么。**「没下载成功」与「试跑没通过」不能是同一句话** —— 前者
 * 再点一次多半就好了，后者再点一百次也是同一个结果。守护进程那句原文（uv 自己
 * 说的话）一个字都不上屏。
 */
/** 徽章上那两三个字。 */
const PYTHON_STATE_KEY: Record<PythonRuntimeState, MessageKey> = {
  "not-acquired": "set.python.badge.notInstalled",
  "not-provisioned": "set.python.badge.partial",
  stale: "set.python.badge.stale",
  provisioning: "set.python.badge.installing",
  ready: "set.python.badge.ready",
  failed: "set.python.badge.failed",
};

const PYTHON_TONE: Record<PythonRuntimeState, "success" | "warning" | "danger" | "neutral"> = {
  "not-acquired": "neutral",
  "not-provisioned": "warning",
  stale: "warning",
  provisioning: "neutral",
  ready: "success",
  failed: "danger",
};

/** 按钮上那两个字。**「安装」与「重新安装」不是同一句话** —— 装过的人要知道他没记错。 */
const PYTHON_ACTION_KEY: Record<PythonRuntimeState, MessageKey> = {
  "not-acquired": "set.python.install",
  "not-provisioned": "set.python.resume",
  stale: "set.python.reinstall",
  provisioning: "set.python.install",
  ready: "set.python.reinstall",
  failed: "set.python.retry",
};

const PYTHON_FAIL_KEY: Record<PythonFailureCode, MessageKey> = {
  "no-config": "set.python.fail.noConfig",
  "uv-missing": "set.python.fail.download",
  "acquire-failed": "set.python.fail.download",
  "install-python-failed": "set.python.fail.installPython",
  "warm-failed": "set.python.fail.warm",
  "verify-failed": "set.python.fail.verify",
  cancelled: "set.python.fail.cancelled",
};

/**
 * Python 那一行说什么。每种状态各说各的 —— 装好了报版本，没装报要下多少，
 * 装到一半报卡在哪，没装成报是哪一种没装成（**不是守护进程那句原文**）。
 */
function pythonLine(t: TFn, python: PythonRuntimeStatus): string {
  if (python.state === "provisioning") return t(PYTHON_STEP_KEY[python.stepCode ?? "acquire-uv"]);
  if (python.state === "failed") return t(PYTHON_FAIL_KEY[python.code ?? "acquire-failed"]);
  if (python.state === "ready") {
    return `${t("set.python.ready", { uv: python.uvVersion ?? "", python: python.pythonVersion ?? "" })} · ${t(
      "set.python.readyPackages",
      { count: python.packages.length },
    )}`;
  }
  if (python.state === "not-provisioned") return t("set.python.notProvisioned");
  if (python.state === "stale") return t("set.python.stale");
  const p = python.payload;
  // 载荷读不出来（这一版清单里没有它）时不编一个体积：**宁可少说一句**。
  if (!p) return t("set.python.badge.notInstalled");
  return t("set.python.notAcquired", {
    download: mb(p.downloadBytes),
    disk: mb(p.diskBytes),
    license: p.license,
    origin: p.origin,
  });
}

/** 那半句话：认得的码按语言说，没有码就不说 —— **不拿守护进程的原话凑一句**。 */
function toolDetail(t: TFn, tool: ToolView): string | undefined {
  if (!tool.detailCode) return undefined;
  const key = TOOL_DETAIL_KEY[tool.detailCode];
  return key ? t(key, tool.detailVars ?? {}) : undefined;
}

const TOOL_KIND_KEY: Record<ToolView["kind"], MessageKey> = {
  builtin: "set.cap.kind.builtin",
  connector: "set.cap.kind.connector",
  "mcp-server": "set.cap.kind.mcpServer",
};

/**
 * 板块标题行里的紧凑筛选（owner 2026-09-15）：原先技能板块内容区里那个全宽的
 * `<select>` 太长，改成一个小按钮 + 下拉，挪到标题行、贴着刷新按钮、右对齐。
 * 工具板块与云端能力清单的筛选同一个组件，只是各自的维度不同。
 *
 * 单选（不是多选复选框）：三处筛选各自只有一个维度，谁选中了在按钮上直接看得
 * 见，不需要「多选之后拼一句摘要」那一层。
 */
function FilterMenu<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  const current = options.find((o) => o.value === value)?.label ?? ariaLabel;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="cap-filter-trigger" aria-label={ariaLabel}>
          {current}
          <Icon name="caret-up-down" size="xs" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => onChange(o.value)}>
            {o.value === value && <Icon name="check" size="xs" />}
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 筛选项带的是**目录键**，词在渲染时按语言取（下面三组同理）。 */
const LAYER_FILTER_OPTIONS: Array<{ value: "all" | SkillLayer; labelKey: MessageKey }> = [
  { value: "all", labelKey: "set.cap.filter.allSources" },
  { value: "bundled", labelKey: LAYER_KEY.bundled },
  { value: "distributed", labelKey: LAYER_KEY.distributed },
  { value: "user", labelKey: LAYER_KEY.user },
  { value: "project", labelKey: LAYER_KEY.project },
];

type ToolKindFilter = "all" | ToolView["kind"];
const TOOL_KIND_FILTER_OPTIONS: Array<{ value: ToolKindFilter; labelKey: MessageKey }> = [
  { value: "all", labelKey: "set.cap.filter.allKinds" },
  { value: "builtin", labelKey: TOOL_KIND_KEY.builtin },
  { value: "connector", labelKey: TOOL_KIND_KEY.connector },
  { value: "mcp-server", labelKey: TOOL_KIND_KEY["mcp-server"] },
];

/**
 * Runos 清单（ADR-020 §6.2，RY-204）的筛选。资产（asset）Runos 目前登记即拒，不给它
 * 一个永远是空的按钮。
 */
type CatalogFilter = "all" | "skill" | "connector" | "executor";
const CATALOG_FILTERS: { value: CatalogFilter; labelKey: MessageKey }[] = [
  { value: "all", labelKey: "set.cap.filter.all" },
  { value: "skill", labelKey: "set.cap.filter.skill" },
  { value: "connector", labelKey: "set.cap.filter.connector" },
  { value: "executor", labelKey: "set.cap.filter.executor" },
];

function catalogTime(iso: string | undefined, locale: Locale): string {
  // 时间的写法**跟着语言走**：中文是 2026/9/17 19:40:00，英文是 9/17/2026, 19:40:00。
  return iso ? new Date(iso).toLocaleString(locale, { hour12: false }) : "—";
}

/** 四种状态各说各的（RY-204 §状态）：拿不到就说拿不到，旧的就说是旧的。 */
function catalogStateLine(source: CatalogSourceStatus, t: TFn, locale: Locale): string {
  switch (source.state) {
    case "unavailable":
      // 守护进程的原因本来就是这半句（带着 issue 号）：拼成一句说，不再在下面重复一遍
      // （owner 2026-09-15 真机看到两遍，RY-001 #23）。
      return t("set.cap.catalog.noEndpoint", {
        reason: source.reason ?? t("set.cap.catalog.noEndpointDefault"),
      });
    case "never":
      return t("set.cap.catalog.neverFetched");
    case "synced":
      return t("set.cap.catalog.fresh", {
        total: source.total ?? 0,
        at: catalogTime(source.fetchedAt, locale),
      });
    case "stale":
      return t("set.cap.catalog.stale", { at: catalogTime(source.fetchedAt, locale) });
  }
}

function catalogDiffLine(source: CatalogSourceStatus, t: TFn): string | null {
  const d = source.diff;
  if (source.state !== "synced" || !d || d.added + d.removed + d.changed === 0) return null;
  return t("set.cap.catalog.diff", {
    added: d.added,
    removed: d.removed,
    changed: d.changed,
  });
}

/** D4：只按守护进程核对出来的事实标；技能没有就是「本机无」，其余在 Runos 远端跑。 */
function catalogLocalLabel(item: CatalogItem, t: TFn): string {
  if (item.local.runnable) return t("set.cap.local.runnable");
  return t(item.primitiveType === "skill" ? "set.cap.local.none" : "set.cap.local.cloudOnly");
}

function SkillsSection({ api }: { api: Api }) {
  const t = useT();
  const locale = useLocale();
  const [listing, setListing] = useState<SkillListing | null>(null);
  const [tools, setTools] = useState<ToolView[] | null>(null);
  // Python 半边（TD-042 ②）：null = 这一版不带它，整块不显示。
  const [python, setPython] = useState<PythonRuntimeStatus | null>(null);
  /** 能力调用路径（ADR-025）。null = 没问到 —— 那时不显示那一行，不猜一个档位。 */
  const [routing, setRouting] = useState<CapabilityRouting | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [layer, setLayer] = useState<"all" | SkillLayer>("all");
  const [toolKind, setToolKind] = useState<ToolKindFilter>("all");
  /** Runos 清单。null = 这套装配没有清单（503）或读不到 —— 那时整块不显示，不猜。 */
  const [catalog, setCatalog] = useState<CapabilityCatalogPage | null>(null);
  const [catalogType, setCatalogType] = useState<CatalogFilter>("all");
  const [catalogQ, setCatalogQ] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogFailed, setCatalogFailed] = useState<string | null>(null);

  const loadCatalog = async (more = false) => {
    const cursor = more ? catalog?.nextCursor : undefined;
    try {
      const page = await api.capabilityCatalog({
        ...(catalogType === "all" ? {} : { type: catalogType }),
        ...(catalogQ.trim() ? { q: catalogQ.trim() } : {}),
        ...(cursor ? { cursor } : {}),
      });
      setCatalog((prev) => (more && prev ? { ...page, items: [...prev.items, ...page.items] } : page));
    } catch (e) {
      // 翻页失败：已经列出来的留着，说一句；首次就读不到：整块不显示。
      if (more) setCatalogFailed(String((e as Error).message));
      else setCatalog(null);
    }
  };
  useEffect(() => {
    void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, catalogType, catalogQ]);

  const refreshCatalog = async () => {
    setCatalogBusy(true);
    setCatalogFailed(null);
    let message: string | null = null;
    try {
      await api.refreshCapabilityCatalog("manual");
    } catch (e) {
      message = String((e as Error).message);
    }
    await loadCatalog();
    setCatalogBusy(false);
    // 重读之后再放这句话，同 acquire 那一处：先设会被重读抹掉。
    if (message) setCatalogFailed(message);
  };

  const reload = async () => {
    try {
      setListing(await api.skills());
      setUnavailable(null);
      setFailed(null);
    } catch (e) {
      // 503 = 这套装配没有技能登记册。这是一个事实，不是错误，单独说。
      if (e instanceof ApiError && e.status === 503) {
        setListing({ items: [], layers: [], scannedAt: "" });
        setUnavailable(describeError(t, e));
      } else {
        setFailed(String((e as Error).message));
      }
    }
    try {
      setTools((await api.tools()).items);
    } catch {
      setTools([]);
    }
    try {
      setRouting(await api.capabilityRouting());
    } catch {
      setRouting(null);
    }
    await reloadPython();
  };
  /** Python 半边此刻的样子。503 = 这一版不带它 —— 那就整块不显示。 */
  const reloadPython = async () => {
    try {
      setPython(await api.pythonRuntime());
    } catch {
      setPython(null);
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
  const layerSummary = (listing?.layers ?? [])
    .map((l) => `${t(LAYER_KEY[l.layer])} ${l.count}`)
    .join(" · ");
  const toolItems = (tools ?? []).filter((t) => toolKind === "all" || t.kind === toolKind);
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
  /**
   * 获取一件载荷。**只有这里会下载** —— 启动时不下、刷新时不下、任务要用某个工具
   * 时也不下（模型的一次工具调用永远不能触发下载，ADR-018 §7.2）。
   *
   * `from` 是气隙机器那条路：管理员把离线包里的 zip 指给它，校验和还是随安装包
   * 同行的那一条。
   */
  const [acquiring, setAcquiring] = useState<string | null>(null);
  const acquire = async (componentId: string, from?: string) => {
    setFailed(null);
    setAcquiring(componentId);
    let message: string | null = null;
    try {
      await api.acquireComponent(componentId, from);
    } catch (e) {
      message = String((e as Error).message);
    }
    setAcquiring(null);
    await reload();
    // **在 reload 之后再放这句话。** reload 成功时会清掉 failed（那是「这一次列表拉
    // 到了」的一部分），先设就会被它抹掉 —— 一次失败的获取于是变得无声无息，而
    // 「悄悄没成功」正是这条通道最不该有的失败方式。
    if (message) setFailed(message);
  };
  const cancelAcquire = async (componentId: string) => {
    let message: string | null = null;
    try {
      await api.cancelComponent(componentId);
    } catch (e) {
      message = String((e as Error).message);
    }
    await reload();
    if (message) setFailed(message);
  };
  /** 从本地文件 / 目录导入：壳弹系统目录框，界面只把路径转给守护进程。 */
  const importFromDisk = async (componentId: string) => {
    const picked = await api.pickFolder();
    if (!picked.path) return;
    await acquire(componentId, picked.path);
  };
  /**
   * 装 Python 半边。守护进程那一头**不等它装完就回**（要几分钟），所以这里也不等：
   * 点完就重问一次，之后靠下面那个轮询跟着走。
   */
  const provisionPython = async () => {
    setFailed(null);
    let message: string | null = null;
    try {
      setPython(await api.provisionPython());
    } catch (e) {
      message = String((e as Error).message);
    }
    if (message) setFailed(message);
  };
  const cancelPython = async () => {
    try {
      await api.cancelPython();
    } catch {
      // 取消本来就可能已经晚了一步；下一次轮询会说出它真正的样子。
    }
    await reloadPython();
  };
  const removePython = async () => {
    let message: string | null = null;
    try {
      await api.removePython();
    } catch (e) {
      message = String((e as Error).message);
    }
    await reloadPython();
    await reload();
    // **在 reload 之后再放这句话**（同 acquire 那一处）：reload 成功会清掉 failed，
    // 先设就会被它抹掉 —— 一次失败的移除于是变得无声无息。
    if (message) setFailed(message);
  };
  /**
   * 装的时候**盯着它**：这一块的进度不走事件（守护进程只发「有东西变了」，而这里
   * 变的是步骤名），所以装的过程中每两秒问一次。装完就停 —— 一个永远在轮询的
   * 设置页，在用不到 Python 的机器上是纯粹的浪费。
   */
  useEffect(() => {
    if (python?.state !== "provisioning") return;
    const timer = setInterval(() => void reloadPython(), 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [python?.state]);

  const skillGroups = groupCapabilities(items, (s) => ({ name: s.name, description: s.description }));
  // 分组看的是关键词，而那半句话现在是按语言给的 —— 用它分组会让**分组随语言
  // 漂**。只按 id 分（关键词表本来就是按 id 与工具名建的）。
  const toolGroups = groupCapabilities(toolItems, (tool) => ({ id: tool.id, name: tool.id }));

  return (
    <>
      {/*
        这一屏顶上的一句事实。原来两行讲的是「本机这份能力不是本机自己攒的，它与
        云端两处同出一份登记册；这里显示的是本机此刻真正装着的那一份」——话没错，
        但绕（owner 2026-09-15：啰嗦晦涩，改成一句）。收成一句后就不再逐字断言
        「同一份登记册」这个精确说法了；不写「实时同步」的顾虑仍然成立（下面这句
        「同步」指的是能力供给的来源，不是「此刻逐条相同」），所以只说到「同步」
        为止，不展开成「登记册」那层技术说法。

        调用路径（ADR-025）原来单独占一整句，owner 2026-09-15 再收：两条信息挤成
        一条，路径信息收成标签贴在句尾 —— 图标改用第二条的盾牌（这一屏在说「谁
        在把关」，盾牌比云朵更贴）。叫 Runos 好理解，但本机跑的不是云端 Runos
        服务：名字出现的地方，说明必须一起出现（同一条 owner 决定），所以标签
        文字仍是「Runos（兼容 Runos 协议的本地能力面）」整段，不拆开。 */}
      <p className="cap-sync">
        <Icon name="shield-check" size="sm" aria-hidden />
        <span>
          {t("set.cap.syncLine")}
        </span>
        {routing && (
          <span className="cap-sync-tags">
            <StatusBadge tone="neutral">{t(ROUTE_MODE_KEY[routing.current.mode])}</StatusBadge>
            {/* 名字是专名，说明按语言给 —— 两者必须同时出现（owner 2026-09-15）。 */}
            <StatusBadge tone="neutral">
              {t("set.cap.planeTag", { name: routing.name, note: t("set.cap.planeNote") })}
            </StatusBadge>
            {!routing.cloudOpen && (
              <StatusBadge tone="warning">{t("set.cap.cloudClosed")}</StatusBadge>
            )}
          </span>
        )}
      </p>
      <SettingsBlock
        icon="sparkles"
        collapsible
        count={items.length}
        title={t("set.skills.title")}
        desc={t("set.skills.desc")}
        aside={
          unavailable ? undefined : (
            // 筛选紧挨着刷新按钮、一起右对齐（owner 2026-09-15）：原来这个筛选是
            // 内容区里一个全宽的 <select>，挪到标题行、压缩到按钮宽度。
            <>
              <FilterMenu
                ariaLabel={t("set.skills.filterAria")}
                options={LAYER_FILTER_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                value={layer}
                onChange={setLayer}
              />
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>
                {t(busy ? "set.refreshing" : "set.refresh")}
              </Button>
            </>
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
            <p className="set-note">{layerSummary || t("set.skills.none")}</p>
            {items.length === 0 ? (
              <p className="set-note">
                {listing.items.length === 0
                  ? t("set.skills.emptyAll")
                  : t("set.skills.emptyLayer")}
              </p>
            ) : (
              <Accordion type="multiple" className="cap-groups">
                {skillGroups.map(({ group, items: rows }) => (
                  <AccordionItem key={group.id} value={group.id} className="cap-group">
                    <AccordionTrigger className="cap-group-head">
                      <span className="cap-group-label">{group.label}</span>
                      <span className="cap-group-count">{rows.length}</span>
                      <span className="cap-group-desc">{group.desc}</span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="row-list" aria-label={t("set.skills.groupAria", { group: group.label })}>
                {rows.map((s) => (
                  <li key={`${s.layer}:${s.source}:${s.name}`} className="row-item">
                    <code className="row-main" title={`${s.dir}\n${s.description}`}>
                      {s.name}
                    </code>
                    <span className="row-tag">{t(LAYER_KEY[s.layer])}</span>
                    <span className="text-body-sm text-muted-foreground">
                      {s.source}
                      {s.version ? ` · v${s.version}` : ""}
                      {s.license ? ` · ${s.license}` : ""}
                      {s.tier ? ` · ${tierLabel(t, s.tier)}` : ""}
                    </span>
                    {/* 脚本本地不跑（TD-005）：标出来，而不是悄悄跳过。 */}
                    {s.hasScripts && <StatusBadge tone="neutral">{t("set.skills.hasScripts")}</StatusBadge>}
                    {s.shadowedBy ? (
                      <StatusBadge tone="neutral">
                        {t("set.skills.shadowed", { layer: t(LAYER_KEY[s.shadowedBy]) })}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone={s.enabled ? "success" : "neutral"}>
                        {t(s.enabled ? "set.skills.enabled" : "set.skills.disabled")}
                      </StatusBadge>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => void toggle(s)}>
                      {t(s.enabled ? "set.skills.disabled" : "set.skills.enabled")}
                    </Button>
                  </li>
                ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </>
        )}
      </SettingsBlock>
      <SettingsBlock
        icon="plugs-connected"
        collapsible
        count={tools?.length ?? 0}
        title={t("set.tools.title")}
        desc={t("set.tools.desc")}
        aside={
          tools && tools.length > 0 ? (
            <FilterMenu
              ariaLabel={t("set.tools.filterAria")}
              options={TOOL_KIND_FILTER_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              value={toolKind}
              onChange={setToolKind}
            />
          ) : undefined
        }
      >
        {tools === null ? (
          <p className="set-note">…</p>
        ) : tools.length === 0 ? (
          <p className="set-note">{t("set.tools.none")}</p>
        ) : (
          <>
            {/* 常驻的一句事实：随包的与要获取的各多少（按登记册全量算，不随筛选变——
                这是「这台机器总共有多少」，不是「筛出来看见几个」）。用户不必点开
                每一行去数。 */}
            <p className="set-note">{bundledSummary(tools, t)}</p>
            {toolItems.length === 0 && <p className="set-note">{t("set.tools.emptyKind")}</p>}
            <Accordion type="multiple" className="cap-groups">
              {toolGroups.map(({ group, items: rows }) => (
                <AccordionItem key={group.id} value={group.id} className="cap-group">
                  <AccordionTrigger className="cap-group-head">
                    <span className="cap-group-label">{group.label}</span>
                    <span className="cap-group-count">{rows.length}</span>
                    <span className="cap-group-desc">{group.desc}</span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="row-list" aria-label={t("set.tools.groupAria", { group: group.label })}>
              {rows.map((tool) => (
                <li key={`${tool.kind}:${tool.id}`} className="row-item">
                  <code className="row-main" title={toolDetail(t, tool) ?? ""}>
                    {tool.id}
                  </code>
                  <span className="row-tag">{t(TOOL_KIND_KEY[tool.kind])}</span>
                  {(tool.license || tool.tier) && (
                    <span className="text-body-sm text-muted-foreground">
                      {[tool.license, tool.tier ? tierLabel(t, tool.tier) : undefined]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  {/* 工具名来自构建时探过的那一次：**停着的、还没获取的行也显示** ——
                      用户在下载之前就看得见这台机器将要多出哪些工具（TD-034）。 */}
                  {tool.tools && tool.tools.length > 0 && (
                    <span className="text-body-sm text-muted-foreground mono">{t("set.tools.toolList", { list: tool.tools.join(t("common.listSep")) })}</span>
                  )}
                  {!tool.tools && tool.toolsUnprobed && (
                    <span className="text-body-sm text-muted-foreground">{t("set.tools.unprobed", { reason: tool.toolsUnprobed })}</span>
                  )}
                  {/* 有载荷那一行时不再重复 detail：守护进程那句话里已经带了同样的
                      体积，两处并排显示同一个数字会让人以为是两笔下载。 */}
                  {tool.launchable && tool.status !== "available" && toolDetail(t, tool) && !tool.component && (
                    <span className="text-body-sm text-muted-foreground">{toolDetail(t, tool)}</span>
                  )}
                  {/* 体积、许可证、来源主机都在按钮**左边** —— 点之前就看得见要下多少。
                      地址不在这里：它只在守护进程手上，从随包清单读出来。 */}
                  {tool.component && (
                    <span className="text-body-sm text-muted-foreground">
                      {tool.component.state === "acquiring"
                        ? `${mb(tool.component.receivedBytes ?? 0)} / ${mb(tool.component.totalBytes ?? tool.component.downloadBytes)}`
                        : t("set.tools.componentLine", {
                            state: t(COMPONENT_STATE_KEY[tool.component.state]),
                            download: mb(tool.component.downloadBytes),
                            disk: mb(tool.component.diskBytes),
                            license: tool.component.license,
                            origin: tool.component.origin,
                          })}
                      {tool.component.reason ? ` —— ${tool.component.reason}` : ""}
                    </span>
                  )}
                  <StatusBadge tone={TOOL_STATUS[tool.status].tone}>
                    {t(TOOL_STATUS[tool.status].key)}
                  </StatusBadge>
                  {tool.component && tool.component.state === "acquiring" ? (
                    <Button variant="ghost" size="sm" onClick={() => void cancelAcquire(tool.component!.id)}>
                      {t("set.cancel")}
                    </Button>
                  ) : tool.component ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={acquiring === tool.component.id}
                        onClick={() => void acquire(tool.component!.id)}
                      >
                        {t(acquiring === tool.component.id ? "set.tools.acquiring" : "set.tools.acquire")}
                      </Button>
                      {/* 气隙机器点不动上面那个按钮，但管理员可以把离线包指给它。 */}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={acquiring === tool.component.id}
                        onClick={() => void importFromDisk(tool.component!.id)}
                      >
                        {t("set.tools.importLocal")}
                      </Button>
                    </>
                  ) : null}
                  {tool.launchable && !tool.component && (
                    <Button
                      variant={tool.status === "available" ? "ghost" : "outline"}
                      size="sm"
                      disabled={starting === tool.id}
                      onClick={() => void launch(tool, tool.status !== "available")}
                    >
                      {starting === tool.id
                        ? t("set.tools.starting")
                        : t(tool.status === "available" ? "set.tools.stop" : "set.tools.start")}
                    </Button>
                  )}
                </li>
              ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </>
        )}
      </SettingsBlock>
      {/*
        Python 运行环境（TD-042 ②）：uv 与 CPython **不随安装包**（owner 2026-09-17
        定性「安装包小一些，租户按照需求，安装必要环境」）。

        为什么它自己一块、而不是挂在用到它的那两行工具旁边：那是**一次安装**，
        不是两次。挂在工具行上，同一件事会在几行里各摆一个按钮，读起来像几笔
        各自独立的下载 —— 与载荷单列而不挂在服务器上是同一条理由。
      */}
      {python && python.component && (
        <SettingsBlock icon="terminal" title={t("set.python.title")} desc={t("set.python.desc")}>
          <div className="row-line">
            {/* 体积、许可证、来源主机都在按钮**左边** —— 点之前就看得见要下多少。 */}
            <span className="text-body-sm text-muted-foreground">{pythonLine(t, python)}</span>
            <StatusBadge tone={PYTHON_TONE[python.state]}>{t(PYTHON_STATE_KEY[python.state])}</StatusBadge>
            {python.state === "provisioning" ? (
              <Button variant="ghost" size="sm" onClick={() => void cancelPython()}>
                {t("set.cancel")}
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => void provisionPython()}>
                  {t(PYTHON_ACTION_KEY[python.state])}
                </Button>
                {(python.state === "ready" || python.state === "stale") && (
                  <Button variant="ghost" size="sm" onClick={() => void removePython()}>
                    {t("set.python.remove")}
                  </Button>
                )}
              </>
            )}
          </div>
          {/* 安装会再取 Python 本身与依赖：**按流量计费的网络上这句话是有用的**。 */}
          {python.state !== "ready" && python.state !== "provisioning" && (
            <p className="set-note">{t("set.python.alsoFetches")}</p>
          )}
        </SettingsBlock>
      )}
      {catalog && (
        /* Runos 清单（ADR-020 §6.2，RY-204 D2）：平台目录的投影，与上面「本机装着的」
           两块不是一回事 —— 所以它自己一块，且第一句话就说它不是安装。 */
        <SettingsBlock
          icon="cloud"
          collapsible
          {...(catalog.source.total === undefined ? {} : { count: catalog.source.total })}
          title={t("set.catalog.title")}
          desc={t("set.catalog.desc")}
          aside={
            <>
              {/* 筛选与工具板块同一个组件（owner 2026-09-15：「多维度筛选下拉」）。
                  一条都没有时不给一个永远筛不出东西的按钮。 */}
              {(catalog.source.total ?? 0) > 0 && (
                <FilterMenu
                  ariaLabel={t("set.catalog.filterAria")}
                  options={CATALOG_FILTERS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                  value={catalogType}
                  onChange={setCatalogType}
                />
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={catalogBusy || catalog.source.state === "unavailable"}
                onClick={() => void refreshCatalog()}
              >
                {t(catalogBusy ? "set.refreshing" : "set.refresh")}
              </Button>
            </>
          }
        >
          {catalogFailed && <div className="update-line update-line--warn">{catalogFailed}</div>}
          <p className="set-note">{catalogStateLine(catalog.source, t, locale)}</p>
          {(catalog.source.state === "never" || catalog.source.state === "stale") && catalog.source.reason && (
            <p className="set-note text-muted-foreground">{catalog.source.reason}</p>
          )}
          {catalogDiffLine(catalog.source, t) && (
            <p className="set-note">{catalogDiffLine(catalog.source, t)}</p>
          )}
          {(catalog.source.total ?? 0) > 0 && (
            <>
              <div className="row-item">
                <Input
                  id="catalog-search"
                  aria-label={t("set.catalog.searchAria")}
                  value={catalogQ}
                  onChange={(e) => setCatalogQ(e.target.value)}
                  placeholder={t("set.catalog.searchPlaceholder")}
                />
              </div>
              {catalog.items.length === 0 ? (
                <p className="set-note">{t("set.catalog.noMatch")}</p>
              ) : (
                <ul className="row-list" aria-label={t("set.catalog.listAria")}>
                  {catalog.items.map((c) => (
                    <li key={c.capabilityId} className="row-item">
                      <span className="row-main" title={c.summary}>
                        {c.displayName?.["zh-CN"] ?? c.title}
                      </span>
                      <code className="text-body-sm text-muted-foreground">{c.capabilityId}</code>
                      {c.category && <span className="row-tag">{c.category}</span>}
                      <StatusBadge tone={c.local.runnable ? "success" : "neutral"}>{catalogLocalLabel(c, t)}</StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
              {catalog.nextCursor && (
                <Button variant="ghost" size="sm" onClick={() => void loadCatalog(true)}>
                  {t("set.catalog.more")}
                </Button>
              )}
            </>
          )}
        </SettingsBlock>
      )}
    </>
  );
}

/**
 * 模型平台（owner 2026-09-15，RY-001 #24）—— **只展示**本工作区在 Atlas 上被授权的模型。
 *
 * 不调用、不配置：模型由各智能体直接对接 Atlas（ADR-026 §2 第 3 条）；用量与配额在平台
 * 看（owner：不用复杂化）。每种处境只说一句 —— 平台拒绝时守护进程给的那句已经说清谁能看，
 * 就用它，不在下面再重复一遍（#23 的教训）。
 */
/**
 * 说不了话的那几档带的是**目录键**，不是句子 —— 句子在渲染时按语言取。
 * 只有 403 例外：那一句是守护进程点名了哪个权限码，原话比我们能写的任何一句
 * 都具体（它告诉用户去平台要哪个权限）。
 */
type ModelsState =
  | { kind: "loading" }
  | { kind: "ready"; models: AtlasModel[] }
  | { kind: "message"; text: string }
  | { kind: "message"; key: MessageKey }
  | { kind: "failed"; key: MessageKey; reason: string };

function modelsStateOf(e: unknown): ModelsState {
  if (e instanceof ApiError) {
    if (e.status === 403) return { kind: "message", text: e.message };
    if (e.status === 401) return { kind: "message", key: "set.models.needSignIn" };
    // 没接平台的装配：会话没配（503），或整组路由都不在（404）—— 对用户是同一件事。
    if (e.status === 404 || e.status === 503) return { kind: "message", key: "set.models.noPlatform" };
  }
  return { kind: "failed", key: "set.models.failed", reason: (e as Error).message };
}

function ModelsSection({ api, system }: { api: Api; system: SystemInfo | null }) {
  const t = useT();
  const [state, setState] = useState<ModelsState>({ kind: "loading" });
  const load = async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", models: await api.atlasModels() });
    } catch (e) {
      setState(modelsStateOf(e));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  return (
    <>
    <SettingsBlock
      icon="cpu"
      title={t("set.models.title")}
      // 一句话说完（owner 2026-09-15：原句太长，标题行放不下会回行）。「本机不配置、
      // 不调用模型」这句边界不丢——挪到下面正文里单独一行，不挤在标题行的说明里。
      desc={t("set.models.desc")}
      {...(state.kind === "ready" ? { count: state.models.length } : {})}
    >
      <p className="set-note text-muted-foreground">{t("set.models.quotaNote")}</p>
      {state.kind === "loading" && <p className="set-note">{t("set.models.loading")}</p>}
      {state.kind === "message" && (
        <p className="set-note">{"key" in state ? t(state.key) : state.text}</p>
      )}
      {state.kind === "failed" && (
        <div className="update-line update-line--warn">
          <span>{t(state.key, { reason: state.reason })}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("set.retry")}
          </Button>
        </div>
      )}
      {state.kind === "ready" &&
        (state.models.length === 0 ? (
          <p className="set-note">{t("set.models.empty")}</p>
        ) : (
          <ul className="row-list" aria-label={t("set.models.listAria")}>
            {state.models.map((m) => (
              <li key={m.modelCode} className="row-item">
                <span className="row-main">{m.modelName}</span>
                <code className="text-body-sm text-muted-foreground">{m.modelCode}</code>
                <span className="row-tag">{m.provider}</span>
                {m.capabilities.map((c) => (
                  <Badge key={c} variant="secondary">
                    {c}
                  </Badge>
                ))}
                <StatusBadge tone={m.isActive ? "success" : "neutral"}>
                  {t(m.isActive ? "set.models.on" : "set.models.off")}
                </StatusBadge>
              </li>
            ))}
          </ul>
        ))}
    </SettingsBlock>
    <PrivateModelBlock api={api} system={system} />
    </>
  );
}

/**
 * 私有模型服务（RY-100 A15 / A16 / A18，RY-001 §07 #41）。
 *
 * 这一页的第二块。与上面那块的**权威不同，界面要说出来**：
 *
 *   平台模型服务   权威在平台（工作区在 Atlas 上被授权哪些模型）。
 *                  **只展示，永远没有配置入口。**
 *   私有模型服务   **开通**的权威在控制面（A18，企业版 / 私有化特性）；
 *                  **地址与模型名是本机事实**，可以配。
 *
 * 「开通」与「配置」是两件事，不能混成一个开关 —— 三态各说各的话：
 *
 *   不知道     /system 还没回来。**不说「未开通」** —— 把「不知道」说成一个
 *              确定的商业状态，是这一屏最容易犯也最难查的错（同 TD-033）。
 *   未开通     订阅版的常态。说清它是什么、怎么拿到，**不给表单**。
 *   已开通     给接入：没配就引导去填，配了就显示接的是什么、可改。
 *
 * **不叫「本地推理」**：它未必在本机 —— 企业把 Ollama / vLLM 放在局域网一台
 * GPU 机器上是最常见的形态。那时上下文确实出了本机，只是不经 Atlas、不出这个
 * 组织的网络。回环与非回环要分别说（`loopback`），一句话盖过去就是替用户做了
 * 一个他没做过的承诺。
 */
function PrivateModelBlock({ api, system }: { api: Api; system: SystemInfo | null }) {
  const t = useT();
  const li = system?.localInference;
  const [view, setView] = useState<PrivateModelView | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ baseUrl: "", model: "", apiKey: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setView(await api.privateModel());
    } catch {
      /* 这套装配不提供它（503）。保持 null —— 与「还没读到」一样不下断言。 */
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setView(
        await api.savePrivateModel({
          baseUrl: form.baseUrl.trim(),
          model: form.model.trim(),
          ...(form.apiKey ? { apiKey: form.apiKey } : {}),
        }),
      );
      setEditing(false);
      setForm({ baseUrl: "", model: "", apiKey: "" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      setView(await api.clearPrivateModel());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const provisioned = view?.source === "local" || view?.source === "deployment";

  return (
    <SettingsBlock
      icon="cpu"
      title={t("set.private.title")}
      desc={t("set.private.desc")}
    >
      {li === undefined ? (
        /* 还没读到 /system。不说「未开通」—— 那是此刻并不知道的事实。 */
        <p className="set-note text-muted-foreground">{t("set.private.loading")}</p>
      ) : !li.direct && !provisioned ? (
        <>
          <div className="update-line">
            <span>{t("set.private.notProvisioned")}</span>
            <StatusBadge tone="neutral">{t("set.private.notProvisionedBadge")}</StatusBadge>
          </div>
          <p className="set-note text-muted-foreground">
            {t("set.private.notProvisionedNote")}
          </p>
        </>
      ) : (
        <>
          <div className="update-line">
            <span>
              {view?.endpoint ? (
                <>
                  {t("set.private.connectedPrefix")}
                  <code className="text-body-sm">{view.endpoint.model}</code>
                  {" @ "}
                  <code className="text-body-sm">{view.endpoint.baseUrl}</code>
                </>
              ) : (
                t("set.private.noEndpointYet")
              )}
            </span>
            <StatusBadge tone={view?.endpoint ? "success" : "neutral"}>
              {t(view?.endpoint ? "set.private.connected" : "set.private.pending")}
            </StatusBadge>
          </div>

          {/* 边界这一句**按事实说**：回环与非回环是两种部署，不能一句话盖过去。 */}
          {view?.endpoint && (
            <p className="set-note text-muted-foreground">
              {view.endpoint.loopback
                ? t("set.private.loopbackNote")
                : t("set.private.remoteNote")}
            </p>
          )}

          {view && !view.editable && (
            /* 运维选了哪台推理服务，用户不该绕过去 —— 与「预置连接器卸不掉、
               只能停用」同一条模式。 */
            <p className="set-note text-muted-foreground">{t("set.private.fromDeployment")}</p>
          )}

          {view?.editable && !editing && (
            <div className="update-line">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {t(view.endpoint ? "set.private.change" : "set.private.connect")}
              </Button>
              {view.endpoint && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void disconnect()}>
                  {t("set.private.disconnect")}
                </Button>
              )}
            </div>
          )}

          {editing && (
            <div className="set-form">
              <label className="set-field" htmlFor="private-model-base">
                <span>{t("set.private.baseUrl")}</span>
                <input
                  id="private-model-base"
                  value={form.baseUrl}
                  placeholder="http://127.0.0.1:11434/v1"
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
              </label>
              <label className="set-field" htmlFor="private-model-name">
                <span>{t("set.private.model")}</span>
                <input
                  id="private-model-name"
                  value={form.model}
                  placeholder="qwen2.5:14b"
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </label>
              <label className="set-field" htmlFor="private-model-key">
                {/* 这是**用户自己那台服务的口令**，不是 Vxture 的机密 —— 与填给连接器
                    的数据库口令同类。「客户端零秘密」管的是后者。落盘随主密钥封存。 */}
                <span>{t("set.private.apiKey")}</span>
                <input
                  id="private-model-key"
                  type="password"
                  value={form.apiKey}
                  placeholder={t("set.private.apiKeyPlaceholder")}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                />
              </label>
              <div className="update-line">
                <Button size="sm" disabled={busy} onClick={() => void submit()}>
                  {t("set.save")}
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                  {t("set.cancel")}
                  </Button>
              </div>
            </div>
          )}

          {error && <p className="set-note text-destructive">{error}</p>}
        </>
      )}
    </SettingsBlock>
  );
}
