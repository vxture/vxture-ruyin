"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@vxture/design-system";

type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "active"; user: RuyinUser };

interface RuyinUser {
  id: string;
  email?: string;
  role?: string;
  tenantId?: string;
  permissions?: string[];
  provider?: string;
}

interface LoginResponse {
  status?: string;
  loginUrl?: string;
}

export function RuyinHome() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refreshSession = useCallback(async () => {
    setSession((current) =>
      current.status === "active" ? current : { status: "loading" },
    );
    const response = await fetch("/api/ruyin/session", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });

    if (!response.ok) {
      setSession({ status: "anonymous" });
      return;
    }

    const data = (await response.json()) as { user?: RuyinUser };
    setSession(
      data.user
        ? { status: "active", user: data.user }
        : { status: "anonymous" },
    );
  }, []);

  useEffect(() => {
    refreshSession().catch(() => setSession({ status: "anonymous" }));
  }, [refreshSession]);

  const statusText = useMemo(() => {
    if (session.status === "loading") return "检查中";
    if (session.status === "active") return "已登录";
    return "未登录";
  }, [session.status]);

  async function handleLogin() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/ruyin/login", {
        method: "POST",
        credentials: "include",
      });
      const data = (await response.json().catch(() => ({}))) as LoginResponse;

      if (response.status === 401 && data.loginUrl) {
        window.location.href = data.loginUrl;
        return;
      }

      if (!response.ok) {
        setMessage("登录同步失败，请确认 auth-bff、ruyin-bff 已启动。");
        return;
      }

      await refreshSession();
      setMessage("登录状态已同步。");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/ruyin/logout", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        setMessage("登出失败，请稍后重试。");
        return;
      }

      setSession({ status: "anonymous" });
      setMessage("已登出。");
    } finally {
      setBusy(false);
    }
  }

  const active = session.status === "active";

  return (
    <main className="grid min-h-screen place-items-center bg-vx-background px-6 py-10 text-vx-text-primary">
      <Card className="w-full max-w-xl border-vx-border bg-vx-surface shadow-lg">
        <CardHeader className="gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-vx-primary text-lg font-bold text-vx-text-inverse">
              R
            </span>
            <div>
              <CardTitle className="text-2xl">Ruyin</CardTitle>
              <CardDescription>Tenant agent workspace</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="grid gap-5">
          <section
            className={
              active
                ? "flex items-center justify-between gap-4 rounded-lg border border-vx-success-border bg-vx-success-surface p-4"
                : "flex items-center justify-between gap-4 rounded-lg border border-vx-border bg-vx-surface-muted p-4"
            }
          >
            <div>
              <span className="block text-xs font-semibold uppercase tracking-normal text-vx-text-muted">
                登录状态
              </span>
              <strong className="mt-1 block text-xl text-vx-text-primary">
                {statusText}
              </strong>
            </div>
            <Badge variant={active ? "default" : "secondary"}>
              {active ? "Active" : "Guest"}
            </Badge>
          </section>

          {active ? (
            <section className="grid gap-3 rounded-lg border border-vx-border bg-vx-surface-muted p-4">
              <div>
                <span className="block text-xs font-semibold uppercase tracking-normal text-vx-text-muted">
                  Account
                </span>
                <strong className="mt-1 block break-words text-vx-text-primary">
                  {session.user.email || session.user.id}
                </strong>
              </div>
              <div>
                <span className="block text-xs font-semibold uppercase tracking-normal text-vx-text-muted">
                  Tenant
                </span>
                <strong className="mt-1 block text-vx-text-primary">
                  {session.user.tenantId || "-"}
                </strong>
              </div>
              <div>
                <span className="block text-xs font-semibold uppercase tracking-normal text-vx-text-muted">
                  Role
                </span>
                <strong className="mt-1 block text-vx-text-primary">
                  {session.user.role || "member"}
                </strong>
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {active ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={handleLogout}
              >
                {busy ? "处理中" : "登出"}
              </Button>
            ) : (
              <Button type="button" disabled={busy} onClick={handleLogin}>
                {busy ? "同步中" : "登录"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => refreshSession()}
            >
              刷新状态
            </Button>
          </div>

          {message ? (
            <p className="text-sm text-vx-text-muted">{message}</p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
