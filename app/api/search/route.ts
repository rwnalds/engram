import { searchNotes } from "@/lib/vault/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q") ?? "";
  // Humans browsing the dashboard should be able to find archived notes; they still rank
  // far below live ones. Agents (MCP) get them excluded by default.
  return Response.json({ results: searchNotes(q, { includeArchive: params.get("archive") !== "false" }) });
}
