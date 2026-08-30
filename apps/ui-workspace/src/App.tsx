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
      <img className="splash-mark" src="/icon.svg" alt="" aria-hidden />
      <div className="text-title-md font-medium">未连接到本地运行时</div>
      <p
        className="text-body-md text-muted-foreground"
        style={{ maxWidth: 360, textAlign: "center" }}
      >
        请通过桌面快捷方式（或 start-ruyin.cmd）启动如影——运行时会自动连接，无需手动输入。
      </p>
    </div>
  );
}
