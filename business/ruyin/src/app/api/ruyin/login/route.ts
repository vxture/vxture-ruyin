import { NextResponse } from "next/server";
import {
  authBffUrl,
  consoleLoginUrl,
  forwardCookieHeader,
  jsonWithUpstreamCookies,
  readJson,
  ruyinBffUrl,
} from "@/server/auth-upstream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(`${authBffUrl()}/auth/crossdomain/token`, {
      method: "GET",
      headers: forwardCookieHeader(request),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ status: "auth_unavailable" }, { status: 503 });
  }

  if (!tokenResponse.ok) {
    return NextResponse.json(
      {
        status: "needs_tenant_login",
        loginUrl: consoleLoginUrl(),
      },
      { status: 401 },
    );
  }

  const tokenPayload = await readJson(tokenResponse);
  const token =
    typeof tokenPayload === "object" && tokenPayload !== null
      ? (tokenPayload as { token?: unknown }).token
      : null;

  if (typeof token !== "string" || !token) {
    return NextResponse.json({ status: "login_failed" }, { status: 502 });
  }

  const callbackUrl = new URL("/api/auth/callback", ruyinBffUrl());
  callbackUrl.searchParams.set("token", token);

  let callbackResponse: Response;
  try {
    callbackResponse = await fetch(callbackUrl, {
      method: "GET",
      headers: forwardCookieHeader(request),
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { status: "ruyin_bff_unavailable" },
      { status: 503 },
    );
  }

  if (callbackResponse.status >= 400) {
    return NextResponse.json(
      {
        status: "login_failed",
        upstreamStatus: callbackResponse.status,
      },
      { status: callbackResponse.status },
    );
  }

  return jsonWithUpstreamCookies(
    { status: "authenticated" },
    { status: 200 },
    callbackResponse,
  );
}
