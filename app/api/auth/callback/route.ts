import { createSessionToken, exchangeCodeForUser, isAllowed } from "@/lib/auth";
import { APP_URL, SESSION_COOKIE } from "@/lib/config";

export const dynamic = "force-dynamic";

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function redirect(path: string, setCookie?: string) {
  const headers: Record<string, string> = { location: path };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(null, { status: 302, headers });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(req.headers.get("cookie") || "");
  if (!code || !state || cookies.oauth_state !== state) return redirect("/login?error=state");

  const user = await exchangeCodeForUser(code);
  if (!user) return redirect("/login?error=google");
  if (!isAllowed(user.email)) return redirect("/login?error=not-allowed");

  const token = await createSessionToken(user);
  const secure = APP_URL.startsWith("https");
  return redirect(
    "/",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure ? "; Secure" : ""}`,
  );
}
