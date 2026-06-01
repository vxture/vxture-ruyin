import { NextResponse } from "next/server";

const DEFAULT_AUTH_BFF_URL = "http://localhost:3090";
const DEFAULT_RUYIN_BFF_URL = "http://localhost:3111";
const DEFAULT_CONSOLE_LOGIN_URL = "http://localhost:3020/zh-CN/signin";

export function authBffUrl(): string {
  return trimTrailingSlash(process.env.AUTH_BFF_URL) || DEFAULT_AUTH_BFF_URL;
}

export function ruyinBffUrl(): string {
  return trimTrailingSlash(process.env.RUYIN_BFF_URL) || DEFAULT_RUYIN_BFF_URL;
}

export function consoleLoginUrl(): string {
  return (
    trimTrailingSlash(process.env.NEXT_PUBLIC_CONSOLE_LOGIN_URL) ||
    DEFAULT_CONSOLE_LOGIN_URL
  );
}

export function forwardCookieHeader(request: Request): HeadersInit {
  const cookie = request.headers.get("cookie");
  return cookie ? { Cookie: cookie } : {};
}

export async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

export function appendSetCookies(
  response: NextResponse,
  upstream: Response,
): void {
  for (const cookie of readSetCookies(upstream.headers)) {
    response.headers.append("set-cookie", cookie);
  }
}

export function jsonWithUpstreamCookies(
  body: unknown,
  init: ResponseInit,
  upstream: Response,
): NextResponse {
  const response = NextResponse.json(body, init);
  appendSetCookies(response, upstream);
  return response;
}

function readSetCookies(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.();
  if (values?.length) return values;
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function trimTrailingSlash(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, "") ?? "";
}
