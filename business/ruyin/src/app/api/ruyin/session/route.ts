import { NextResponse } from "next/server";
import {
  forwardCookieHeader,
  readJson,
  ruyinBffUrl,
} from "@/server/auth-upstream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  let response: Response;
  try {
    response = await fetch(`${ruyinBffUrl()}/api/auth/session`, {
      method: "GET",
      headers: forwardCookieHeader(request),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ status: "bff_unavailable" }, { status: 503 });
  }

  if (!response.ok) {
    return NextResponse.json(
      { status: "anonymous" },
      { status: response.status },
    );
  }

  return NextResponse.json(await readJson(response), {
    status: response.status,
  });
}
