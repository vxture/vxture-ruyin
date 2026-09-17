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

  /* ── Language ─────────────────────────────────────────────────────── */
  "prefs.language": "Language",
};
