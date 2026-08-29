/**
 * User slot - pinned to the sidebar bottom (Claude-Desktop-style): avatar +
 * name chip that opens a popover with account/runtime quick info and actions.
 * Identity is live (C1: PKCE via the system browser, tokens stay in the
 * daemon); the popover only ever sees the session summary. Subscription row
 * reads the C2 envelope for the installed products when the entitlements API
 * is configured.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Api,
  type EntitlementsBatch,
  type SessionInfo,
  type SystemInfo,
} from "./api";

/** Poll /auth/session until signedIn flips (login completes in the browser). */
const LOGIN_POLL_MS = 2000;
const LOGIN_POLL_MAX_MS = 5 * 60 * 1000;

export function UserSlot({
  api,
  productIds,
  onOpenSettings,
}: {
  api: Api;
  productIds: string[];
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [online, setOnline] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [ent, setEnt] = useState<EntitlementsBatch | null>(null);
  const [entError, setEntError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Authorize URL of an in-flight login - rendered as a fallback link when
   *  the automatic window.open is eaten by a popup blocker. */
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | undefined>(undefined);

  const refreshSession = useCallback(async () => {
    try {
      const s = await api.session();
      setSession(s);
      return s;
    } catch {
      return null;
    }
  }, [api]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/health");
        if (alive) setOnline(res.ok);
      } catch {
        if (alive) setOnline(false);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    api
      .system()
      .then((s) => alive && setSystem(s))
      .catch(() => {});
    void refreshSession();
    return () => {
      alive = false;
      clearInterval(timer);
      if (pollRef.current !== undefined) clearInterval(pollRef.current);
    };
  }, [api, refreshSession]);

  // Entitlements: fetch once signed in and configured; 45s TTL lives in the
  // daemon, so a simple on-open refresh is enough here.
  useEffect(() => {
    if (!open || !session?.signedIn || !session.entitlementsConfigured) return;
    if (productIds.length === 0) return;
    let alive = true;
    api
      .entitlements(productIds)
      .then((e) => {
        if (alive) {
          setEnt(e);
          setEntError(null);
        }
      })
      .catch((e: Error) => alive && setEntError(e.message));
    return () => {
      alive = false;
    };
  }, [open, session?.signedIn, session?.entitlementsConfigured, productIds, api]);

  const startLogin = async () => {
    setBusy(true);
    try {
      const { authorizeUrl } = await api.login();
      setPendingUrl(authorizeUrl);
      // In the Electron shell this routes to the system browser via the
      // window-open handler; in a plain browser a popup blocker may eat it,
      // which is what the fallback link below is for.
      const win = window.open(authorizeUrl, "_blank");
      if (win) win.opener = null;
      // Watch for the flow completing in the external browser.
      if (pollRef.current !== undefined) clearInterval(pollRef.current);
      const startedAt = Date.now();
      pollRef.current = window.setInterval(async () => {
        const s = await refreshSession();
        if (s?.signedIn || Date.now() - startedAt > LOGIN_POLL_MAX_MS) {
          clearInterval(pollRef.current);
          pollRef.current = undefined;
          if (s?.signedIn) setPendingUrl(null);
        }
      }, LOGIN_POLL_MS);
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    setBusy(true);
    try {
      await api.logout();
      setEnt(null);
      await refreshSession();
    } finally {
      setBusy(false);
    }
  };

  const signedIn = session?.signedIn === true;
  const displayName = signedIn
    ? session?.profile?.name ?? session?.profile?.email ?? "Vxture 用户"
    : "本地用户";
  const avatarChar = displayName.slice(0, 1);

  const subscriptionLine = () => {
    if (!signedIn) return "未激活 · 登录后同步";
    if (!session?.entitlementsConfigured) return "权益服务未配置";
    if (entError) return "获取失败";
    if (!ent) return "…";
    const envs = Object.values(ent.entitlements);
    const active = envs.filter((e) => e.tier !== null || e.bundled).length;
    if (active === 0) return "无生效订阅";
    const tiers = [
      ...new Set(envs.map((e) => e.tier).filter((t): t is string => t !== null)),
    ];
    return `${active} 个产品生效${tiers.length > 0 ? ` · ${tiers.join("/")}` : ""}`;
  };

  return (
    <div className="user-slot-wrap" ref={rootRef}>
      {open && (
        <div className="user-pop" role="dialog">
          <div className="user-pop-head">
            <span className="avatar lg">
              {avatarChar}
              <span className={`avatar-dot${online ? "" : " off"}`} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="ws-name">{displayName}</div>
              <div className="muted">
                {signedIn
                  ? session?.profile?.email ?? session?.org?.name ?? "已登录"
                  : "未登录 Vxture 账号"}
              </div>
            </div>
            <span className="pill" style={{ marginLeft: "auto" }}>
              {signedIn ? session?.org?.name ?? "已登录" : "本地模式"}
            </span>
          </div>

          <div className="user-pop-info">
            <div className="user-info-row">
              <span className={`conn-dot${online ? "" : " off"}`} />
              <span>Runtime</span>
              <span className="muted" style={{ marginLeft: "auto" }}>
                {online ? `运行中 · ${system?.version ?? ""}` : "未连接"}
              </span>
            </div>
            <div className="user-info-row">
              <span className="user-info-glyph">⛨</span>
              <span>数据保护</span>
              <span className="muted" style={{ marginLeft: "auto" }}>
                {system
                  ? system.keyProtection === "dpapi"
                    ? "DPAPI + 全库加密"
                    : "开发态（明文主密钥）"
                  : "…"}
              </span>
            </div>
            <div className="user-info-row">
              <span className="user-info-glyph">◈</span>
              <span>订阅</span>
              <span className="muted" style={{ marginLeft: "auto" }}>
                {subscriptionLine()}
              </span>
            </div>
            {signedIn && session?.workspace?.name && (
              <div className="user-info-row">
                <span className="user-info-glyph">▣</span>
                <span>平台空间</span>
                <span className="muted" style={{ marginLeft: "auto" }}>
                  {session.workspace.name}
                </span>
              </div>
            )}
          </div>

          <div className="user-pop-menu">
            <button
              className="user-menu-item"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <span className="user-info-glyph">⚙</span> 设置
            </button>
            <button
              className="user-menu-item"
              disabled={!session}
              onClick={() =>
                window.open(session?.consoleBase ?? "https://vxture.com", "_blank", "noopener")
              }
            >
              <span className="user-info-glyph">☁</span> 账户中心
              <span className="soon-tag">↗</span>
            </button>
            {signedIn && (
              <button
                className="user-menu-item"
                disabled={busy}
                onClick={() => void doLogout()}
              >
                <span className="user-info-glyph">⇥</span> 退出登录
              </button>
            )}
          </div>

          {!signedIn && (
            <button
              className="primary user-login-btn"
              disabled={busy || !online}
              onClick={() => void startLogin()}
            >
              {busy ? "正在打开浏览器…" : "登录 Vxture 账号"}
            </button>
          )}
          {!signedIn && pendingUrl && (
            <div className="muted" style={{ textAlign: "center", padding: "4px 0" }}>
              在浏览器中完成登录后自动返回…{" "}
              <a href={pendingUrl} target="_blank" rel="noopener noreferrer">
                未打开?点此继续 ↗
              </a>
            </div>
          )}
          <div className="user-pop-foot muted">
            如影 RUYIN · Runtime {system?.version ?? "…"}
          </div>
        </div>
      )}

      <button
        className={`user-slot${open ? " open" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <span className="avatar">
          {avatarChar}
          <span className={`avatar-dot${online ? "" : " off"}`} />
        </span>
        <span className="user-slot-text">
          <span className="ws-name">{displayName}</span>
          <span className="muted user-slot-sub">
            {signedIn
              ? session?.org?.name ?? "已登录"
              : online
                ? "本地模式 · 运行中"
                : "未连接"}
          </span>
        </span>
        <span className={`user-slot-caret${open ? " up" : ""}`}>▾</span>
      </button>
    </div>
  );
}
