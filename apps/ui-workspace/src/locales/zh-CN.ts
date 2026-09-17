/**
 * 简体中文目录 —— **源语言**。
 *
 * 键集合由这个文件定，英文目录声明成 `Catalog` 之后少一个多一个都在编译期红。
 * 加一句话时先加在这里，再补英文。
 *
 * 排版约定：键按界面分区分组，组内按它在屏幕上出现的顺序。**不按字母排** ——
 * 字母序会把「标题」和它下面那句副标题拆到两个地方，改文案时看不见上下文。
 *
 * 分单复数的句子**两条都写**（`_one` 与 `_other`）。中文没有复数分支，两条
 * 逐字一样 —— 看着冗余，但它换来两件事：键集合在两门语言之间完全对齐（于是
 * 类型能管住它），以及**一眼就能看出这句话是带计数的**，翻译的人不会漏掉
 * 英文那边的单数形。
 */
export const zhCN = {
  /* ── 未连接到运行时（还没拿到宿主令牌时的那一屏） ───────────────────── */
  "app.notConnected.title": "未连接到本地运行时",
  "app.notConnected.body":
    "RUYIN 的主体是运行在你自己机器上的本地运行时，由 RUYIN 桌面应用启动。请从开始菜单打开「RUYIN」—— 运行时会随之启动并自动连接，无需你输入任何东西。",
  "app.notConnected.note":
    "你现在打开的是运行时的网页界面。它需要运行时已在运行——单独打开它不会启动 RUYIN。",

  /* ── 登录页 ───────────────────────────────────────────────────────── */
  "login.connecting": "正在连接运行时…",
  "login.loading": "正在加载…",
  "login.tagline": "智能工作台 · 你的数据留在这台电脑上",
  "login.button.idle": "登录 Vxture 账号",
  "login.button.opening": "正在打开浏览器…",
  "login.button.verifying": "登录验证中…",
  "login.switchAccount": "换个账号登录",
  "login.switchAccountHint": "先在浏览器里退出登录账号，然后点击登录",
  "login.note": "浏览器中若已登录，会直接用那个账号继续。",
  "login.legal.privacy": "隐私政策",
  "login.legal.terms": "服务条款",
  "login.legal.refund": "退款政策",

  /* ── 左下角账户格与它的面板 ───────────────────────────────────────── */
  "user.aria.chip": "账户 · {name}",
  "user.defaultName": "Vxture 用户",
  "user.sessionExpired": "会话已失效",
  "user.relogin": "请重新登录以继续",
  "user.offline": "未连接",
  "user.badge.loginError": "登录异常",
  "user.login.return": "在浏览器中完成登录后自动返回…",
  "user.login.fallback": "未打开？点此继续 ↗",
  "user.row.profile": "用户中心",
  "user.row.quota": "配额用量",
  "user.row.settings": "设置",
  "user.row.logout": "退出",

  /* ── 标题栏的运行环境下拉 ─────────────────────────────────────────── */
  "runtime.ready": "已就绪",
  "runtime.readyWith": "已就绪 · {version}",
  "runtime.connectedWith": "已连接 · {workspace}",
  "runtime.offline": "未连接",
  "runtime.encrypted": "已加密",
  "runtime.devKey": "开发用途 · 密钥未受保护",
  "runtime.platform.connected": "已连接",
  "runtime.platform.signedOut": "未登录",
  "runtime.badge": "运行环境 {version}",
  "runtime.aria.online": "运行时 · {version}",
  "runtime.aria.offline": "运行时 · 未连接",
  "runtime.row.env": "运行环境",
  "runtime.row.encryption": "数据加密",
  "runtime.row.platform": "平台连接",
  "runtime.offlineBody":
    "暂时连不上本机的运行环境，所以读不到数据。应用会自动重连；一直连不上的话，关掉 RUYIN 再从开始菜单打开一次。",

  /* ── 标题栏的租户 / 工作区下拉 ────────────────────────────────────── */
  "tenant.unnamed": "未命名租户",
  "tenant.noWorkspace": "未选定工作区",
  "tenant.aria": "租户 {tenant} · 工作区 {workspace}",
  "tenant.quota.section": "配额",
  "tenant.quota.loading": "正在读取…",
  "tenant.quota.label": "配额",
  "tenant.quota.unavailable": "暂时读不到",
  "tenant.quota.caption": "已用 {used}，总量 {limit}",
  "tenant.quota.points": "{n} 点",
  "tenant.admin": "租户管理",

  /* ── 待确认 ──────────────────────────────────────────────────────── */
  "pending.kind.context_confirm": "确认要送出的资料",
  "pending.kind.tool_ask": "批准一次工具使用",
  "pending.kind.verification_review": "人工复核",
  "pending.kind.state_transition": "确认智能体提出的阶段推进",
  "pending.waited.justNow": "刚刚",
  "pending.waited.minutes_one": "已等 # 分钟",
  "pending.waited.minutes_other": "已等 # 分钟",
  "pending.waited.hours_one": "已等 # 小时",
  "pending.waited.hours_other": "已等 # 小时",
  "pending.waited.days_one": "已等 # 天",
  "pending.waited.days_other": "已等 # 天",
  "pending.aria.count_one": "# 项等待你确认",
  "pending.aria.count_other": "# 项等待你确认",
  "pending.aria.none": "没有待确认的事项",
  "pending.empty.title": "没有在等你的事",
  "pending.empty.desc": "任务停下来需要你确认时，会出现在这里，并同时发出系统通知。",

  /* ── 通用小件 ────────────────────────────────────────────────────── */
  "common.closeNotice": "关闭提醒",
  "common.copy": "复制",
  "common.copied": "已复制",
  "common.search": "搜索（Ctrl K）",
  "search.placeholder": "搜索项目、产品与动作…",
  "search.empty": "没有匹配的结果",
  "search.results": "搜索结果",

  /* ── 检查更新 ────────────────────────────────────────────────────── */
  "update.unavailable": "暂时无法检查更新，请稍后再试",
  "update.current": "已是最新版本",
  "update.found": "发现新版本",
  // 整句一条，不拼碎片：语序是随语言变的，「有新版本 X（当前 Y）」在别的
  // 语言里未必还是这个顺序。带不带渠道是两条**独立的句子**，不是一条句子加
  // 一个可选尾巴 —— 后者等于要求每门语言都能在同一个位置接上。
  "update.availableLine": "有新版本 {latest}（当前 {current}）",
  "update.availableLineWithChannel": "有新版本 {latest}（当前 {current} · {channel}）",
  "update.toastLine": "{latest}（当前 {current}）",
  "update.toastLineWithChannel": "{latest}（当前 {current} · {channel}）",
  "update.noPackage": "暂时拿不到安装包，请稍后再试",
  "update.upgrade": "升级",
  "update.close": "关闭",
  "update.channel.stable": "正式版",
  "update.channel.beta": "测试版",

  /* ── 产品界面那一格 ──────────────────────────────────────────────── */
  "productSurface.title": "产品界面",
  "productSurface.loading": "加载中……",
  "productSurface.refused": "出于安全考虑，这个产品界面没有被载入。",
  "productSurface.archived":
    "项目已归档，产品界面不再载入。记录照常可看、可导出；恢复项目后界面就回来。",
  "productSurface.none": "这个产品没有自己的界面。任务、资料与成果都在左侧。",
  "productSurface.unavailable.title": "产品界面暂时不可用",
  "productSurface.unavailable.body":
    "它的界面还没取到本机，可能是之前离线。产品其余部分照常可用 —— 任务、资料与成果都在左侧。",
  "productSurface.retry": "重新获取",
  "productSurface.retrying": "获取中…",

  /* ── 关于 / 三方许可 ─────────────────────────────────────────────── */
  "about.desc": "Vxture AI 原生智能体的本地智能工作环境",
  "about.version": "版本 {version}",
  "about.copyright": "© 2026 Vxture · 保留所有权利",
  "thirdParty.trigger": "三方许可",
  "thirdParty.title": "随包第三方组件许可",
  "thirdParty.desc_one":
    "以下 # 个是随 RUYIN 一起分发的第三方开源组件，列在这里是它们的许可证要求的署名。许可证全文在安装目录里；技能与工具的许可证逐条写在「能力平台」页。",
  "thirdParty.desc_other":
    "以下 # 个是随 RUYIN 一起分发的第三方开源组件，列在这里是它们的许可证要求的署名。许可证全文在安装目录里；技能与工具的许可证逐条写在「能力平台」页。",
  "thirdParty.col.component": "组件",
  "thirdParty.col.version": "版本",
  "thirdParty.col.license": "许可证",
  "thirdParty.col.part": "所属模块",
  "thirdParty.part.daemon": "运行环境",
  "thirdParty.part.ui": "界面",
  "thirdParty.part.shell": "桌面应用",
  /** 并列项之间的分隔 —— 中文用顿号，英文用逗号加空格。 */
  "common.listSep": "、",

  /* ── 设置的分区 ──────────────────────────────────────────────────── */
  "sections.account": "账户",
  "sections.general": "通用设置",
  "sections.models": "模型平台",
  "sections.skills": "能力平台",
  "sections.connectors": "连接器",
  "sections.database": "数据库",
  "sections.updates": "软件更新",
  "sections.about": "关于",

  /* ── 项目里的分区 ────────────────────────────────────────────────── */
  "tabs.overview": "概览",
  "tabs.context": "上下文",
  "tabs.tasks": "任务",
  "tabs.audit": "审计",
  "tabs.product": "产品界面",

  /* ── 侧栏与标题栏 ────────────────────────────────────────────────── */
  "nav.home": "首页",
  "nav.recent": "最近工作",
  "nav.archived": "已归档",
  "nav.pendingImport": "待导入工作区",
  "nav.sample": "示例 · {product}",
  "nav.siblings": "同产品的其他项目",
  "nav.elsewhere_one": "另有 # 个项目在其他工作区",
  "nav.elsewhere_other": "另有 # 个项目在其他工作区",
  "nav.expand": "展开导航",
  "nav.collapse": "收起导航",
  "nav.expandGroups": "展开全部分组",
  "nav.collapseGroups": "收起全部分组",
  "nav.tabWithCount": "{label}（{count}）",
  "chrome.back": "回到工作台",
  "chrome.settings": "设置",
  "chrome.project": "项目",
  "chrome.website": "官网 · ruyin.work",
  "chrome.loading": "加载中……",
  "nav.projectMeta": "{product} · {type}",
  "nav.projectMetaArchived": "{product} · {type} · 已归档",

  /* ── 搜索结果分组 ────────────────────────────────────────────────── */
  "search.group.projects": "项目",
  "search.group.products": "产品",
  "search.group.actions": "动作",
  "search.meta.installed": "已安装",
  "search.action.home": "回到首页",
  "search.action.settings": "打开设置",

  /* ── 首页：运行状况三张卡 ────────────────────────────────────────── */
  "home.cards.aria": "运行时概况",
  "home.card.runtime": "运行环境",
  "home.card.runtime.ok": "已就绪",
  "home.card.runtime.off": "未连接",
  "home.card.runtime.hintOk": "本机运行环境正常",
  "home.card.runtime.hintOff": "本机运行环境暂时没有响应，正在重新连接",
  "home.card.encryption": "数据加密",
  "home.card.encryption.on": "已加密",
  "home.card.encryption.dev": "开发用途",
  "home.card.encryption.hintOn": "你的数据全部加密保存，密钥只有这台电脑上的你能解开",
  "home.card.encryption.hintDev": "数据仍然加密，但密钥没有系统级保护 —— 请勿放入真实数据",
  "home.card.platform": "平台连接",
  "home.card.platform.on": "已连接",
  "home.card.platform.off": "未登录",
  "home.card.platform.hintOn": "当前工作区「{workspace}」，这里能用的智能体与数据都属于它",
  "home.card.platform.hintOff": "登录 Vxture 账号后，你订阅的智能体才会同步到这台电脑",
  "home.workspace.unset": "未选定",

  /* ── 首页：我的智能体 ────────────────────────────────────────────── */
  "home.mine.title": "我的智能体",
  "home.mine.subscriptionUnknown": "暂时读不到订阅信息，以下是这台电脑上已安装的智能体。",
  "home.mine.updateBlocked": "AI 能力尚未开通，暂时查不了新版本",
  "home.mine.checking": "正在检查……",
  "home.mine.update": "更新",
  "home.empty.signedIn": "当前账号没有可用的智能体",
  "home.empty.signedOut": "登录后同步你的智能体",
  "home.empty.descSignedIn": "运行环境已就绪。到 Vxture 平台订阅后，智能体就会出现在这里。",
  "home.empty.descSignedOut": "运行环境已就绪。登录 Vxture 账号后，你订阅的智能体会出现在这里。",
  "home.empty.subscribe": "到 Vxture 平台订阅",

  /* ── 首页：热门智能体 ────────────────────────────────────────────── */
  "home.catalog.title": "热门智能体",
  "home.catalog.desc": "平台上最受欢迎的三个，订阅在平台完成",
  "home.catalog.browseAll": "浏览全部",
  "home.catalog.released": "正式版",
  "home.catalog.preview": "开发中",
  "home.catalog.learnMore": "了解详情",
  "home.catalog.source": "来自 Vxture 平台，更新于 {date}",

  /* ── 首页：产品卡 ────────────────────────────────────────────────── */
  "home.card.blurbFallback": "Vxture 智能体",
  "home.blurb.bidproposal": "招标解析 · 需求矩阵 · 方案生成 · 覆盖校验",
  "home.card.identTitle": "产品标识 {id}",
  "home.card.platformVersion": "平台上的版本 {version}",
  "home.card.activeVersion": "当前生效版本 {version}",
  "home.badge.expired": "已过期",
  "home.badge.subscribed": "已订阅",
  "home.badge.notInstalled": "本机未安装",
  "home.badge.notEntitled": "未订阅",
  "home.badge.disabled": "已停用",
  "home.badge.builtinSample": "内置示例",
  "home.badge.localOnly": "本地已装",
  "home.badge.notWired": "未接通",
  "home.alert.notWired": "AI 能力尚未开通：现在发起任务只会得到示例内容，不是真实成果",
  "home.card.renew": "续订",
  "home.card.useOnline": "在线使用",
  "home.card.about": "智能体介绍",
  "home.card.upgradeTo": "更新版本 v{version}",
  "home.card.open": "打开",
  "home.card.opening": "打开中……",
  "home.card.goRenew": "去平台续费",
  "home.card.goSubscribe": "去平台订阅",
  "home.card.enable": "启用",
  "home.card.projects": "项目",
  "home.card.projectsTitleBoth": "本地项目 {local} / 总计 {total}",
  "home.card.projectsTitleLocal": "本机上属于该产品的项目：{local}",

  /* ── 首页：安装与产品库 ──────────────────────────────────────────── */
  "home.install.reading": "正在读取…",
  "home.install.catalogUnreachable": "这次没读到产品库，请稍后再试",
  "home.install.catalogEmpty": "产品库里暂时没有可安装的智能体",
  "home.install.catalogAria": "产品库",
  "home.install.signed": "已签名",
  "home.install.unsigned": "未签名",
  "home.install.installed": "已安装",
  "home.install.installing": "正在安装……",
  "home.install.install": "安装",
  "home.install.unsignedBlockedTitle": "出于安全考虑，正式版只安装经过签名的智能体",
  "home.install.unsignedBlocked": "未签名，不能安装",
  "home.install.fromFile": "从本地包安装",
  "home.install.hideRegistry": "收起产品库",
  "home.install.showRegistry": "从产品库拉取",
  "home.install.doneSigned": "已安装 {id}@{version}（已签名）",
  "home.install.doneUnsigned": "已安装 {id}@{version}（未签名）",

  /* ── 语言（设置 › 通用设置 › 偏好设置） ──────────────────────────── */
  "prefs.language": "语言",
} as const;
