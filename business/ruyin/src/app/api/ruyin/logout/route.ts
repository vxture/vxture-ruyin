import {
  forwardCookieHeader,
  jsonWithUpstreamCookies,
  readJson,
  ruyinBffUrl,
} from "@/server/auth-upstream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let response: Response;
  try {
    response = await fetch(`${ruyinBffUrl()}/api/auth/logout`, {
      method: "POST",
      headers: forwardCookieHeader(request),
      cache: "no-store",
    });
  } catch {
    return jsonWithUpstreamCookies(
      { status: "ruyin_bff_unavailable" },
      { status: 503 },
      new Response(),
    );
  }

  return jsonWithUpstreamCookies(
    await readJson(response),
    { status: response.status },
    response,
  );
}
