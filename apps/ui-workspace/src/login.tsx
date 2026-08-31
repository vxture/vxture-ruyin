/**
 * Login gate - the first screen. Daemon connectivity (the session token) is
 * host-injected and invisible to the user; what the user sees is a clean
 * account login: brand + a single 登录 button that runs the PKCE Web flow,
 * then drops into the product. Local-first is preserved: 本地优先 means a
 * user may skip and work locally (data sovereignty, 40-context §9), offered
 * as a quiet secondary link.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@vxture/design-system";
import { Api, type SessionInfo } from "./api";
import { Workbench, useHostChrome } from "./workbench";
import { useInstallPrompt } from "./install";

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

/** Decides the first surface once the daemon is reachable: login vs product. */
export function SessionGate({ api }: { api: Api }) {
  const [session, setSession] = useState<SessionInfo | "loading">("loading");
  const [localMode, setLocalMode] = useState(false);

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

  if (session === "loading") {
    return (
      <div className="splash">
        <DragStrip />
        <img className="splash-mark" src="/icon.svg" alt="" aria-hidden />
        <div className="text-body-md text-muted-foreground">正在连接运行时…</div>
      </div>
    );
  }
  if (!session.signedIn && !localMode) {
    return (
      <LoginScreen
        api={api}
        consoleBase={session.consoleBase}
        onSignedIn={refresh}
        onLocal={() => setLocalMode(true)}
      />
    );
  }
  return <Workbench api={api} />;
}

function LoginScreen({
  api,
  consoleBase,
  onSignedIn,
  onLocal,
}: {
  api: Api;
  consoleBase: string;
  onSignedIn: () => void;
  onLocal: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const pollRef = useRef<number | undefined>(undefined);
  const chrome = useHostChrome();
  const { canInstall, install } = useInstallPrompt();

  useEffect(
    () => () => {
      if (pollRef.current !== undefined) clearInterval(pollRef.current);
    },
    [],
  );

  const startLogin = async () => {
    setBusy(true);
    try {
      const { authorizeUrl } = await api.login();
      setPendingUrl(authorizeUrl);
      // Electron routes this to the system browser via the window-open handler;
      // plain browsers may popup-block it, hence the fallback link.
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
          }
        } catch {
          /* keep polling */
        }
        if (Date.now() - startedAt > LOGIN_POLL_MAX_MS) {
          clearInterval(pollRef.current);
          pollRef.current = undefined;
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
        <img className="login-mark" src="/icon.svg" alt="如影 Ruyin" />
        <h1 className="login-title">
          <span className="logo-cn">如影</span> · 你的业务工作台
        </h1>
        <p className="login-sub">
          Vxture AI 原生业务产品的本地智能工作环境 · 本地数据不出设备
        </p>
        <Button
          className="login-btn"
          disabled={busy}
          onClick={() => void startLogin()}
        >
          {busy ? "正在打开浏览器…" : "登录 Vxture 账号"}
        </Button>
        {pendingUrl && (
          <div className="login-hint text-body-sm text-muted-foreground">
            在浏览器中完成登录后自动返回…{" "}
            <a
              className="text-primary-text underline"
              href={pendingUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              未打开？点此继续 ↗
            </a>
          </div>
        )}
        {chrome === "browser" && canInstall && (
          <Button
            variant="outline"
            className="login-btn"
            onClick={() => void install()}
          >
            安装桌面应用
          </Button>
        )}
        <button className="login-local" onClick={onLocal}>
          暂不登录，先本地使用 →
        </button>
      </div>
      <div className="login-foot">
        <a href={`${consoleBase}/privacy`} target="_blank" rel="noopener noreferrer">
          隐私政策
        </a>
        <a href={`${consoleBase}/terms`} target="_blank" rel="noopener noreferrer">
          服务条款
        </a>
      </div>
    </div>
  );
}
