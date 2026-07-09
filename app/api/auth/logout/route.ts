import { SESSION_COOKIE } from "@/lib/config";

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, {
    status: 302,
    headers: { location: "/login", "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0` },
  });
}
