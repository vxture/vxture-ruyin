/**
 * 未决确认入口（MVP M4）。
 *
 * 任务停在等人那一刻若无人知晓，等于没停。未决确认原先只在它所属的那**一个**
 * 任务界面里看得到——也就是说，用户必须已经在看那个唯一会告诉他的地方。
 *
 * 所以这个入口有两条硬要求：
 *   1. **常驻**：在哪个视图都看得见，否则又变成「要先找对地方」
 *   2. **可直达**：点一条就到能做决定的地方，而不是只告诉你"有事"
 *
 * 与桌面壳的系统通知看的是同一份事实（daemon `GET /pending`），所以两边不会
 * 各说各话。
 */

import { useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  Icon,
  Popover,
  PopoverTrigger,
  ShellPanelContent,
  ShellPanelSection,
} from "@vxture/design-system";
import { Api, type PendingConfirmation } from "./api";
import { useT, type MessageKey, type TFn } from "./i18n";

/** 轮询间隔。检查点由后台任务推进，界面这边没有推送通道。 */
const POLL_MS = 30_000;

/** 种类 → 目录键。**词表本身不进目录** —— 键是代码里的常量，句子才是文案。 */
const KIND_KEY: Record<PendingConfirmation["kind"], MessageKey> = {
  context_confirm: "pending.kind.context_confirm",
  tool_ask: "pending.kind.tool_ask",
  verification_review: "pending.kind.verification_review",
  state_transition: "pending.kind.state_transition",
};

export function usePending(api: Api): PendingConfirmation[] {
  const [rows, setRows] = useState<PendingConfirmation[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .pending()
        .then((r) => {
          if (alive) setRows(r);
        })
        // 拉不到就保持上一次的结果：把清单清空会让「有事等你」凭空消失，
        // 那比暂时旧一点危险得多。
        .catch(() => {});
    void tick();
    // 事件到了就重拉（TD-027）；轮询留着兜底 —— 流断掉的样子是「一直没有事件」，
    // 而那和「一切正常」长得一模一样。
    const stop = api.subscribe(() => void tick());
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      stop();
      clearInterval(timer);
    };
  }, [api]);
  return rows;
}

/**
 * 相对时间。等得越久越该被看见，绝对时间戳传达不了这件事。
 *
 * 挑哪一档（刚刚 / 分 / 时 / 天）是**逻辑**，与语言无关，所以留在这里；
 * 那一档说成什么话是**文案**，交给目录。英文的单复数由 `count` 自动分支。
 */
export function waitedFor(raisedAt: string, t: TFn, now = Date.now()): string {
  const ms = now - new Date(raisedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return t("pending.waited.justNow");
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t("pending.waited.justNow");
  if (min < 60) return t("pending.waited.minutes", { count: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return t("pending.waited.hours", { count: hours });
  return t("pending.waited.days", { count: Math.floor(hours / 24) });
}

export function PendingInbox({
  rows,
  onOpen,
}: {
  rows: PendingConfirmation[];
  onOpen: (projectId: string) => void;
}) {
  const count = rows.length;
  const t = useT();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="pending-trigger"
          aria-label={
            count > 0 ? t("pending.aria.count", { count }) : t("pending.aria.none")
          }
        >
          <Icon name="bell" size="sm" />
          {count > 0 && <span className="pending-count">{count}</span>}
        </Button>
      </PopoverTrigger>
      <ShellPanelContent side="bottom" align="end" sideOffset={8}>
        <ShellPanelSection>
          {count === 0 ? (
            <EmptyState
              icon="check"
              title={t("pending.empty.title")}
              description={t("pending.empty.desc")}
            />
          ) : (
            <ul className="pending-list">
              {rows.map((r) => (
                <li key={r.checkpointId}>
                  <button
                    type="button"
                    className="pending-item"
                    onClick={() => onOpen(r.projectId)}
                  >
                    <span className="pending-item-main">
                      <span className="pending-item-title">{r.projectName}</span>
                      <span className="pending-item-kind">
                        {t(KIND_KEY[r.kind])}
                      </span>
                    </span>
                    <span className="pending-item-age">
                      {waitedFor(r.raisedAt, t)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ShellPanelSection>
      </ShellPanelContent>
    </Popover>
  );
}
