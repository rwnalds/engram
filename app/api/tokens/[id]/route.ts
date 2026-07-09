import { revokeToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  revokeToken(id);
  return Response.json({ ok: true });
}
