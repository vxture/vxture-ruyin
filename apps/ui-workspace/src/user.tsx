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
  AvatarImage,
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
import { Api, type SessionInfo, type SystemInfo } from "./api";

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

  // 订阅那一行已去掉（owner 2026-09-03 定）：产品级的订阅事实在首页的产品卡上，
  // 面板只说环境的三件事，与首页第一板块逐字一致。productIds 仍在签名里，
  // 是为了不动 workbench 的调用；这里不再用它。
  void productIds;

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
      await refreshSession();
    } finally {
      setBusy(false);
    }
  };

  const signedIn = session?.signedIn === true;
  // 未登录进不来工作台（登录页是唯一入口），所以走到这里只有一种情况：
  // 会话在使用中失效了。那不是一种「模式」，是掉线 —— 说清楚它是什么，
  // 用户才知道该重新登录，而不是以为自己在某个受支持的离线状态里。
  const displayName = signedIn
    ? session?.profile?.name ?? session?.profile?.email ?? "Vxture 用户"
    : "会话已失效";
  const subLine = signedIn
    ? session?.profile?.email ?? session?.org?.name ?? "已登录"
    : online
      ? "请重新登录以继续"
      : "未连接";

  /**
   * 三行环境事实，**与首页第一板块逐字一致**（名称、结论、细节都同一套词，
   * 中文不夹英文）：
   *   运行环境  就绪 · 版本 / 未连接
   *   数据加密  已加密 · DPAPI / 开发态 · 明文
   *   平台连接  已连接 · 工作区 / 未登录
   */
  const runtimeLine = online ? `已就绪${system?.version ? ` · Runtime ${system.version}` : ""}` : "未连接";
  const encryptionLine = system
    ? system.keyProtection === "dpapi"
      ? "已加密 · DPAPI"
      : "开发态 · 明文"
    : "…";
  const platformLine = signedIn
    ? `已连接${session?.workspace?.name ? ` · ${session.workspace.name}` : ""}`
    : "未登录";
  const avatarSrc = signedIn ? session?.profile?.picture : undefined;

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
              {/* 平台有头像就用平台的；没有再落到首字。 */}
              <Avatar>
                {avatarSrc && <AvatarImage src={avatarSrc} alt={displayName} />}
                <AvatarFallback>{displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <span className={`user-chip-dot${online ? "" : " off"}`} />
            </span>
            {!collapsed && (
              <>
                <span className="user-chip-name">{displayName}</span>
                <span className="user-chip-sub">
                  {signedIn
                    ? session?.profile?.email ??
                      session?.org?.name ??
                      "已登录"
                    : "未登录"}
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
            {...(avatarSrc ? { avatarSrc, avatarAlt: displayName } : {})}
            avatarFallback={displayName.slice(0, 1)}
            title={displayName}
            titleAside={
              <StatusBadge tone={signedIn ? "success" : "warning"} dot>
                {signedIn ? "已登录" : "需重新登录"}
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
            <ShellPanelRow icon="cpu" label="运行环境" value={runtimeLine} />
            <ShellPanelRow icon="shield-check" label="数据加密" value={encryptionLine} />
            <ShellPanelRow icon="buildings" label="平台连接" value={platformLine} />
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
