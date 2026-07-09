import { googleAuthUrl } from "@/lib/auth";
import { APP_URL, GOOGLE_CLIENT_ID } from "@/lib/config";

export const dynamic = "force-dynamic";

export function GET() {
  if (!GOOGLE_CLIENT_ID) return Response.json({ error: "Google auth not configured" }, { status: 500 });
  const state = crypto.randomUUID();
  const secure = APP_URL.startsWith("https");
  return new Response(null, {
    status: 302,
    headers: {
      location: googleAuthUrl(state),
      "set-cookie": `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`,
    },
  });
}
