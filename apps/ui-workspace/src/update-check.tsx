/**
 * 检查更新的共享状态与页面顶部那条提示（owner 2026-09-15）：自动检查（开着这个
 * 偏好时，本次打开设置页问一次）与手动点「检查更新」**看的是同一份状态** ——
 * 谁问到的都写这里，提示条不用关心是谁触发的。
 *
 * 「自动检查」的时机：**本次打开设置页时**，不是「每次启动软件」那么早 ——
 * 应用没有一个更早、且总会经过的挂载点可以钩这件事，而检查结果眼下也只有设置页
 * 这一处地方能展示。行为对用户来说足够接近："每次进来看一眼有没有更新"。
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
