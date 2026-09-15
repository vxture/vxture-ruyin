/**
 * 标题栏的租户 / 工作区菜单（owner 2026-09-04 定的三项，参考平台端、按桌面端
 * 简化）：
 *
 *   1. 租户名称 + 工作区名称
 *   2. 配额（只读）
 *   3. 租户管理 → 平台链接
 *
 * 配额是**只读展示**，不门控、不计量、不执行 limits（ADR-006 及其 2026-09-04
 * 修订）：数字来自平台的配额用量读（console `/api/subscription/quota-usage`，
 * 与平台租户面板同一份），由守护进程代读，桌面端不缓存不落库。它是平台上那个
 * 数字的一面镜子，不是本地的判断 —— 所以拿不到时就说拿不到，不用旧数字装作还在。
 *
 * 此前这里按「本机已装产品」逐个拉 C2 信封再合并配额池：那条路走的是旧 OIDC
 * 令牌 + tailnet-only 的 platform-api，登录改走会话之后它一次都没成功过，而且
 * 问的问题也不对 —— 配额属于工作区，不属于本机碰巧装了哪几个产品。
 */

import { useEffect, useState } from "react";
import {
  Icon,
  Popover,
  PopoverTrigger,
  ShellPanelContent,
  ShellPanelHeader,
  ShellPanelMeterRow,
  ShellPanelRow,
  ShellPanelSection,
  ShellPanelSectionTitle,
} from "@vxture/design-system";
import { Api, type QuotaUsage, type SessionInfo } from "./api";

export interface QuotaLine {
  key: string;
  label: string;
  used: number;
  limit: number;
  /** 展示用的格式化：额度按千分位，存储按字节单位。 */
  format: (n: number) => string;
}

/** 千分位，额度不带小数。 */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("zh-CN");
}

/** 字节 → 人读单位。存储是字节口径，直接显示一串数字没人读得懂。 */
export function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/**
 * 平台配额用量 → 展示行。两项都是零（没有生效订阅时平台回全零）就是没有配额可看，
 * 回空数组让界面说出来，而不是画两根空进度条。
 */
export function quotaLines(usage: QuotaUsage): QuotaLine[] {
  const lines: QuotaLine[] = [
    { key: "ai.credit", label: "AI 额度", ...usage.aiCredit, format: fmt },
    { key: "storage", label: "存储", ...usage.storage, format: fmtBytes },
  ];
  return lines.filter((l) => l.limit > 0 || l.used > 0);
}

export function TenantMenu({ api, session }: { api: Api; session: SessionInfo }) {
  const [open, setOpen] = useState(false);
  const [quota, setQuota] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ok"; lines: QuotaLine[] }
    | { status: "unavailable"; reason: string }
  >({ status: "idle" });

  const consoleBase = session.consoleBase || "https://vxture.com";
  const tenantName = session.org?.name ?? "未命名租户";
  const workspaceName = session.workspace?.name ?? "未选定工作区";

  // 打开时才去问，关上不刷新：菜单不是常驻面板，没必要每 45s 拉一次。
  useEffect(() => {
    if (!open) return;
    if (!session.entitlementsConfigured) {
      setQuota({ status: "unavailable", reason: "权益服务未接通" });
      return;
    }
    let alive = true;
    setQuota({ status: "loading" });
    api
      .quotaUsage()
      .then((usage) => alive && setQuota({ status: "ok", lines: quotaLines(usage) }))
      .catch((e: Error) => alive && setQuota({ status: "unavailable", reason: e.message }));
    return () => {
      alive = false;
    };
  }, [open, api, session.entitlementsConfigured]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="app-workspace" title={`租户 ${tenantName} · 工作区 ${workspaceName}`}>
          <Icon name="buildings" size="xs" />
          <span className="app-workspace-name">{workspaceName}</span>
          <Icon name="caret-up-down" size="xs" className="app-workspace-caret" />
        </button>
      </PopoverTrigger>
      <ShellPanelContent side="bottom" align="end" sideOffset={8}>
        {/* 1. 租户 + 工作区 */}
        <ShellPanelHeader
          icon="buildings"
          title={tenantName}
          metaRows={[{ key: "ws", icon: "folder-open" as const, content: `工作区：${workspaceName}` }]}
        />
        {/* 2. 配额（只读） */}
        <ShellPanelSection>
          <ShellPanelSectionTitle>配额</ShellPanelSectionTitle>
          {quota.status === "loading" && <ShellPanelRow icon="cpu" label="正在读取…" />}
          {quota.status === "unavailable" && <ShellPanelRow icon="cpu" label="配额" value={quota.reason} />}
          {quota.status === "ok" && quota.lines.length === 0 && (
            <ShellPanelRow icon="cpu" label="配额" value="当前工作区没有生效的配额" />
          )}
          {quota.status === "ok" &&
            quota.lines.map((line) => (
              /* 与平台租户面板同一种读法（进度条是**已用**占配额的比例，文案「已用 / 配额」），
                 桌面端多写一个「剩余」—— 用户来看的就是还剩多少。 */
              <ShellPanelMeterRow
                key={line.key}
                icon={line.key === "storage" ? "database" : "coins"}
                label={line.label}
                valueLabel={
                  line.limit > 0
                    ? `已用 ${line.format(line.used)} / ${line.format(line.limit)} · 剩余 ${line.format(Math.max(0, line.limit - line.used))}`
                    : `已用 ${line.format(line.used)}`
                }
                percent={line.limit > 0 ? Math.max(0, Math.min(100, (line.used / line.limit) * 100)) : 0}
              />
            ))}
        </ShellPanelSection>
        {/* 3. 租户管理 */}
        <ShellPanelSection>
          <ShellPanelRow
            icon="settings"
            label="租户管理"
            href={`${consoleBase}/zh-CN/tenant-settings`}
            newTab
            trailingIcon="external-link"
          />
        </ShellPanelSection>
      </ShellPanelContent>
    </Popover>
  );
}
