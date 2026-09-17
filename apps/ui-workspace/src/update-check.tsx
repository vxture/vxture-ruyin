/**
 * 检查更新的共享状态（owner 2026-09-15，当天两次修正；2026-09-16 第三次：手动
 * 检查必须始终有反馈）：自动检查（开着这个偏好时问一次）与手动点「检查更新」
 * **看的是同一份状态** —— 谁问到的都写这里，两处展示都不用关心是谁触发的，
 * 只多记一件事：**这次是不是手动问的**（`manual`）。
 *
 * 「自动检查」的时机：**工作台挂载时**（登录后整个应用起来那一刻），不再挂在
 * 设置页 —— 原来挂在设置页只在打开设置页时才问一次，被指出来不是字面的「软件
 * 启动时」；工作台在一次登录会话里只挂载一次，这才是真正更早、总会经过的挂载点。
 * 此后只有手动点「检查更新」会再问一次。
 *
 * 两处展示：`UpdateToast` 是启动时那次自动检查专用的右下角浮层，**只在「有新
 * 版本」时弹出**（已是最新 / 没查到 / 检查失败都没有值得打断用户的动作，弹出来
 * 反而是噪音）；`UpdateNotice` 是设置页顶部那条——手动点「检查更新」之后**必须
 * 每次都有反馈**（点了按钮却什么都没发生，用户会以为按钮坏了），四种结果全显示；
 * 而自动检查命中 `unreachable` 时仍然不显示（owner 2026-09-16 明确要求删掉过
 * 一次：本仓从未发布过 stable，自动检查天天撞见它只会是噪音）——同一个状态，
 * 手动问的要给回应，自动问的不打扰，取决于 `manual` 这个标记，不是状态本身。
 *
 * 只问一次：**不下载、不安装**，本应用从不自动做后面两件事（软件更新页「安装
 * 方式」板块那句话不变）。
 */
import { useEffect, useRef, useState } from "react";
import { Button, Icon } from "@vxture/design-system";
import { Api, type UpdateCheck } from "./api";
import { useT, type MessageKey, type TFn } from "./i18n";

const AUTO_CHECK_KEY = "ruyin-update-auto-check";

/**
 * 渠道名，用用户认得的词说（owner 2026-09-17）。
 *
 * **渠道必须写在明面上**（TD-021，`lint:update-policy` 守着）：用户可能正在装
 * 一个测试版而以为自己用的是正式版。所以要改的只是措辞——`stable` / `beta`
 * 是发布侧的词，「正式版」「测试版」才是用户读得懂的同一件事。
 *
 * 认不出来的值**原样显示**：编一个好听的名字比显示原值更糟，那会把一个未知
 * 渠道说成正式版。
 */
export function channelLabel(t: TFn, channel?: string): string | undefined {
  if (!channel) return undefined;
  const key = { stable: "update.channel.stable", beta: "update.channel.beta" }[
    channel
  ] as MessageKey | undefined;
  // 认不出来的渠道**原样显示**：它不在目录里，翻译不了，也不该被翻译成一个
  // 好听的名字 —— 那会把一个未知渠道说成正式版。
  return key ? t(key) : channel;
}

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
  /** 这一份 result/failed 是不是手动问出来的——决定 `unreachable` 该不该显示。 */
  manual: boolean;
  /** 手动触发一次；自动检查内部也调它（`manual: false`），两条路径共用同一份
   *  状态与同一段逻辑，只是标记不同。 */
  check: (manual?: boolean) => Promise<void>;
  /** 关掉页面顶部那条提示。「有新版本」那一档等价于「放弃这次更新」——不装。 */
  dismiss: () => void;
}

export function useUpdateCheck(api: Api): UpdateCheckState {
  const [autoCheck, setAutoCheckState] = useState(readAutoCheck);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
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

  const check = async (isManual = false) => {
    setBusy(true);
    setFailed(null);
    setManual(isManual);
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
      void check(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  return {
    autoCheck,
    setAutoCheck,
    busy,
    result,
    failed,
    manual,
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
  const { result, failed, manual, dismiss } = state;
  const t = useT();
  if (!result && !failed) return null;

  if (failed) {
    // **不把 `failed` 里的原话端出来**：那是守护进程的报错，对用户没有意义。
    // 用户能做的只有一件事——过会儿再点一次，所以就说这一件。
    return (
      <div className="set-callout update-notice" role="status">
        <Icon name="warning" size="sm" />
        <span>{t("update.unavailable")}</span>
        <button type="button" className="notice-bar-close" aria-label={t("common.closeNotice")} onClick={dismiss}>
          <Icon name="x" size="xs" />
        </button>
      </div>
    );
  }

  if (result!.status === "available") {
    const channel = channelLabel(t, result!.channel);
    return (
      <div className="set-callout set-callout--info update-notice" role="status">
        <Icon name="arrow-down" size="sm" />
        {/* 整句一条 —— 版本号原先套着 `.mono`，那是**排版**，而它把一句话切成了
            三段。语序一旦随语言变，三段就接不回去。 */}
        <span className="update-notice-line">
          {channel
            ? t("update.availableLineWithChannel", {
                latest: result!.latest,
                current: result!.current,
                channel,
              })
            : t("update.availableLine", { latest: result!.latest, current: result!.current })}
        </span>
        <span className="update-notice-actions">
          {result!.downloadUrl ? (
            <Button size="sm" onClick={() => window.open(result!.downloadUrl, "_blank", "noopener")}>
              {t("update.upgrade")}
            </Button>
          ) : (
            // **不拼一个猜出来的地址**：点下去只会打不开。为什么拿不到是我们
            // 这边的事，用户只需要知道现在装不了、过会儿再看。
            <span className="text-body-sm">{t("update.noPackage")}</span>
          )}
          <Button variant="ghost" size="sm" onClick={dismiss}>
            {t("update.close")}
          </Button>
        </span>
      </div>
    );
  }

  // 「已是最新版本」有两条路都到这里：比对过、确实没有更新的；以及这个渠道
  // 压根没发布过东西 —— 后者对用户是同一件事（手上这版就是现存最新的那版），
  // 所以说同一句话。**分得开的是「这一次没问到」**，那句在下面。
  if (result!.status === "current" || result!.reasonCode === "no-release") {
    return (
      <div className="set-callout set-callout--success update-notice" role="status">
        <Icon name="check" size="sm" />
        <span>{t("update.current")}</span>
        <button type="button" className="notice-bar-close" aria-label={t("common.closeNotice")} onClick={dismiss}>
          <Icon name="x" size="xs" />
        </button>
      </div>
    );
  }

  // 剩下的只有 `unavailable`：**这一次没问到**。手动问的要给回应，自动问的
  // 不打扰（owner 2026-09-16）——点了按钮却什么都不发生，会让人以为按钮坏了；
  // 而后台自动问不到时弹一条，用户既没要也做不了什么。
  //
  // 这里**不写为什么没问到**（owner 2026-09-17）：断网、超时、服务端出错，
  // 对用户是同一件事，能做的也只有一件——过会儿再点一次。
  if (manual) {
    return (
      <div className="set-callout update-notice" role="status">
        <Icon name="warning" size="sm" />
        <span>{t("update.unavailable")}</span>
        <button type="button" className="notice-bar-close" aria-label={t("common.closeNotice")} onClick={dismiss}>
          <Icon name="x" size="xs" />
        </button>
      </div>
    );
  }
  return null;
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
  const t = useT();
  if (result?.status !== "available") return null;
  const channel = channelLabel(t, result.channel);

  return (
    <div className="update-toast" role="status">
      <div className="update-toast-head">
        <Icon name="arrow-down" size="sm" />
        <span>{t("update.found")}</span>
        <button type="button" className="notice-bar-close" aria-label={t("common.closeNotice")} onClick={dismiss}>
          <Icon name="x" size="xs" />
        </button>
      </div>
      <p className="update-toast-body">
        {channel
          ? t("update.toastLineWithChannel", {
              latest: result.latest,
              current: result.current,
              channel,
            })
          : t("update.toastLine", { latest: result.latest, current: result.current })}
      </p>
      <div className="update-toast-actions">
        {result.downloadUrl ? (
          <Button size="sm" onClick={() => window.open(result.downloadUrl, "_blank", "noopener")}>
            {t("update.upgrade")}
          </Button>
        ) : (
          <span className="text-body-sm">{t("update.noPackage")}</span>
        )}
        <Button variant="ghost" size="sm" onClick={dismiss}>
          {t("update.close")}
        </Button>
      </div>
    </div>
  );
}
