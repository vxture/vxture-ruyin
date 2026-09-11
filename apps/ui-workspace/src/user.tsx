/**
 * User slot - the sidebar-footer identity strip. Built from the DS ShellPanel
 * loose parts (the docs' "散件" path): a full-width identity chip triggers a
 * ShellPanelContent popover carrying identity and account actions. (The
 * runtime facts moved to the header's Runtime menu on 2026-09-11 —
 * runtime-menu.tsx.) Identity is live (C1: PKCE via the system browser,
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
import { Api, type SessionInfo } from "./api";

/** Poll /auth/session until signedIn flips (login completes in the browser). */
const LOGIN_POLL_MS = 2000;
const LOGIN_POLL_MAX_MS = 5 * 60 * 1000;

export function UserSlot({
  api,
  productIds,
  collapsed,
  onOpenSettings,
  onSignedOut,
}: {
  api: Api;
  productIds: string[];
  collapsed?: boolean;
  onOpenSettings: () => void;
  /**
   * 退出登录之后调用 —— 由会话闸门（login.tsx 的 `SessionGate`）重读会话。
   *
   * **必填，不是可选。** 这一格里的「退出登录」只能改到这一格自己的状态，
   * 而决定「显示登录页还是工作台」的是闸门，且闸门只在挂载时读过一次会话。
   * 少了这个回调，退出之后工作台会带着一个已经不成立的登录态继续站在屏幕上：
   * 面板翻成未登录，背后整个界面照常可点，设置 › 账号还照旧显示着人
   * （owner 2026-09-10 报的就是这一幕）。写成必填，是为了让下一个挂载
   * `UserSlot` 的人在**编译期**就被拦住，而不是等到有人真去点那个按钮。
   */
  onSignedOut: () => void;
}) {
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
    void refreshSession();
    return () => {
      alive = false;
      clearInterval(timer);
      if (pollRef.current !== undefined) clearInterval(pollRef.current);
    };
  }, [api, refreshSession]);

  // 订阅那一行已去掉（owner 2026-09-03 定）：产品级的订阅事实在首页的产品卡上。
  // 环境那三件事原本也在这一格，2026-09-11 挪去了标题栏的 Runtime 下拉 —— 这一格
  // 如今只管身份与账户。productIds 仍在签名里，是为了不动 workbench 的调用；
  // 这里不再用它。
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
    } catch {
      // 退出失败不拦人，也不炸出一个没人接的 rejection：本地会话到底还在不在，
      // 由守护进程说了算，而下面那一次重读就是去问它的。
    } finally {
      setBusy(false);
      // 退出必须传到会话闸门那里去，这一格自己刷新是不够的 —— 见 onSignedOut
      // 的说明。**放在 finally 里是有意的**：logout 失败时也要通知，因为闸门
      // 做的是「重读会话」而不是「假定已退出」；守护进程说还登着，它就什么
      // 都不变。反过来若只在成功路径上通知，一次失败的退出会让界面停在一个
      // 谁也没读过的状态里。
      //
      // 这里**不**再 refreshSession()：那会让面板先闪一下「会话已失效」，
      // 而这是用户自己按的退出，不是掉线。两者在用户那里不是一回事。
      onSignedOut();
    }
  };

  const signedIn = session?.signedIn === true;
  // 未登录进不来工作台（登录页是唯一入口），所以走到这里只有一种情况：
  // 会话在使用中失效了。那不是一种「模式」，是掉线 —— 说清楚它是什么，
  // 用户才知道该重新登录，而不是以为自己在某个受支持的离线状态里。
  /**
   * 侧栏那一格只放**显示名**，不放邮箱（owner 2026-09-04）。
   *
   * 邮箱是账号的**标识**，不是称呼：它长、会换行、而且是个人信息 —— 侧栏一直
   * 摊在屏幕上，截图、投屏、旁边坐个人都能看见。要认账号，菜单里有（点开才看
   * 得到），配置 › 账号里也有。没有显示名时落到用户名，仍然不落到邮箱。
   */
  const displayName = signedIn
    ? session?.profile?.name ?? session?.profile?.username ?? "Vxture 用户"
    : "会话已失效";
  /**
   * 菜单里那一行（**不是**侧栏那一格）。这里放邮箱是对的：菜单要回答「我登的
   * 是哪个账号」，而它只在点开时出现，不是一直摊在屏幕上。
   */
  const subLine = signedIn
    ? session?.profile?.email ?? session?.org?.name ?? "已登录"
    : online
      ? "请重新登录以继续"
      : "未连接";

  // 运行环境 / 数据加密 / 平台连接三行**挪到标题栏的 Runtime 下拉里了**（runtime-menu.tsx，
  // owner 2026-09-11）。它们是运行时的事实，不是账户的事实；留在这里就是第三份
  // 与首页各自漂的副本。这一格只管身份与账户。
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
