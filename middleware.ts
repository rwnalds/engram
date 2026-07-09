import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "cortex_session";

export async function middleware(req: NextRequest) {
  const secret = process.env.AUTH_SECRET || "";
  // Auth is OFF unless explicitly configured (secret present and not disabled).
  // This keeps local dev open out of the box and only gates once secrets are set.
  if (process.env.AUTH_DISABLED === "true" || !secret) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  let ok = false;
  if (token) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secret));
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Protect everything except the MCP endpoint (bearer-token), health, the auth
  // routes, the login page, and static assets.
  matcher: ["/((?!api/mcp|api/health|api/auth|login|_next/static|_next/image|favicon.ico).*)"],
};
