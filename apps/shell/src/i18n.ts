/**
 * 壳自己那几句话的目录（owner 2026-09-17：全面改造 i18n，中文 + 英文）。
 *
 * ## 为什么壳有自己一份，不复用界面那一份
 *
 * 界面那一份跑在渲染进程里，靠 React context 与 `localStorage`；壳跑在主进程，
 * 两样都够不到。而壳要说话的三个场合恰恰都**在界面之前或之外**：搬移数据那一屏
 * （守护进程还没起来）、选目录的原生对话框、系统通知。所以这里是一份独立的、
 * 只有十来条的目录 —— 让壳去 import 一个 React 模块，代价比抄十条大得多。
 *
 * ## 语言从哪来
 *
 * `location.json` 里那一条（界面切语言时经守护进程写下的）。**没有就落到操作
 * 系统的语言**（`app.getLocale()`）—— 第一次启动、还没人选过的时候，按系统说的
 * 那门语言开口是对的。
 *
 * 读不到文件、值不认识，都按「没设过」处理：这是一句话说什么语言，不值得为它
 * 让启动失败。
 */

export type ShellLocale = "zh-CN" | "en";

const MESSAGES = {
  "zh-CN": {
    pickDataDir: "选择新的数据目录",
    migratingTitle: "RUYIN — 正在搬移数据",
    migratingHead: "正在搬移数据",
    migratingPreparing: "正在准备……",
    migratingAbout: "约 {size}",
    migratingNote1: "请不要关闭应用。完成后会自动打开。",
    migratingNote2: "万一中途失败，数据会留在原来的位置，不会丢。",
    copying: "正在复制",
    verifying: "正在核对",
    waitingFor: "{project} 在等你",
    contextConfirm: "需要确认要送出的资料",
    toolAsk: "需要批准一次工具使用",
    verificationReview: "需要人工复核",
    stateTransition: "智能体请求推进阶段，需要你确认",
    somethingToConfirm: "有一处需要你确认",
  },
  en: {
    pickDataDir: "Choose a new data folder",
    migratingTitle: "RUYIN — moving your data",
    migratingHead: "Moving your data",
    migratingPreparing: "Preparing…",
    migratingAbout: "about {size}",
    migratingNote1: "Please leave the app open. It reopens by itself when this is done.",
    migratingNote2: "If it fails part-way, your data stays where it was — nothing is lost.",
    copying: "Copying",
    verifying: "Verifying",
    waitingFor: "{project} is waiting for you",
    contextConfirm: "Confirm what gets sent",
    toolAsk: "Approve a tool use",
    verificationReview: "Review needed",
    stateTransition: "The agent wants to advance a stage and needs your confirmation",
    somethingToConfirm: "Something needs your confirmation",
  },
} as const satisfies Record<ShellLocale, Record<string, string>>;

export type ShellKey = keyof (typeof MESSAGES)["zh-CN"];

/** 认得的语言就用它；认不得的（含 `undefined`）落到中文。 */
export function shellLocaleOf(saved: unknown, osLocale: string): ShellLocale {
  if (saved === "zh-CN" || saved === "en") return saved;
  const low = osLocale.toLowerCase();
  if (low.startsWith("en")) return "en";
  return "zh-CN";
}

export function shellT(
  locale: ShellLocale,
  key: ShellKey,
  vars?: Record<string, string | number>,
): string {
  let out: string = MESSAGES[locale][key] ?? MESSAGES["zh-CN"][key];
  for (const [k, v] of Object.entries(vars ?? {})) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}
