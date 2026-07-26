/**
 * User slot - pinned to the sidebar bottom (Claude-Desktop-style): avatar +
 * name chip that opens a popover with account/runtime quick info and actions.
 * Identity is a placeholder until PKCE login lands (liaison L3(a)); the
 * runtime/protection rows and the settings entry are live.
 */

import { useEffect, useRef, useState } from "react";
import { Api, type SystemInfo } from "./api";

export function UserSlot({
  api,
  onOpenSettings,
}: {
  api: Api;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [online, setOnline] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/health");
        if (alive) setOnline(res.ok);
      } catch {
        if (alive) setOnline(false);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    api
      .system()
      .then((s) => alive && setSystem(s))
      .catch(() => {});
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api]);

  return (
    <div className="user-slot-wrap" ref={rootRef}>
      {open && (
        <div className="user-pop" role="dialog">
          <div className="user-pop-head">
            <span className="avatar lg">
              本
              <span className={`avatar-dot${online ? "" : " off"}`} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="ws-name">本地用户</div>
              <div className="muted">未登录 Vxture 账号</div>
            </div>
            <span className="pill" style={{ marginLeft: "auto" }}>
              本地模式
            </span>
          </div>

          <div className="user-pop-info">
            <div className="user-info-row">
              <span className={`conn-dot${online ? "" : " off"}`} />
              <span>Runtime</span>
              <span className="muted" style={{ marginLeft: "auto" }}>
                {online ? `运行中 · ${system?.version ?? ""}` : "未连接"}
              </span>
            </div>
            <div className="user-info-row">
              <span className="user-info-glyph">⛨</span>
              <span>数据保护</span>
              <span className="muted" style={{ marginLeft: "auto" }}>
                {system
                  ? system.keyProtection === "dpapi"
                    ? "DPAPI + 全库加密"
                    : "开发态（明文主密钥）"
                  : "…"}
              </span>
            </div>
            <div className="user-info-row">
              <span className="user-info-glyph">◈</span>
              <span>订阅</span>
              <span className="muted" style={{ marginLeft: "auto" }}>
                未激活 · 登录后同步
              </span>
            </div>
          </div>

          <div className="user-pop-menu">
            <button
              className="user-menu-item"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <span className="user-info-glyph">⚙</span> 设置
            </button>
            <button className="user-menu-item" disabled>
              <span className="user-info-glyph">☁</span> 账户中心
              <span className="soon-tag">即将开放</span>
            </button>
            <button className="user-menu-item" disabled>
              <span className="user-info-glyph">⇄</span> 切换账号
              <span className="soon-tag">即将开放</span>
            </button>
          </div>

          <button className="primary user-login-btn" disabled>
            登录 Vxture 账号
          </button>
          <div className="user-pop-foot muted">
            如影 RUYIN · Runtime {system?.version ?? "…"}
          </div>
        </div>
      )}

      <button
        className={`user-slot${open ? " open" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <span className="avatar">
          本
          <span className={`avatar-dot${online ? "" : " off"}`} />
        </span>
        <span className="user-slot-text">
          <span className="ws-name">本地用户</span>
          <span className="muted user-slot-sub">
            {online ? "本地模式 · 运行中" : "未连接"}
          </span>
        </span>
        <span className={`user-slot-caret${open ? " up" : ""}`}>▾</span>
      </button>
    </div>
  );
}
