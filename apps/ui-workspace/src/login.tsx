/**
 * Login gate - the first screen. Daemon connectivity (the session token) is
 * host-injected and invisible to the user; what the user sees is a clean
 * account login: brand + a single 登录 button that runs the PKCE Web flow,
 * then drops into the product. Local-first is preserved: 本地优先 means a
 * user may skip and work locally (data sovereignty, 40-context §9), offered
 * as a quiet secondary link.
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@vxture/design-system";
import { Api, type SessionInfo } from "./api";
import { syncChromeTheme } from "./chrome-theme";
import { useHostChrome } from "./host-chrome";

// Workbench (~570 lines, plus its own lazy-loaded home/settings/workspace
// views) only exists once signed in - the login screen has no reason to wait
// on it, and shouldn't ship it to a visitor who never signs in (TD-011②).
const Workbench = lazy(() =>
  import("./workbench").then((m) => ({ default: m.Workbench })),
);

/**
 * 单条标题栏模式（Electron 无边框 / PWA-WCO）下，登录页与加载页没有 header，
 * 窗口顶端归应用——需要一条不可见的拖拽带，否则窗口拖不动。普通浏览器下不渲染。
 */
function DragStrip() {
  const chrome = useHostChrome();
  if (chrome === "browser") return null;
  return <div className={`dragstrip titlebar titlebar-${chrome}`} aria-hidden />;
}

const LOGIN_POLL_MS = 2000;
const LOGIN_POLL_MAX_MS = 5 * 60 * 1000;

/**
 * 「换个账号登录」停用期间给出的替代做法（TD-070）。
 *
 * 说的是**用户自己能做到的那条路**，不是「暂不可用」——后者只告诉人此路不通，
 * 而他要的是换个账号，那件事今天仍然做得到，只是得先在浏览器里退出。
 */
const SWITCH_ACCOUNT_HINT = "先在浏览器里退出登录账号，然后点击登录";

/** Decides the first surface once the daemon is reachable: login vs product. */
export function SessionGate({ api }: { api: Api }) {
  const [session, setSession] = useState<SessionInfo | "loading">("loading");

  const refresh = useCallback(async () => {
    try {
      const s = await api.session();
      setSession(s);
      return s;
    } catch {
      // Daemon reachable but session endpoint unavailable: treat as signed-out.
      setSession({
        signedIn: false,
        issuer: "",
        consoleBase: "https://vxture.com",
        entitlementsConfigured: false,
      });
      return null;
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 窗口按钮的颜色跟着界面主题走（chrome-theme.ts）。放在这里而不是工作台里：
  // 登录页也是一整屏，那时右上角同样有三个按钮。
  useEffect(() => syncChromeTheme(api), [api]);

  if (session === "loading") {
    return (
      <div className="splash">
        <DragStrip />
        <img className="splash-mark" src="/logo.svg" alt="" aria-hidden />
        <div className="text-body-md text-muted-foreground">正在连接运行时…</div>
      </div>
    );
  }
  // 未登录就只有登录。订阅与权益在平台，没有登录态就没有工作区，
  // 也就没有可跑的产品 —— 把人放进去只是让他对着一个什么都做不了
  // 的界面。「离线继续」是另一回事，它靠会话恢复，不靠这个入口。
  if (!session.signedIn) {
    return (
      <LoginScreen
        api={api}
        consoleBase={session.consoleBase}
        onSignedIn={refresh}
      />
    );
  }
  return (
    <Suspense
      fallback={
        <div className="splash">
          <DragStrip />
          <img className="splash-mark" src="/logo.svg" alt="" aria-hidden />
          <div className="text-body-md text-muted-foreground">正在加载…</div>
        </div>
      }
    >
      {/* 退出登录由工作台里那一格发起，但**决定去留的是这里** —— 闸门只在挂载
          时读过一次会话，所以必须让它重读一次；`refresh()` 读到未登录就换回
          登录页，整棵工作台随之卸载，设置 › 账号那份会话副本也一起没了。 */}
      <Workbench api={api} onSignedOut={() => void refresh()} />
    </Suspense>
  );
}

function LoginScreen({
  api,
  consoleBase,
  onSignedIn,
}: {
  api: Api;
  consoleBase: string;
  onSignedIn: () => void;
}) {
  const [busy, setBusy] = useState(false);
  /** 从「已发起、还没等到浏览器那边签完」到「签完或放弃」——只驱动按钮自身
   *  的文案，不再另起一段提示（owner 2026-09-16：一个页面，按钮变文案就够，
   *  不是两套内容）。 */
  const [verifying, setVerifying] = useState(false);
  const pollRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (pollRef.current !== undefined) clearInterval(pollRef.current);
    },
    [],
  );

  const startLogin = async (opts: { switchAccount?: boolean } = {}) => {
    setBusy(true);
    try {
      const { authorizeUrl } = await api.login(opts);
      setVerifying(true);
      // Electron routes this to the system browser via the window-open handler;
      // plain browsers may popup-block it - clicking 登录 again (still enabled
      // while verifying) just reopens the same authorize URL.
      const win = window.open(authorizeUrl, "_blank");
      if (win) win.opener = null;
      if (pollRef.current !== undefined) clearInterval(pollRef.current);
      const startedAt = Date.now();
      pollRef.current = window.setInterval(async () => {
        try {
          const s = await api.session();
          if (s.signedIn) {
            clearInterval(pollRef.current);
            pollRef.current = undefined;
            onSignedIn();
            return;
          }
        } catch {
          /* keep polling */
        }
        if (Date.now() - startedAt > LOGIN_POLL_MAX_MS) {
          clearInterval(pollRef.current);
          pollRef.current = undefined;
          // 放弃轮询就得把「验证中」也放掉，否则按钮永远卡在验证态，
          // 用户连重试都点不动。
          setVerifying(false);
        }
      }, LOGIN_POLL_MS);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <DragStrip />
      <div className="login-center">
        <img className="login-mark" src="/logo.svg" alt="RUYIN" />
        {/* 品牌 = 产品 = RUYIN，标语 Intelligent Workbench；不再并列一个中文名。 */}
        <h1 className="login-title">
          <span className="brand-name">RUYIN</span>
          <span className="brand-tag">Intelligent Workbench</span>
        </h1>
        <p className="login-sub">
          Ruyin Studio 原生智能体本地运行环境 · 本地数据不出域
        </p>
        <Button
          className="login-btn"
          disabled={busy}
          onClick={() => void startLogin()}
        >
          {busy ? "正在打开浏览器…" : verifying ? "登录验证中…" : "登录 Vxture 账号"}
        </Button>
        {/* 「换个账号」：**入口留着，但停用**（owner 2026-09-17，TD-070）。

            0a 把主按钮上那个无条件的 `prompt` 拆掉之后（TD-069 的真因），这里加
            了一条带 `switchAccount` 的次级入口。真机一验，它**到不了**：平台
            `authorize()` 确实兑现了 `select_account`（拒绝用现有会话、停放一个
            登录挑战、跳登录页），但停放的挑战里**不带 `prompt`**，而登录页随后
            调的 `resumeWithExistingSession` 只看浏览器里那份中央会话就把挑战
            消费掉、按原用户发码 —— 于是输了别人的账号、没输验证码，却以自己的
            身份登了进去。

            所以停用，不删：**入口不该承诺它兑现不了的东西**（登录页此前两个次级
            入口都是因这条被移除的）。

            **要留的那条管线全都还在，而且还有用例守着**：`startLogin(opts)` →
            `api.login(opts)` → `POST /auth/login { switchAccount }` →
            `beginLogin({ switchAccount })`。平台把 `prompt` 存进挑战、让恢复路径
            见到 `login` / `select_account` 就拒绝之后，这里只要去掉 `disabled`
            并接回一行 `onClick={() => void startLogin({ switchAccount: true })}`。

            那一行现在**不挂**：挂在一个永远停用的按钮上，它就是一行看起来活着的
            死代码 —— 覆盖率到不了，读的人也会以为这条路还通。

            提示挂在外层 span 上而不是按钮上：**停用的按钮不派发鼠标事件**，
            `title` 写在它自己身上多半不会显示。 */}
        <span className="login-alt-wrap" title={SWITCH_ACCOUNT_HINT}>
          <button
            type="button"
            className="login-alt text-body-sm text-muted-foreground"
            disabled
            aria-describedby="switch-account-hint"
          >
            换个账号登录
          </button>
        </span>
        <span id="switch-account-hint" hidden>
          {SWITCH_ACCOUNT_HINT}
        </span>
        <p className="login-note text-body-sm text-muted-foreground">
          浏览器中若已登录，会直接用那个账号继续。
        </p>
        {/* 这里曾有两个次级入口，都已移除，理由是同一条：入口不该承诺它
            兑现不了的东西。

            「安装桌面应用」装的是 PWA —— 长得像桌面应用，行为是浏览器窗口，
            而且不启动运行时。桌面应用只有一个，就是 Electron 壳。

            「暂不登录，先本地使用」在项目必须归属工作区之后就空了：不能新建、
            看不到任何项目、产品点不开。而它名义上要保的「离线继续」根本不靠它
            —— 会话（含 active_workspace）加密存盘，重启即恢复，网络失败也不会
            登出，只有服务端明确拒绝 refresh 才清会话。 */}
      </div>
      <div className="login-foot">
        {/* 网站的条款都在 /legal/ 一级目录下（vxture.com/legal/{privacy,terms}，
            经语言前缀跳转后 200）；此前少了这一级，两个链接都是 404。2026-09-03 实测。 */}
        <a href={`${consoleBase}/legal/privacy`} target="_blank" rel="noopener noreferrer">
          隐私政策
        </a>
        <a href={`${consoleBase}/legal/terms`} target="_blank" rel="noopener noreferrer">
          服务条款
        </a>
      </div>
    </div>
  );
}
