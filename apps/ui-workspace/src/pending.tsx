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

/** 轮询间隔。检查点由后台任务推进，界面这边没有推送通道。 */
const POLL_MS = 5000;

const KIND_LABEL: Record<PendingConfirmation["kind"], string> = {
  context_confirm: "确认要送出的资料",
  tool_ask: "批准一次工具调用",
  verification_review: "人工复核",
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
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api]);
  return rows;
}

/** 相对时间。等得越久越该被看见，绝对时间戳传达不了这件事。 */
function waitedFor(raisedAt: string): string {
  const ms = Date.now() - new Date(raisedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "刚刚";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `已等 ${min} 分钟`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `已等 ${hours} 小时`;
  return `已等 ${Math.floor(hours / 24)} 天`;
}

export function PendingInbox({
  rows,
  onOpen,
}: {
  rows: PendingConfirmation[];
  onOpen: (projectId: string) => void;
}) {
  const count = rows.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="pending-trigger"
          aria-label={count > 0 ? `${count} 项等待你确认` : "没有待确认的事项"}
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
              title="没有在等你的事"
              description="任务停下来需要你确认时，会出现在这里，并同时发出系统通知。"
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
                        {KIND_LABEL[r.kind]}
                      </span>
                    </span>
                    <span className="pending-item-age">
                      {waitedFor(r.raisedAt)}
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
