/**
 * User slot - the sidebar-footer identity strip. Built from the DS ShellPanel
 * loose parts (the docs' "散件" path): a full-width identity chip triggers a
 * ShellPanelContent popover carrying identity, runtime facts, subscription
 * and account actions. Identity is live (C1: PKCE via the system browser,
 * tokens stay in the daemon; the UI only ever sees the session summary).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Avatar,
  AvatarFallback,
  Button,
  Icon,
  Popover,
  PopoverTrigger,
  ShellPanelContent,
  ShellPanelHeader,
  ShellPanelRow,
  ShellPanelSection,
  StatusBadge,
} from "@vxture/design-system";
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
  collapsed,
  onOpenSettings,
}: {
  api: Api;
  productIds: string[];
  collapsed?: boolean;
  onOpenSettings: () => void;
}) {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [online, setOnline] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [ent, setEnt] = useState<EntitlementsBatch | null>(null);
  const [entError, setEntError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Authorize URL of an in-flight login - fallback link when the automatic
   *  window.open is eaten by a popup blocker. */
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
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

  // Entitlements: fetch once signed in and configured (45s TTL lives in the
  // daemon, so an effect-per-session refresh is enough here).
  useEffect(() => {
    if (!session?.signedIn || !session.entitlementsConfigured) return;
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
  }, [session?.signedIn, session?.entitlementsConfigured, productIds, api]);

  const startLogin = async () => {
    setBusy(true);
    try {
      const { authorizeUrl } = await api.login();
      setPendingUrl(authorizeUrl);
      // Electron routes this to the system browser via the window-open
      // handler; plain browsers may popup-block it, hence the fallback link.
      const win = window.open(authorizeUrl, "_blank");
      if (win) win.opener = null;
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
  const subLine = signedIn
    ? session?.profile?.email ?? session?.org?.name ?? "已登录"
    : online
      ? "本地模式 · 运行中"
      : "未连接";

  const subscriptionLine = () => {
    if (!signedIn) return "登录后同步";
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
    <div className="user-slot-wrap">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            aria-label={`账户 · ${displayName}`}
            className={`user-chip h-auto w-full px-xs py-2xs ${
              collapsed ? "justify-center" : "justify-start"
            }`}
          >
            <span className="user-chip-avatar">
              <Avatar>
                <AvatarFallback>{displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <span className={`user-chip-dot${online ? "" : " off"}`} />
            </span>
            {!collapsed && (
              <>
                <span className="user-chip-text">
                  <span className="user-chip-name">{displayName}</span>
                  <span className="user-chip-sub">{subLine}</span>
                </span>
                <Icon
                  name="caret-up-down"
                  size="sm"
                  className="ml-auto shrink-0 text-muted-foreground"
                />
              </>
            )}
          </Button>
        </PopoverTrigger>
        <ShellPanelContent side="top" align="start" sideOffset={10}>
          <ShellPanelHeader
            avatarFallback={displayName.slice(0, 1)}
            title={displayName}
            titleAside={
              <StatusBadge tone={signedIn ? "success" : "neutral"} dot>
                {signedIn ? "已登录" : "本地模式"}
              </StatusBadge>
            }
            metaRows={[
              { key: "line", content: subLine },
              ...(signedIn && session?.workspace?.name
                ? [
                    {
                      key: "ws",
                      icon: "buildings" as const,
                      content: session.workspace.name,
                    },
                  ]
                : []),
            ]}
          />
          <ShellPanelSection>
            <ShellPanelRow
              icon="cpu"
              label="Runtime"
              value={online ? `运行中 · ${system?.version ?? ""}` : "未连接"}
            />
            <ShellPanelRow
              icon="shield-check"
              label="数据保护"
              value={
                system
                  ? system.keyProtection === "dpapi"
                    ? "DPAPI + 全库加密"
                    : "开发态"
                  : "…"
              }
            />
            <ShellPanelRow icon="certificate" label="订阅" value={subscriptionLine()} />
          </ShellPanelSection>
          {!signedIn && (
            <ShellPanelSection>
              <Button
                className="w-full"
                disabled={busy || !online}
                onClick={() => void startLogin()}
              >
                {busy ? "正在打开浏览器…" : "登录 Vxture 账号"}
              </Button>
              {pendingUrl && (
                <div className="text-body-sm text-muted-foreground text-center pt-2xs">
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
            </ShellPanelSection>
          )}
          <ShellPanelSection>
            <ShellPanelRow
              icon="cloud"
              label="账户中心"
              href={session?.consoleBase ?? "https://vxture.com"}
              newTab
              trailingIcon="external-link"
            />
            <ShellPanelRow icon="settings" label="设置" onClick={onOpenSettings} />
            {signedIn && (
              <ShellPanelRow
                icon="sign-out"
                label="退出登录"
                danger
                onClick={() => void doLogout()}
              />
            )}
          </ShellPanelSection>
        </ShellPanelContent>
      </Popover>
    </div>
  );
}
