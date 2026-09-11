/**
 * 标题栏的 Runtime 下拉（owner 2026-09-11 定）：徽标常显，点开看运行环境。
 *
 * 形状照租户按钮（tenant-menu.tsx）：**名字常显、详情下拉**。徽标本身保持短
 * （`● Runtime 0.1.0 ▾`）—— 这次改版把搜索框收成图标，是为了给 header 让出地方，
 * 不该又被一串运行信息占回去。
 *
 * **三行环境事实是从左下角用户面板「挪」过来的，不是抄一份。** 同一组事实此前在
 * 首页第一板块与用户面板各显示一遍（后者的注释原话：「与首页第一板块逐字一致」）；
 * 再在这里放一份，就是第三份各自漂的副本。它们本来就是**运行时**的事实，不是
 * **账户**的事实 —— 放在「Runtime ▾」底下名正言顺，用户面板只剩身份与账户。
 * 词句沿用用户面板那一套（名称、结论、细节同一套词，中文不夹英文）。
 *
 * **顺带修一个死角**：守护进程连不上时，徽标原来只是一个红色的「未连接」—— 点了
 * 没反应，也不说为什么。现在点开能看到它是什么、会怎样。
 */

import { useEffect, useState } from "react";
import {
  Icon,
  Popover,
  PopoverTrigger,
  ShellPanelContent,
  ShellPanelRow,
  ShellPanelSection,
  StatusBadge,
} from "@vxture/design-system";
import type { Api, SessionInfo, SystemInfo } from "./api";

export function RuntimeMenu({
  api,
  health,
  session,
}: {
  api: Api;
  health: { ok: boolean; version?: string };
  /** 已登录时的会话；未登录时为 undefined（workbench 的 useWorkspaceSession 就是这么给的）。 */
  session?: SessionInfo | undefined;
}) {
  const [system, setSystem] = useState<SystemInfo | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .system()
      .then((s) => alive && setSystem(s))
      .catch(() => {
        /* 拿不到就显示省略号 —— 不猜一个加密状态出来 */
      });
    return () => {
      alive = false;
    };
  }, [api]);

  const online = health.ok;
  const signedIn = session?.signedIn === true;
  // 三行的词与原用户面板逐字一致（那一套又与首页第一板块逐字一致）。
  const runtimeLine = online ? `已就绪${health.version ? ` · Runtime ${health.version}` : ""}` : "未连接";
  // DPAPI 是主密钥的保护，不是加密算法（见 home.tsx 同处注释）。
  const encryptionLine = system
    ? system.keyProtection === "dpapi"
      ? "已加密 · SQLCipher"
      : "开发态 · 主密钥明文"
    : "…";
  const platformLine = signedIn
    ? `已连接${session?.workspace?.name ? ` · ${session.workspace.name}` : ""}`
    : "未登录";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="app-runtime-trigger"
          aria-label={online ? `运行时 · ${health.version ?? ""}` : "运行时 · 未连接"}
        >
          <StatusBadge tone={online ? "success" : "danger"} dot>
            {online ? `Runtime ${health.version ?? ""}` : "未连接"}
          </StatusBadge>
          <Icon name="caret-up-down" size="xs" className="app-workspace-caret" />
        </button>
      </PopoverTrigger>
      <ShellPanelContent side="bottom" align="start" sideOffset={8}>
        {/* 第一段不画分隔线：上面没有别的段，那条虚线只会在面板顶上空出一条带。 */}
        <ShellPanelSection divided={false}>
          {/*
           * 结论放在名称**下面**（description），不放右边（value）。value 在 DS 里不收缩，
           * 版本号一长（beta 版本带日期与序号）挤掉的是左边的名称 —— 观察台里「运行环境」
           * 就被挤成了「运…」。放下面时最坏只是细节省略，名称永远完整。
           */}
          <ShellPanelRow icon="cpu" label="运行环境" description={runtimeLine} />
          <ShellPanelRow icon="shield-check" label="数据加密" description={encryptionLine} />
          <ShellPanelRow icon="buildings" label="平台连接" description={platformLine} />
        </ShellPanelSection>
        {!online && (
          <ShellPanelSection>
            {/* 说它是什么、会怎样 —— 一个只会变红的徽标不告诉用户该等还是该动手。 */}
            <p className="text-body-sm text-muted-foreground app-runtime-note">
              界面暂时连不上本机的运行时，所以拿不到任何数据。桌面应用会自动重连；
              一直连不上的话，关掉 RUYIN 再从开始菜单打开一次。
            </p>
          </ShellPanelSection>
        )}
      </ShellPanelContent>
    </Popover>
  );
}
