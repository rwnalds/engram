import { AUTH_DISABLED, AUTH_SECRET, HARNESS_ENABLED, MCP_TOKEN } from "@/lib/config";
import { hasAnyToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    harness: HARNESS_ENABLED,
    mcpAuthRequired: MCP_TOKEN !== "" || hasAnyToken(),
    dashboardAuthRequired: !AUTH_DISABLED && AUTH_SECRET !== "",
  });
}
