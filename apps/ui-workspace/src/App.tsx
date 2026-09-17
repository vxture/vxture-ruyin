/**
 * App root - resolves the daemon session token transparently (host-injected;
 * never asked of the user), then hands off to SessionGate which shows the
 * login screen or the product. The token is the "connect to the local
 * runtime" credential (loopback-only, host-supplied), NOT something the user
 * types - a desktop app connects to its own runtime silently.
 */

import { useEffect, useState } from "react";
import { Api } from "./api";
import { SessionGate } from "./login";
import { useT } from "./i18n";

export default function App() {
  // token 来源：?token=（Electron 壳 / 启动器注入）> localStorage（PWA 安装后
  // start_url 不带 query，靠上次记住的直进）。用户永远不手输——它是「连本地
  // 运行时」的宿主凭据，仅 127.0.0.1 回环。
  const fromQuery = new URLSearchParams(location.search).get("token");
  const [token] = useState<string | null>(() => {
    if (fromQuery) return fromQuery;
    try {
      return localStorage.getItem("ruyin-token");
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!token) return;
    try {
      localStorage.setItem("ruyin-token", token);
    } catch {
      // storage unavailable - session-only token is fine
    }
  }, [token]);

  if (!token) {
    return <ConnectHint />;
  }
  return <SessionGate api={new Api(token)} />;
}

/** No host-injected token (opened outside the desktop launcher/shell). Guide
 *  back to the proper entry point rather than asking for a token. */
function ConnectHint() {
  const t = useT();
  return (
    <div className="splash">
      <img className="splash-mark" src="/logo.svg" alt="" aria-hidden />
      <div className="text-title-md font-medium">{t("app.notConnected.title")}</div>
      {/* 这两段原先靠 `<strong>` 挑出「本地运行时」「RUYIN 桌面应用」两个词。
          加粗**没有跟着进目录**：哪几个词该重读是随语言走的，把标记切进句子
          就等于要求每门语言都在同一个位置断开。整段一句话给出去，重读交给
          排版（DS 的字号与颜色层级本来就在做这件事）。 */}
      <p
        className="text-body-md text-muted-foreground"
        style={{ maxWidth: 380, textAlign: "center" }}
      >
        {t("app.notConnected.body")}
      </p>
      {/* 说清这个页面是什么：它是访问方式，不是应用本身。少了这句，
          浏览器里的这一屏看起来就像「应用坏了」。 */}
      <p
        className="text-body-sm text-muted-foreground"
        style={{ maxWidth: 380, textAlign: "center", opacity: 0.75 }}
      >
        {t("app.notConnected.note")}
      </p>
    </div>
  );
}
