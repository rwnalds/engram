import { createToken, listTokens } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ tokens: listTokens() });
}

export async function POST(req: Request) {
  const { name } = await req.json().catch(() => ({}));
  // Returns the plaintext token ONCE — only its hash is stored.
  return Response.json(createToken(typeof name === "string" ? name : "token"));
}
