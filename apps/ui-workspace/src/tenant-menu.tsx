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
  Progress,
  ShellPanelContent,
  ShellPanelHeader,
  ShellPanelRow,
  ShellPanelSection,
  ShellPanelSectionTitle,
} from "@vxture/design-system";
import { Api, type QuotaUsage, type SessionInfo } from "./api";
import { consoleAppBaseOf } from "./platform-base";

export interface QuotaLine {
  key: string;
  label: string;
  used: number;
  limit: number;
  /** 展示用的格式化：额度按千分位，存储按字节单位。 */
  format: (n: number) => string;
}

/**
 * AI 额度专用格式化：千分位、不带小数，带上「点」这个单位（owner
 * 2026-09-16）——跟 storage 走 fmtBytes 自带单位（GB/MB…）是同一个道理，
 * 单位跟着各自的格式化函数走，配额行的文案模板（标题行 / 明细行）不用
 * 关心自己在拼哪一种配额。
 */
function fmt(n: number): string {
  return `${Math.round(n).toLocaleString("zh-CN")} 点`;
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
 * 平台配额用量 → 展示行。两条都常驻（owner 2026-09-16 改：此前两项都是零就
 * 整行隐藏，现在哪怕某项当前是 0/0 也照样露出来——「没有配额」本身就是一个
 * 要让用户看见的事实，不是要藏起来的边界情况；两条名字定死用英文，这两个
 * 概念本身就是英文术语，硬翻中文反而生造出新词。
 */
export function quotaLines(usage: QuotaUsage): QuotaLine[] {
  return [
    { key: "ai.credit", label: "AI Credits", ...usage.aiCredit, format: fmt },
    { key: "storage", label: "Storage Spaces", ...usage.storage, format: fmtBytes },
  ];
}

/**
 * 一条配额的三行版式（owner 2026-09-16 改版）：标题行（大字号标签 + 裸的
 * 用量数字，不带「已用/剩余」这类文字——标题行宽度有限，塞不下）、进度条、
 * 小字明细（已用 / 总量，文字说明留到这一行）。此前用 DS 的
 * `ShellPanelMeterRow` 只有两行，「已用 X / Y · 剩余 Z」三个数字全挤在标题行
 * 右侧一句话里——读起来是一坨，且行距很紧。现在把「概要数字」与「文字明细」
 * 拆开，图标贯通整行高度，行距也松开一档。
 */
function QuotaMeterRow({
  icon,
  label,
  line,
}: {
  icon: "database" | "coins";
  label: string;
  line: QuotaLine;
}) {
  const hasLimit = line.limit > 0;
  const percent = hasLimit ? Math.max(0, Math.min(100, (line.used / line.limit) * 100)) : 0;
  const headline = line.format(line.used);
  // 明细行常驻，哪怕总量是 0（owner 2026-09-16 三次纠正）：行本身已经不再因为
  // 0/0 就整段藏起来，明细行不该在同一个行里自相矛盾地又藏一次——「总量 0」
  // 跟「已用 0」一样，都是要让用户看见的事实，不是要吞掉的边界情况。
  const caption = `已用 ${line.format(line.used)}，总量 ${line.format(line.limit)}`;
  return (
    <div className="quota-meter-row">
      <span className="quota-meter-row-icon" aria-hidden="true">
        <Icon name={icon} size="sm" />
      </span>
      <div className="quota-meter-row-body">
        <div className="quota-meter-row-head">
          <span className="quota-meter-row-label">{label}</span>
          <span className="quota-meter-row-headline">{headline}</span>
        </div>
        <Progress value={percent} />
        <span className="quota-meter-row-caption">{caption}</span>
      </div>
    </div>
  );
}

export function TenantMenu({ api, session }: { api: Api; session: SessionInfo }) {
  const [open, setOpen] = useState(false);
  const [quota, setQuota] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ok"; lines: QuotaLine[] }
    | { status: "unavailable"; reason: string }
  >({ status: "idle" });

  // 「租户管理」落在 console-bff 本体上，不是官网 consoleBase（owner 2026-09-16
  // audit：与「用户中心」「配额用量」同一类错，见 user.tsx 的 consoleAppBase 说明）。
  const consoleAppBase = consoleAppBaseOf(session);
  const tenantName = session.org?.name ?? "未命名租户";
  const workspaceName = session.workspace?.name ?? "未选定工作区";

  // 打开时才去问，关上不刷新：菜单不是常驻面板，没必要每 45s 拉一次。
  useEffect(() => {
    if (!open) return;
    if (!session.entitlementsConfigured) {
      setQuota({ status: "unavailable", reason: "暂时读不到" });
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

  // 身份卡（ShellPanelHeader）用租户自己的 logo——标题栏那颗触发按钮不用
  // （owner 2026-09-16：头部保持通用图标，logo 只在弹出面板里）。取不到就是
  // `null`，落到 avatarFallback（首字）。object URL 只在这一次打开期间存活，
  // 关闭或换租户就撤，不然是内存泄漏。
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let url: string | null = null;
    let alive = true;
    api
      .orgLogo()
      .then((blob) => {
        if (!alive || !blob) return;
        url = URL.createObjectURL(blob);
        setLogoUrl(url);
      })
      .catch(() => {
        /* 拿不到就落到首字兜底，不打扰配额那一路的状态机。 */
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      setLogoUrl(null);
    };
  }, [open, api]);

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
        {/* 1. 租户 + 工作区。身份卡用租户自己的 logo（owner 2026-09-16）；
            拿不到就落到首字，不落到通用 icon——那是标题栏那颗触发按钮的事。 */}
        <ShellPanelHeader
          {...(logoUrl ? { avatarSrc: logoUrl, avatarAlt: tenantName } : {})}
          avatarFallback={tenantName.slice(0, 1)}
          title={tenantName}
          metaRows={[{ key: "ws", icon: "folder-open" as const, content: workspaceName }]}
        />
        {/* 2. 配额（只读） */}
        <ShellPanelSection className="quota-section">
          <ShellPanelSectionTitle>配额</ShellPanelSectionTitle>
          {quota.status === "loading" && <ShellPanelRow icon="cpu" label="正在读取…" />}
          {quota.status === "unavailable" && <ShellPanelRow icon="cpu" label="配额" value={quota.reason} />}
          {quota.status === "ok" &&
            quota.lines.map((line) => (
              <QuotaMeterRow
                key={line.key}
                icon={line.key === "storage" ? "database" : "coins"}
                label={line.label}
                line={line}
              />
            ))}
        </ShellPanelSection>
        {/* 3. 租户管理 */}
        <ShellPanelSection>
          <ShellPanelRow
            icon="settings"
            label="租户管理"
            href={`${consoleAppBase}/tenant-settings`}
            newTab
            trailingIcon="external-link"
          />
        </ShellPanelSection>
      </ShellPanelContent>
    </Popover>
  );
}
