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
  return (
    <div className="splash">
      <img className="splash-mark" src="/logo.svg" alt="" aria-hidden />
      <div className="text-title-md font-medium">未连接到本地运行时</div>
      <p
        className="text-body-md text-muted-foreground"
        style={{ maxWidth: 380, textAlign: "center" }}
      >
        如影的主体是运行在你自己机器上的<strong>本地运行时</strong>，
        由<strong>如影桌面应用</strong>启动。请从开始菜单打开「如影 Ruyin」——
        运行时会随之启动并自动连接，无需你输入任何东西。
      </p>
      {/* 说清这个页面是什么：它是访问方式，不是应用本身。少了这句，
          浏览器里的这一屏看起来就像「应用坏了」。 */}
      <p
        className="text-body-sm text-muted-foreground"
        style={{ maxWidth: 380, textAlign: "center", opacity: 0.75 }}
      >
        你现在打开的是运行时的网页界面。它需要运行时已在运行——
        单独打开它不会启动如影。
      </p>
    </div>
  );
}
