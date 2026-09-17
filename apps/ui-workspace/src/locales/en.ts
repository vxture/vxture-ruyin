/**
 * English catalog.
 *
 * Typed as `Catalog`, so a missing or stray key is a compile error — key
 * parity is not something anyone has to remember to check.
 *
 * Written as product English, not as a translation of the Chinese: same
 * meaning, same restraint (a prompt, not a manual), but the phrasing is
 * whatever reads naturally here. Where the Chinese leans on a turn of phrase
 * that does not travel, the English says the thing plainly instead.
 */
import type { Catalog } from "../i18n";

export const en: Catalog = {
  /* ── Not connected to the runtime ─────────────────────────────────── */
  "app.notConnected.title": "Not connected to the local runtime",
  "app.notConnected.body":
    "RUYIN runs on your own machine, started by the RUYIN desktop app. Open “RUYIN” from the Start menu — the runtime starts with it and connects on its own. There is nothing for you to enter.",
  "app.notConnected.note":
    "What you are looking at is the runtime's web interface. It needs the runtime to be running — opening this page on its own will not start RUYIN.",

  /* ── Sign-in ──────────────────────────────────────────────────────── */
  "login.connecting": "Connecting to the runtime…",
  "login.loading": "Loading…",
  "login.tagline": "Intelligent Workbench · Your data stays on this computer",
  "login.button.idle": "Sign in with Vxture",
  "login.button.opening": "Opening your browser…",
  "login.button.verifying": "Verifying…",
  "login.switchAccount": "Use a different account",
  "login.switchAccountHint": "Sign out in your browser first, then sign in here",
  "login.note": "If you are already signed in the browser, that account is used.",
  "login.legal.privacy": "Privacy Policy",
  "login.legal.terms": "Terms of Service",
  "login.legal.refund": "Refund Policy",

  /* ── Account chip and its panel ───────────────────────────────────── */
  "user.aria.chip": "Account · {name}",
  "user.defaultName": "Vxture user",
  "user.sessionExpired": "Session expired",
  "user.relogin": "Sign in again to continue",
  "user.offline": "Not connected",
  "user.badge.loginError": "Sign-in problem",
  "user.login.return": "Finish signing in your browser; this returns on its own…",
  "user.login.fallback": "Nothing opened? Continue here ↗",
  "user.row.profile": "Account center",
  "user.row.quota": "Usage",
  "user.row.settings": "Settings",
  "user.row.logout": "Sign out",

  /* ── Runtime menu in the title bar ────────────────────────────────── */
  "runtime.ready": "Ready",
  "runtime.readyWith": "Ready · {version}",
  "runtime.connectedWith": "Connected · {workspace}",
  "runtime.offline": "Not connected",
  "runtime.encrypted": "Encrypted",
  "runtime.devKey": "Development use · key is not protected",
  "runtime.platform.connected": "Connected",
  "runtime.platform.signedOut": "Signed out",
  "runtime.badge": "Runtime {version}",
  "runtime.aria.online": "Runtime · {version}",
  "runtime.aria.offline": "Runtime · not connected",
  "runtime.row.env": "Runtime",
  "runtime.row.encryption": "Encryption",
  "runtime.row.platform": "Platform",
  "runtime.offlineBody":
    "The runtime on this computer is not reachable right now, so there is no data to show. The app keeps trying; if it stays this way, quit RUYIN and open it again from the Start menu.",

  /* ── Tenant / workspace menu ──────────────────────────────────────── */
  "tenant.unnamed": "Unnamed tenant",
  "tenant.noWorkspace": "No workspace selected",
  "tenant.aria": "Tenant {tenant} · workspace {workspace}",
  "tenant.quota.section": "Usage",
  "tenant.quota.loading": "Loading…",
  "tenant.quota.label": "Usage",
  "tenant.quota.unavailable": "Unavailable right now",
  "tenant.quota.caption": "{used} used of {limit}",
  "tenant.quota.points": "{n} credits",
  "tenant.admin": "Tenant administration",

  /* ── Waiting on you ───────────────────────────────────────────────── */
  "pending.kind.context_confirm": "Confirm what gets sent",
  "pending.kind.tool_ask": "Approve a tool use",
  "pending.kind.verification_review": "Review needed",
  "pending.kind.state_transition": "Confirm the stage the agent proposed",
  "pending.waited.justNow": "just now",
  "pending.waited.minutes_one": "waiting # minute",
  "pending.waited.minutes_other": "waiting # minutes",
  "pending.waited.hours_one": "waiting # hour",
  "pending.waited.hours_other": "waiting # hours",
  "pending.waited.days_one": "waiting # day",
  "pending.waited.days_other": "waiting # days",
  "pending.aria.count_one": "# item waiting for you",
  "pending.aria.count_other": "# items waiting for you",
  "pending.aria.none": "Nothing waiting for you",
  "pending.empty.title": "Nothing is waiting for you",
  "pending.empty.desc":
    "When a task stops and needs your decision, it shows up here and you get a system notification.",

  /* ── Small shared pieces ──────────────────────────────────────────── */
  "common.closeNotice": "Dismiss",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.search": "Search (Ctrl K)",
  "search.placeholder": "Search projects, products and actions…",
  "search.empty": "No matches",
  "search.results": "Search results",

  /* ── Updates ──────────────────────────────────────────────────────── */
  "update.unavailable": "Can't check for updates right now — try again later",
  "update.current": "You're on the latest version",
  "update.found": "Update available",
  "update.availableLine": "Version {latest} is available (you have {current})",
  "update.availableLineWithChannel":
    "Version {latest} is available (you have {current} · {channel})",
  "update.toastLine": "{latest} (you have {current})",
  "update.toastLineWithChannel": "{latest} (you have {current} · {channel})",
  "update.noPackage": "The installer isn't available right now — try again later",
  "update.upgrade": "Update",
  "update.close": "Dismiss",
  "update.channel.stable": "Stable",
  "update.channel.beta": "Beta",

  /* ── The product's own surface ────────────────────────────────────── */
  "productSurface.title": "Product interface",
  "productSurface.loading": "Loading…",
  "productSurface.refused": "This product interface was not loaded, for safety reasons.",
  "productSurface.archived":
    "This project is archived, so the product interface is no longer loaded. The record stays readable and exportable; restore the project and the interface comes back.",
  "productSurface.none":
    "This product has no interface of its own. Tasks, materials and results are all on the left.",
  "productSurface.unavailable.title": "Product interface unavailable",
  "productSurface.unavailable.body":
    "Its interface hasn't been fetched to this computer yet — you may have been offline. The rest of the product works as usual: tasks, materials and results are all on the left.",
  "productSurface.retry": "Fetch again",
  "productSurface.retrying": "Fetching…",

  /* ── About / third-party notices ──────────────────────────────────── */
  "about.desc": "The local workbench for Vxture AI-native agents",
  "about.version": "Version {version}",
  "about.copyright": "© 2026 Vxture · All rights reserved",
  "thirdParty.trigger": "Third-party licenses",
  "thirdParty.title": "Third-party components",
  "thirdParty.desc_one":
    "# open-source component ships with RUYIN. It is listed here because its license asks for attribution. Full license texts are in the installation folder; licenses for skills and tools are listed on the Capabilities page.",
  "thirdParty.desc_other":
    "# open-source components ship with RUYIN. They are listed here because their licenses ask for attribution. Full license texts are in the installation folder; licenses for skills and tools are listed on the Capabilities page.",
  "thirdParty.col.component": "Component",
  "thirdParty.col.version": "Version",
  "thirdParty.col.license": "License",
  "thirdParty.col.part": "Used by",
  "thirdParty.part.daemon": "Runtime",
  "thirdParty.part.ui": "Interface",
  "thirdParty.part.shell": "Desktop app",
  "common.listSep": ", ",

  /* ── Settings sections ────────────────────────────────────────────── */
  "sections.account": "Account",
  "sections.general": "General",
  "sections.models": "Models",
  "sections.skills": "Capabilities",
  "sections.connectors": "Connectors",
  "sections.database": "Databases",
  "sections.updates": "Updates",
  "sections.about": "About",

  /* ── Project tabs ─────────────────────────────────────────────────── */
  "tabs.overview": "Overview",
  "tabs.context": "Materials",
  "tabs.tasks": "Tasks",
  "tabs.audit": "Audit",
  "tabs.product": "Product",

  /* ── Sidebar and title bar ────────────────────────────────────────── */
  "nav.home": "Home",
  "nav.recent": "Recent",
  "nav.archived": "Archived",
  "nav.pendingImport": "Waiting to be imported",
  "nav.sample": "Example · {product}",
  "nav.siblings": "Other projects in this product",
  "nav.elsewhere_one": "# more project in another workspace",
  "nav.elsewhere_other": "# more projects in other workspaces",
  "nav.expand": "Expand sidebar",
  "nav.collapse": "Collapse sidebar",
  "nav.expandGroups": "Expand all groups",
  "nav.collapseGroups": "Collapse all groups",
  "nav.tabWithCount": "{label} ({count})",
  "chrome.back": "Back to the workbench",
  "chrome.settings": "Settings",
  "chrome.project": "Project",
  "chrome.website": "ruyin.work",
  "chrome.loading": "Loading…",
  "nav.projectMeta": "{product} · {type}",
  "nav.projectMetaArchived": "{product} · {type} · archived",

  /* ── Search result groups ─────────────────────────────────────────── */
  "search.group.projects": "Projects",
  "search.group.products": "Products",
  "search.group.actions": "Actions",
  "search.meta.installed": "Installed",
  "search.action.home": "Go to Home",
  "search.action.settings": "Open Settings",

  /* ── Home: the three status cards ─────────────────────────────────── */
  "home.cards.aria": "Runtime status",
  "home.card.runtime": "Runtime",
  "home.card.runtime.ok": "Ready",
  "home.card.runtime.off": "Not connected",
  "home.card.runtime.hintOk": "The runtime on this computer is healthy",
  "home.card.runtime.hintOff":
    "The runtime on this computer is not responding; reconnecting",
  "home.card.encryption": "Encryption",
  "home.card.encryption.on": "Encrypted",
  "home.card.encryption.dev": "Development use",
  "home.card.encryption.hintOn":
    "All your data is stored encrypted, and only you on this computer can unlock it",
  "home.card.encryption.hintDev":
    "Data is still encrypted, but the key has no system-level protection — do not put real data here",
  "home.card.platform": "Platform",
  "home.card.platform.on": "Connected",
  "home.card.platform.off": "Signed out",
  "home.card.platform.hintOn":
    "Workspace “{workspace}” — the agents and data available here belong to it",
  "home.card.platform.hintOff":
    "Sign in with Vxture and the agents you subscribe to appear on this computer",
  "home.workspace.unset": "none selected",

  /* ── Home: my agents ──────────────────────────────────────────────── */
  "home.mine.title": "My agents",
  "home.mine.subscriptionUnknown":
    "Subscription information is unavailable right now; below is what is installed on this computer.",
  "home.mine.updateBlocked": "AI is not enabled yet, so updates cannot be checked",
  "home.mine.checking": "Checking…",
  "home.mine.update": "Check for updates",
  "home.empty.signedIn": "No agents available for this account",
  "home.empty.signedOut": "Sign in to sync your agents",
  "home.empty.descSignedIn":
    "The runtime is ready. Subscribe on the Vxture platform and your agents appear here.",
  "home.empty.descSignedOut":
    "The runtime is ready. Sign in with Vxture and the agents you subscribe to appear here.",
  "home.empty.subscribe": "Subscribe on Vxture",

  /* ── Home: popular agents ─────────────────────────────────────────── */
  "home.catalog.title": "Popular agents",
  "home.catalog.desc": "The three most popular on the platform; subscribe there",
  "home.catalog.browseAll": "Browse all",
  "home.catalog.released": "Released",
  "home.catalog.preview": "In development",
  "home.catalog.learnMore": "Learn more",
  "home.catalog.source": "From the Vxture platform, updated {date}",

  /* ── Home: product cards ──────────────────────────────────────────── */
  "home.card.blurbFallback": "Vxture agent",
  "home.blurb.bidproposal":
    "Tender analysis · requirement matrix · proposal drafting · coverage checks",
  "home.card.identTitle": "Product code {id}",
  "home.card.platformVersion": "Version on the platform: {version}",
  "home.card.activeVersion": "Version in use: {version}",
  "home.badge.expired": "Expired",
  "home.badge.subscribed": "Subscribed",
  "home.badge.notInstalled": "Not installed",
  "home.badge.notEntitled": "Not subscribed",
  "home.badge.disabled": "Disabled",
  "home.badge.builtinSample": "Built-in example",
  "home.badge.localOnly": "Installed locally",
  "home.badge.notWired": "Not enabled",
  "home.alert.notWired":
    "AI is not enabled yet: starting a task now returns example content, not real results",
  "home.card.renew": "Renew",
  "home.card.useOnline": "Use online",
  "home.card.about": "About this agent",
  "home.card.upgradeTo": "Update to v{version}",
  "home.card.open": "Open",
  "home.card.opening": "Opening…",
  "home.card.goRenew": "Renew on the platform",
  "home.card.goSubscribe": "Subscribe on the platform",
  "home.card.enable": "Enable",
  "home.card.projects": "projects",
  "home.card.projectsTitleBoth": "{local} here of {total} in total",
  "home.card.projectsTitleLocal": "Projects for this product on this computer: {local}",

  /* ── Home: installing and the package registry ────────────────────── */
  "home.install.reading": "Loading…",
  "home.install.catalogUnreachable": "Could not read the registry this time — try again later",
  "home.install.catalogEmpty": "No agents available to install right now",
  "home.install.catalogAria": "Package registry",
  "home.install.signed": "Signed",
  "home.install.unsigned": "Unsigned",
  "home.install.installed": "Installed",
  "home.install.installing": "Installing…",
  "home.install.install": "Install",
  "home.install.unsignedBlockedTitle": "For safety, release builds only install signed agents",
  "home.install.unsignedBlocked": "Unsigned — cannot install",
  "home.install.fromFile": "Install from a local package",
  "home.install.hideRegistry": "Hide the registry",
  "home.install.showRegistry": "Browse the registry",
  "home.install.doneSigned": "Installed {id}@{version} (signed)",
  "home.install.doneUnsigned": "Installed {id}@{version} (unsigned)",

  /* ── Project: outcome and task states ─────────────────────────────── */
  "ws.outcome.success": "Succeeded",
  "ws.outcome.rejected": "Rejected",
  "ws.outcome.failed": "Failed",
  "ws.outcome.unknown": "Not recorded",
  "ws.task.created": "Not started",
  "ws.task.selecting": "Gathering materials",
  "ws.task.executing": "Running",
  "ws.task.verifying": "Checking",
  "ws.task.finalizing": "Finishing up",
  "ws.task.waiting_human": "Waiting for you",
  "ws.task.suspended": "Paused (resumes automatically)",
  "ws.task.completed": "Done",
  "ws.task.failed": "Failed",
  "ws.task.cancelled": "Cancelled",

  /* ── Project: notices at the top ──────────────────────────────────── */
  "ws.loading": "Loading…",
  "ws.unattributed.title": "This project is not in a workspace yet",
  "ws.unattributed.body":
    "It was created before workspaces were in use. Import it and it will show up with the current workspace.",
  "ws.unattributed.import": "Import into this workspace",
  "ws.upgradeBlocked":
    "Version {version} of this agent is available, but it removes or narrows something this project uses ({breaks}), so the project stays on {current}.",
  "ws.archived.title": "Project archived ({at})",
  "ws.archived.body":
    "An archived project is read-only: no new tasks, no stage changes, no changes to grants or materials. The record stays readable and exportable.",
  "ws.archived.restore": "Restore project",

  /* ── Project: summary strip ───────────────────────────────────────── */
  "ws.summary.stage": "Stage",
  "ws.summary.tasks": "Tasks",
  "ws.summary.waiting": "{n} waiting",
  "ws.summary.running": "{n} running",
  "ws.summary.materials": "Materials",
  "ws.summary.bindings": "{types} types · {folders} folders",
  "ws.summary.connectors": " · {n} connectors",
  "ws.summary.audit": "Audit",
  "ws.summary.auditCount": "{n} entries",
  "ws.summary.verifying": "Checking",
  "ws.summary.chainOk": "Record intact",
  "ws.summary.chainBroken": "Record was altered",
  "ws.summary.createdAt": "Created {date}",

  /* ── Project: overview ────────────────────────────────────────────── */
  "ws.recentTasks": "Recent tasks",
  "ws.recentTasks.empty": "No task runs yet",
  "ws.export.title": "Export the project record",
  "ws.export.desc":
    "Exports everything recorded for this project: stages, tasks and the audit trail. Documents the agent produced are not included — those are already in your own folders. The destination must be a folder you have granted.",
  "ws.export.placeholder": "Export to (a granted folder)",
  "ws.export.run": "Export",
  "ws.export.running": "Exporting…",
  "ws.export.done": "Exported {count} files to {path}",
  "ws.export.auditCount": "Includes {n} audit entries",
  "ws.export.signed": "Signed.",
  "ws.export.unsigned":
    "Unsigned: the recipient can tell whether it was altered, but not who it came from.",
  "ws.archive.title": "Archive the project",
  "ws.archive.descRestorable":
    "An archived project is read-only: no new tasks, no stage changes, no changes to grants or materials; the record stays readable and exportable, and you can restore it at any time. A project cannot be archived while tasks are still in flight.",
  "ws.archive.descOneWay":
    "An archived project is read-only: no new tasks, no stage changes, no changes to grants or materials; the record stays readable and exportable. This product does not support restoring, so archiving is one-way. A project cannot be archived while tasks are still in flight.",
  "ws.archive.run": "Archive",

  /* ── Project: what a contract change touched ──────────────────────── */
  "ws.break.objects": "objects",
  "ws.break.states": "stages",
  "ws.break.context": "material types",
  "ws.break.capabilities": "capabilities",
  "ws.break.tools": "tools",
  "ws.break.tasks": "tasks",
  "ws.break.project": "project shape",
  "ws.break.more": "{named} and {count} more",

  /* ── Project: advancing a stage ───────────────────────────────────── */
  "ws.advance.label": "Advance to:",
  "ws.advance.confirm":
    "This moves the project from “{from}” to “{to}” and needs your confirmation. Continue?",
  "ws.advance.needsConfirm": " (needs confirmation)",

  /* ── Project: project files ───────────────────────────────────────── */
  "ws.files.title": "Project files",
  "ws.files.desc":
    "A file you take in is copied into this project and encrypted with the same key as the project itself. Move or delete your own copy and this one stays — the evidence behind your results does not disappear with it. Files can only be taken in from folders you have granted.",
  "ws.files.cloudWarning":
    "Do not take files in from a cloud-sync folder (OneDrive, Dropbox, Google Drive…): those files may be placeholders, and what you take in would be an empty shell. The common ones are rejected; for any we cannot recognise, please avoid them yourself.",
  "ws.files.empty.title": "No files taken in yet",
  "ws.files.empty.desc":
    "Reference material is read from where you keep it. To keep the evidence available long-term, take the originals in.",
  "ws.files.aria": "Project files",
  "ws.files.fromLocal": "from this computer",
  "ws.files.fetchBack": "Save a copy",
  "ws.files.remove": "Remove",
  "ws.files.cannotIngest": "That file cannot be taken in",
  "ws.files.cannotFetch": "Could not retrieve {name}",
  "ws.files.placeholderExample": "A file in a granted folder (for example {example})",
  "ws.files.placeholderNoGrant": "Grant a folder above first, then take files in from it",
  "ws.files.ingest": "Take into the project",

  /* ── Project: tool permissions ────────────────────────────────────── */
  "ws.perm.allow": "Run without asking",
  "ws.perm.ask": "Ask me every time",
  "ws.perm.deny": "Never",
  "ws.permSource.hard_floor": "hard limit",
  "ws.permSource.user_policy": "your setting",
  "ws.permSource.contract_default": "product default",
  "ws.permSource.ask_cache": "approved for this task",
  "ws.tools.title": "Tool permissions",
  "ws.tools.desc":
    "These apply to this project only. You can always tighten them; the ones marked as a hard limit cannot be loosened — data that leaves cannot be called back, so someone has to say yes each time.",
  "ws.tools.aria": "Tool permissions",
  "ws.tools.floorTag": "hard limit: {permission}",
  "ws.tools.rowAria": "Permission for {tool}",
  "ws.tools.followContract": "Product default ({permission})",
  "ws.tools.cannotChange": "That one cannot be changed",

  /* ── Project: grants and sources ──────────────────────────────────── */
  "ws.grants.title": "Folder access",
  "ws.grants.empty.title": "No folders granted yet",
  "ws.grants.empty.desc": "Only folders you grant can be read; nothing else is reachable.",
  "ws.grants.placeholder": "Full path to a folder",
  "ws.grants.grant": "Grant",
  "ws.connectors.title": "Connector access",
  "ws.connectors.aria": "Granted connectors",
  "ws.connectors.pickAria": "Connector to grant",
  "ws.connectors.option": "{id} ({source})",
  "ws.connectors.optionStopped": "{id} ({source}, not running)",
  "ws.connectors.grant": "Grant connector",
  "ws.bindings.title": "Where materials come from",
  "ws.bindings.viaAria": "Source",
  "ws.bindings.viaLocal": "A local folder",
  "ws.bindings.viaConnector": "Connector {id}",
  "ws.bindings.placeholderUri": "Resource URI prefix (e.g. crm://accounts/)",
  "ws.bindings.placeholderPath": "A path inside a granted folder",
  "ws.bindings.bind": "Bind and index",
  "ws.bindings.fromConnector": "Connector {connector} · {source}",
  "ws.bindings.collapse": "Hide",
  "ws.bindings.expand": "Show entries",
  "ws.bindings.noEntries": "(nothing found for this binding right now)",

  /* ── Project: tasks ───────────────────────────────────────────────── */
  "ws.taskDefs.title": "What this agent can do",
  "ws.instances.title": "Task runs",
  "ws.instances.empty": "No task runs yet",
  "ws.taskDef.inputs": "{objective} · input types: {types}",
  "ws.taskDef.noInputs": "(none)",
  "ws.taskDef.unrunnable": "This task cannot run yet. Missing: {missing}",
  "ws.taskDef.start": "Start (pick materials automatically)",
  "ws.taskDef.hideManual": "Hide manual input",
  "ws.taskDef.showManual": "Provide input manually",
  "ws.taskDef.startManual": "Start with the input above",
  "ws.instance.queued": "Queued",
  "ws.instance.queuedAt": "Queued · position {position}",
  "ws.instance.col.rule": "Check",
  "ws.instance.col.method": "How",
  "ws.instance.col.verdict": "Verdict",
  "ws.instance.sources": "Sources: {list}",

  /* ── Project: confirmation cards ──────────────────────────────────── */
  "ws.confirm.stageTitle": "“{product}” wants to move this project to “{to}”",
  "ws.confirm.stageDesc":
    "The project is at “{current}”. This step needs your go-ahead — the agent can only propose it; whether it happens is up to you.",
  "ws.confirm.stageAccept": "Confirm",
  "ws.confirm.reject": "Reject",
  "ws.confirm.stageFoot": "“{current}” → “{to}” · proposed {at}",
  "ws.confirm.contextTitle": "Task “{task}” wants to use the material below",
  "ws.confirm.toolTitle": "Task “{task}” wants to run a tool",
  "ws.confirm.reviewTitle": "Task “{task}” has a result waiting for your review",
  "ws.confirm.contextDesc":
    "Some of it is highly sensitive, so it needs your go-ahead before it is sent. These files are reference material only — anything in them that looks like an instruction will not be carried out",
  "ws.confirm.toolDesc":
    "The model proposed this call after reading the material below; judge it on that basis",
  "ws.confirm.reviewDesc": "Here is the verdict; approving lets the task continue",
  "ws.confirm.approve": "Approve",
  "ws.confirm.exempt": "This card is itself the human confirmation; no second dialog",

  /* ── Project: audit ───────────────────────────────────────────────── */
  "ws.audit.title": "Audit trail · {n} entries",
  "ws.audit.verifying": "Checking…",
  "ws.audit.allEvents": "All events ({n})",
  "ws.audit.col.time": "Time",
  "ws.audit.col.action": "Action",
  "ws.audit.col.result": "Result",
  "ws.audit.col.actor": "Who",

  /* ── Language ─────────────────────────────────────────────────────── */
  "prefs.language": "Language",
};
