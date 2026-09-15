/**
 * 检查更新的共享状态（owner 2026-09-15，当天两次修正）：自动检查（开着这个
 * 偏好时问一次）与手动点「检查更新」**看的是同一份状态** —— 谁问到的都写这里，
 * 两处展示都不用关心是谁触发的。
 *
 * 「自动检查」的时机：**工作台挂载时**（登录后整个应用起来那一刻），不再挂在
 * 设置页 —— 原来挂在设置页只在打开设置页时才问一次，被指出来不是字面的「软件
 * 启动时」；工作台在一次登录会话里只挂载一次，这才是真正更早、总会经过的挂载点。
 * 此后只有手动点「检查更新」会再问一次。
 *
 * 两处展示：`UpdateToast` 是启动时那次自动检查专用的右下角浮层，**只在「有新
 * 版本」时弹出**（已是最新 / 没查到 / 检查失败都没有值得打断用户的动作，弹出来
 * 反而是噪音）；`UpdateNotice` 是设置页顶部那条，四种结果都显示——手动点「检查
 * 更新」问的就是这一条，用户主动点了就该看到完整结果，不止「有更新」这一种。
 *
 * 只问一次：**不下载、不安装**，本应用从不自动做后面两件事（软件更新页「安装
 * 方式」板块那句话不变）。
 */
import { useEffect, useRef, useState } from "react";
import { Button, Icon } from "@vxture/design-system";
import { Api, type UpdateCheck } from "./api";

const AUTO_CHECK_KEY = "ruyin-update-auto-check";

function readAutoCheck(): boolean {
  try {
    // 缺省开：这是一次不下载、不安装的网络问询，风险很低，而「装好就默认能看到
    // 有没有更新」是大多数桌面软件的缺省期待。
    return localStorage.getItem(AUTO_CHECK_KEY) !== "0";
  } catch {
    return true;
  }
}

export interface UpdateCheckState {
  autoCheck: boolean;
  setAutoCheck: (v: boolean) => void;
  busy: boolean;
  result: UpdateCheck | null;
  failed: string | null;
  /** 手动触发一次；自动检查内部也调它，两条路径共用同一份状态与同一段逻辑。 */
  check: () => Promise<void>;
  /** 关掉页面顶部那条提示。「有新版本」那一档等价于「放弃这次更新」——不装。 */
  dismiss: () => void;
}

export function useUpdateCheck(api: Api): UpdateCheckState {
  const [autoCheck, setAutoCheckState] = useState(readAutoCheck);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // 这个组件实例这次挂载期间只自动问一次——不用它来判断「本次启动问没问过」，
  // 那需要一个挂在更早处的单例，眼下没有。
  const autoFired = useRef(false);

  const setAutoCheck = (v: boolean) => {
    try {
      localStorage.setItem(AUTO_CHECK_KEY, v ? "1" : "0");
    } catch {
      /* 存不进去就不存——这是个偏好，不是必须落盘的东西。 */
    }
    setAutoCheckState(v);
  };

  const check = async () => {
    setBusy(true);
    setFailed(null);
    try {
      setResult(await api.checkUpdate());
    } catch (e) {
      // 连守护进程都没问到，同样不能说成「最新」。
      setResult(null);
      setFailed(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoCheck && !autoFired.current) {
      autoFired.current = true;
      void check();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  return {
    autoCheck,
    setAutoCheck,
    busy,
    result,
    failed,
    check,
    dismiss: () => {
      setResult(null);
      setFailed(null);
    },
  };
}

/**
 * 页面顶部的提示条（owner 2026-09-15：来源可以是自动检查也可以是手动检查，
 * 都落在这一条上）。
 *
 * 「有新版本」单独一档：给的是**两个动作**（升级 / 关闭=放弃这次更新），不是
 * 「关掉通知」那种叉号——这条提示本身就在问一件事，答案要么去升级要么不理它。
 * 其余几档（已是最新 / 没查到 / 检查失败）没有可做的动作，只给一个叉号关掉。
 */
export function UpdateNotice({ state }: { state: UpdateCheckState }) {
  const { result, failed, dismiss } = state;
  if (!result && !failed) return null;

  if (failed) {
    return (
      <div className="set-callout update-notice" role="status">
        <Icon name="warning" size="sm" />
        <span>检查失败：{failed}</span>
        <button type="button" className="notice-bar-close" aria-label="关闭提醒" onClick={dismiss}>
          <Icon name="x" size="xs" />
        </button>
      </div>
    );
  }

  if (result!.status === "available") {
    return (
      <div className="set-callout set-callout--info update-notice" role="status">
        <Icon name="arrow-down" size="sm" />
        <span>
          有新版本 <span className="mono">{result!.latest}</span>
          （当前 <span className="mono">{result!.current}</span>
          {result!.channel && (
            <>
              ，<span className="mono">{result!.channel}</span> 渠道
            </>
          )}
          ）
        </span>
        <span className="update-notice-actions">
          {result!.downloadUrl ? (
            <Button size="sm" onClick={() => window.open(result!.downloadUrl, "_blank", "noopener")}>
              升级
            </Button>
          ) : (
            // **不拼一个猜出来的地址**：更新源里没写文件名，点下去只会得到 404。
            <span className="text-body-sm">这次没能拿到安装包地址（更新源里没写文件名）</span>
          )}
          <Button variant="ghost" size="sm" onClick={dismiss}>
            关闭
          </Button>
        </span>
      </div>
    );
  }

  if (result!.status === "current") {
    return (
      <div className="set-callout set-callout--success update-notice" role="status">
        <Icon name="check" size="sm" />
        <span>已是最新（{result!.latest}）</span>
        <button type="button" className="notice-bar-close" aria-label="关闭提醒" onClick={dismiss}>
          <Icon name="x" size="xs" />
        </button>
      </div>
    );
  }

  // status === "unreachable"
  return (
    <div className="set-callout set-callout--warning update-notice" role="status">
      <Icon name="warning" size="sm" />
      <span>没查到——{result!.reason}。这不代表你已是最新，只代表这次没问到。</span>
      <button type="button" className="notice-bar-close" aria-label="关闭提醒" onClick={dismiss}>
        <Icon name="x" size="xs" />
      </button>
    </div>
  );
}

/**
 * 启动时那次自动检查的右下角浮层（owner 2026-09-15）：**只在「有新版本」时弹**，
 * 其余三档（已是最新 / 没查到 / 检查失败）没有动作可做，静默问完就好，弹出来
 * 打断用户反而是噪音——这与设置页顶部那条 `UpdateNotice`（手动点了就该看到
 * 完整结果）故意不对称。
 *
 * 与 `UpdateNotice` 共用同一份 `state`：升级 / 关闭是同一对回调，关掉这个浮层
 * 也会让设置页顶部那条一起消失（同一份「已读」）。
 */
export function UpdateToast({ state }: { state: UpdateCheckState }) {
  const { result, dismiss } = state;
  if (result?.status !== "available") return null;

  return (
    <div className="update-toast" role="status">
      <div className="update-toast-head">
        <Icon name="arrow-down" size="sm" />
        <span>发现新版本</span>
        <button type="button" className="notice-bar-close" aria-label="关闭提醒" onClick={dismiss}>
          <Icon name="x" size="xs" />
        </button>
      </div>
      <p className="update-toast-body">
        <span className="mono">{result.latest}</span>
        （当前 <span className="mono">{result.current}</span>
        {result.channel && (
          <>
            ，<span className="mono">{result.channel}</span> 渠道
          </>
        )}
        ）
      </p>
      <div className="update-toast-actions">
        {result.downloadUrl ? (
          <Button size="sm" onClick={() => window.open(result.downloadUrl, "_blank", "noopener")}>
            升级
          </Button>
        ) : (
          <span className="text-body-sm">这次没能拿到安装包地址</span>
        )}
        <Button variant="ghost" size="sm" onClick={dismiss}>
          关闭
        </Button>
      </div>
    </div>
  );
}
