/**
 * 标题栏的租户 / 工作区菜单（owner 2026-09-04 定的三项，参考平台端、按桌面端
 * 简化）：
 *
 *   1. 租户名称 + 工作区名称
 *   2. AI 配额（只读）
 *   3. 租户管理 → 平台链接
 *
 * 配额是**只读展示**，不门控、不计量、不执行 limits（ADR-006 及其 2026-09-04
 * 修订）：数字来自 C2 权益信封的 `quota_pools`，由守护进程代理，45s TTL，
 * 桌面端不缓存不落库。它是平台上那个数字的一面镜子，不是本地的判断 —— 所以
 * 拿不到时就说拿不到，不用旧数字装作还在。
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
import { Api, type EntitlementsBatch, type SessionInfo } from "./api";

/** 配额池的展示名。键来自平台的 metric_key；认不出的照原样显示，不猜。 */
const METRIC_LABELS: Record<string, string> = {
  "ai.credit": "AI 额度",
  "ai.credits": "AI 额度",
  "ai.tokens": "AI 用量",
  "ai.requests": "AI 调用",
};

export interface QuotaLine {
  metric: string;
  label: string;
  limit: number;
  remaining: number;
}

/**
 * 把各产品信封里的配额池合成按指标一行。同一个池会出现在多个产品的信封里
 * （共享池按 priority 瀑布扣减），**完全相同的条目只算一次**，否则一个共享池
 * 会被数成两份。
 */
export function summarizeQuota(batch: EntitlementsBatch): QuotaLine[] {
  const seen = new Set<string>();
  const byMetric = new Map<string, QuotaLine>();
  for (const env of Object.values(batch.entitlements)) {
    for (const pool of env.quota_pools ?? []) {
      const key = `${pool.metric}|${pool.limit}|${pool.remaining}|${pool.priority}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const line = byMetric.get(pool.metric) ?? {
        metric: pool.metric,
        label: METRIC_LABELS[pool.metric] ?? pool.metric,
        limit: 0,
        remaining: 0,
      };
      line.limit += pool.limit;
      line.remaining += pool.remaining;
      byMetric.set(pool.metric, line);
    }
  }
  return [...byMetric.values()].sort((a, b) => a.metric.localeCompare(b.metric));
}

/** 千分位，额度不带小数。 */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("zh-CN");
}

export function TenantMenu({
  api,
  session,
  productIds,
}: {
  api: Api;
  session: SessionInfo;
  productIds: string[];
}) {
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
    if (productIds.length === 0) {
      setQuota({ status: "unavailable", reason: "本机没有已订阅的智能体，暂无配额可看" });
      return;
    }
    let alive = true;
    setQuota({ status: "loading" });
    api
      .entitlements(productIds)
      .then((batch) => alive && setQuota({ status: "ok", lines: summarizeQuota(batch) }))
      .catch((e: Error) => alive && setQuota({ status: "unavailable", reason: e.message }));
    return () => {
      alive = false;
    };
  }, [open, api, productIds, session.entitlementsConfigured]);

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
        {/* 2. AI 配额（只读） */}
        <ShellPanelSection>
          <ShellPanelSectionTitle>AI 配额</ShellPanelSectionTitle>
          {quota.status === "loading" && <ShellPanelRow icon="cpu" label="正在读取…" />}
          {quota.status === "unavailable" && <ShellPanelRow icon="cpu" label="AI 配额" value={quota.reason} />}
          {quota.status === "ok" && quota.lines.length === 0 && (
            <ShellPanelRow icon="cpu" label="AI 配额" value="平台未下发配额池" />
          )}
          {quota.status === "ok" &&
            quota.lines.map((line) => (
              /* 与平台租户面板同一种读法（TenantPanel：进度条是**已用**占配额的比例，
                 文案「已用 / 配额」），桌面端多写一个「剩余」—— 用户来看的就是还剩多少。 */
              <ShellPanelMeterRow
                key={line.metric}
                icon="coins"
                label={line.label}
                valueLabel={
                  line.limit > 0
                    ? `已用 ${fmt(line.limit - line.remaining)} / ${fmt(line.limit)} · 剩余 ${fmt(line.remaining)}`
                    : `剩余 ${fmt(line.remaining)}`
                }
                percent={line.limit > 0 ? Math.max(0, Math.min(100, ((line.limit - line.remaining) / line.limit) * 100)) : 0}
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
